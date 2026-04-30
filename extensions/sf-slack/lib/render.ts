/* SPDX-License-Identifier: Apache-2.0 */
/**
 * TUI rendering for sf-slack tool calls and results.
 *
 * Design goals (P7 — conversation polish):
 *   1. No raw IDs on screen. Channel IDs like `C0958CRG806` resolve to
 *      `#agentscript-dev` via the channel cache pre-warmed on session_start
 *      (plus a per-call fire-and-forget fill). Author `<@UID>` mentions and
 *      user IDs resolve via the user cache.
 *   2. No raw Slack `ts:1776790851.230879` strings in call headers. We show
 *      a friendly "Apr 21 · 5:00 PM" built from the same ts so the agent log
 *      stays scannable.
 *   3. A proper conversation ladder in both collapsed and expanded modes:
 *        ● Parent
 *        │ ↳ Reply 1
 *        │ ↳ Reply 2
 *        │   (consecutive same-author replies merge under one header)
 *   4. Authors get stable color badges (two-letter initials) hashed from
 *      their display name, so "Marcelino" always looks the same across
 *      messages and stands out from "Setu" or "Allen".
 *   5. Every message gets an OSC 8 clickable permalink chip — both in
 *      collapsed and expanded views — so the user can Cmd/Ctrl-click
 *      straight into Slack.
 *   6. Reactions and reply-count badges live on the header line of each
 *      message, not buried at the bottom of the body.
 *   7. Code fences and blockquotes in message bodies render with the
 *      theme's markdown tokens.
 *   8. 429s still render as a warm ⏳ line, not an alarming ✗.
 *
 * Existing contracts preserved:
 *   - renderResult still honors `opts.expanded` (collapsed preview vs full)
 *     for the search results list. Thread and history ladders now default
 *     to full-body rendering because they represent a conversation; opt
 *     into the old 110-char clip via the `threadBodies` preference.
 *   - Permalinks still honor the `compactPermalinks` preference (OSC 8).
 *   - mrkdwn → ANSI emphasis still works for `*bold*`, `_italic_`, `~strike~`,
 *     backtick code, `<#CID>` channel refs, `<@UID>` user refs, and links.
 *   - All hex colors come from the active theme via `theme.fg(token, ...)`.
 */
import { Text } from "@mariozechner/pi-tui";
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import type { SlackReaction, StructuredMatch, StructuredMessage } from "./types.ts";
import { getPreferences } from "./preferences.ts";
import { resolveChannelNameFromCache, resolveUserNameFromCache } from "./api.ts";
import { shortcodeToGlyph } from "./emoji.ts";

interface SlackToolCallArgs {
  action?: string;
  query?: string;
  limit?: number;
  channel?: string;
  ts?: string;
  oldest?: string;
  latest?: string;
  resolve_users?: boolean;
  fields?: string;
}

interface SlackToolResultDetails {
  ok?: boolean;
  action?: string;
  query?: string;
  permalink?: string;
  channel?: string;
  ts?: string;
  has_more?: boolean;
  matches?: StructuredMatch[];
  messages?: StructuredMessage[];
  reason?: string;
  fields?: string;
  count?: number;
}

interface SlackToolRenderResult {
  content?: unknown[];
  details?: SlackToolResultDetails;
}

// ─── Section glyphs ───────────────────────────────────────────────────────────

const ICON_SEARCH = "🔎";
const ICON_THREAD = "💬";
const ICON_HISTORY = "📜";
const ICON_PERMALINK = "🔗";
const ICON_AUTH = "🔐";

// ─── Author color palette ────────────────────────────────────────────────────
//
// Used to assign every distinct author a stable color token so consecutive
// authors are easy to tell apart at a glance. All five tokens must exist on
// every theme (Core UI + Markdown + Tools groups in themes.md).

const AUTHOR_PALETTE: readonly ThemeColor[] = [
  "mdHeading",
  "accent",
  "success",
  "warning",
  "mdCode",
  "mdListBullet",
  "toolTitle",
  "mdLink",
] as const;

/** Tiny FNV-1a 32-bit hash — no dependencies, good-enough bucket distribution. */
function hashToBucket(value: string, buckets: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash % Math.max(1, buckets);
}

/** Stable color token for a given author name. */
function authorColor(name: string): ThemeColor {
  if (!name) return "warning";
  return AUTHOR_PALETTE[hashToBucket(name.toLowerCase(), AUTHOR_PALETTE.length)];
}

/** Uppercase initials from a display name — "marcelino.llano" → "ML",
 *  "Setu Shah" → "SS", "bob" → "BO". Defaults to "??" for empty input. */
function authorInitials(name: string): string {
  if (!name) return "??";
  const cleaned = name
    .replace(/^@/, "")
    .replace(/[._-]+/g, " ")
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  const solo = parts[0] || name;
  return solo.slice(0, 2).toUpperCase();
}

// ─── Mrkdwn → ANSI ─────────────────────────────────────────────────────────────

/** Render a single line of Slack mrkdwn with theme emphasis. No blockquote or
 *  code-fence handling — that's the caller's job so we preserve layout. */
function renderMrkdwnInline(text: string, theme: Theme): string {
  if (!text) return "";
  let out = text;
  out = out.replace(/\*([^*\n]+)\*/g, (_match, value) => theme.bold(value));
  out = out.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, (_match, value) => theme.italic(value));
  out = out.replace(/~([^~\n]+)~/g, (_match, value) => theme.strikethrough(value));
  out = out.replace(/`([^`\n]+)`/g, (_match, value) => theme.fg("mdCode", value));
  // Channel refs: `<#CID|name>` — prefer embedded label, else cache.
  out = out.replace(/<#([CGD][A-Z0-9]+)\|([^>]+)>/g, (_match, _id, label) =>
    theme.fg("accent", `#${label}`),
  );
  out = out.replace(/<#([CGD][A-Z0-9]+)>/g, (_match, id) => {
    const cached = resolveChannelNameFromCache(id);
    const label = cached && cached !== id ? cached : id;
    return theme.fg("accent", `#${label}`);
  });
  // User refs: `<@UID|label>` — prefer embedded label, else cache, else raw.
  out = out.replace(/<@([UW][A-Z0-9]+)\|([^>]+)>/g, (_match, _id, label) =>
    theme.fg("warning", `@${label}`),
  );
  out = out.replace(/<@([UW][A-Z0-9]+)>/g, (_match, id) => {
    const cached = resolveUserNameFromCache(id);
    const label = cached && cached !== id ? cached : id;
    return theme.fg("warning", `@${label}`);
  });
  // Labeled links `<url|label>`
  out = out.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_match, url, label) =>
    theme.fg("mdLink", osc8Link(url, label)),
  );
  // Bare links
  out = out.replace(/<(https?:\/\/[^>]+)>/g, (_match, url) =>
    theme.fg("mdLink", osc8Link(url, url)),
  );
  return out;
}

/** Public export retained so existing tests and external callers still work. */
export function renderMrkdwn(text: string, theme: Theme): string {
  return renderMrkdwnInline(text, theme);
}

/** Render a multi-line message body with awareness of:
 *   - ```fenced code blocks``` → mdCodeBlock
 *   - > blockquotes             → mdQuote with mdQuoteBorder bar
 *   - normal lines              → inline mrkdwn via renderMrkdwnInline */
function renderBodyLines(body: string, theme: Theme): string[] {
  if (!body) return [theme.fg("dim", "(empty)")];

  const source = String(body).replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(theme.fg("mdCodeBlock", raw));
      continue;
    }
    const quoteMatch = raw.match(/^\s*&gt;\s?(.*)$/) || raw.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      const bar = theme.fg("mdQuoteBorder", "┃ ");
      out.push(bar + theme.fg("mdQuote", renderMrkdwnInline(quoteMatch[1], theme)));
      continue;
    }
    out.push(renderMrkdwnInline(raw, theme));
  }
  return out;
}

/** Pretty-print a reactions roll-up: " 👀 2  🙌 3  ❤️ 2 ".
 *
 *  Shortcodes resolve in this order:
 *    1. `node-emoji.get()` for standard Slack aliases that map to Unicode.
 *    2. A semantic fallback (see `emoji.ts`) for common custom-emoji
 *       families like `:approved-4:` → `✅`, `:ack_:` → `✔`.
 *    3. The literal `:shortcode:` wrapped in the theme's `dim` token so
 *       truly workspace-custom reactions (`:company-logo:`) still read
 *       clearly without pretending to be something they're not.
 */
function renderReactions(reactions: SlackReaction[] | undefined, theme: Theme): string {
  if (!reactions || !reactions.length) return "";
  return reactions
    .map((reaction) => {
      const name = reaction.name || "";
      const count = reaction.count || 0;
      const glyph = shortcodeToGlyph(name);
      const label = glyph ?? theme.fg("dim", `:${name || "?"}:`);
      return `${label}${theme.fg("muted", ` ${count}`)}`;
    })
    .join("  ");
}

// ─── Time rendering ───────────────────────────────────────────────────────────

/** Same-day messages show the clock time; older messages show a calendar
 *  date. Slack `ts` values are `seconds.microseconds` strings. */
function friendlyTime(ts: string | undefined): string {
  if (!ts) return "";
  const millis = Number.parseFloat(ts) * 1000;
  if (!Number.isFinite(millis)) return ts;
  const date = new Date(millis);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return `today · ${timeStr}`;
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (diffDays >= 0 && diffDays < 7) {
    const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
    return `${weekday} · ${timeStr}`;
  }
  const dateStr = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${dateStr} · ${timeStr}`;
}

/** Collapse a pre-formatted "5h ago" label with the absolute clock time for
 *  extra context. Used when the structured payload already carries a
 *  relative label from api.ts::relativeTime. */
function combineTime(relative: string | undefined, ts: string | undefined): string {
  const abs = friendlyTime(ts);
  if (!abs && !relative) return "";
  if (!abs) return relative || "";
  if (!relative) return abs;
  return `${abs}  (${relative})`;
}

// ─── Permalink rendering ─────────────────────────────────────────────────────

/** Extract a short, human-readable label from a Slack permalink. */
function shortPermalinkLabel(url: string): string {
  const match = url.match(/\/p(\d{10,})/);
  if (match) return `p${match[1].slice(0, 10)}`;
  try {
    const parsed = new URL(url);
    const segs = parsed.pathname.split("/").filter(Boolean);
    return segs[segs.length - 1] || url;
  } catch {
    return url;
  }
}

/** Wrap `label` in an OSC 8 hyperlink pointing to `url`. */
function osc8Link(url: string, label: string): string {
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
}

function formatPermalink(url: string | undefined, theme: Theme): string {
  if (!url) return "";
  const { compactPermalinks } = getPreferences();
  if (compactPermalinks === "off") return theme.fg("mdLink", url);
  const label = shortPermalinkLabel(url);
  return theme.fg("mdLink", osc8Link(url, label));
}

/** Inline "[↗ open]" chip — used on each message row so the user can
 *  Cmd/Ctrl-click straight into Slack. */
function permalinkChip(url: string | undefined, theme: Theme): string {
  if (!url) return "";
  const { compactPermalinks } = getPreferences();
  const label = "↗";
  if (compactPermalinks === "off") return theme.fg("mdLink", url);
  return theme.fg("mdLink", osc8Link(url, label));
}

// ─── Author / channel formatting ─────────────────────────────────────────────

/** Render a two-letter initials badge in the author's stable color. */
function authorBadge(author: string, theme: Theme): string {
  const resolved = resolveUserNameFromCache(author) || author || "?";
  const color = authorColor(resolved);
  return theme.fg(color, theme.bold(authorInitials(resolved)));
}

/** Full author header — badge + bold name + dimmed time + optional permalink. */
function renderAuthorHeader(
  bullet: string,
  authorId: string,
  ts: string | undefined,
  relativeTimeLabel: string | undefined,
  permalink: string | undefined,
  theme: Theme,
): string {
  const resolved = resolveUserNameFromCache(authorId) || authorId || "?";
  const color = authorColor(resolved);
  const badge = authorBadge(resolved, theme);
  const bulletText = theme.fg(color, bullet);
  const nameText = theme.fg(color, theme.bold(resolved));
  const timeText = theme.fg("dim", combineTime(relativeTimeLabel, ts) || "");
  const chip = permalink ? " " + permalinkChip(permalink, theme) : "";
  return `${bulletText} ${badge} ${nameText}  ${timeText}${chip}`;
}

/** Resolve a channel ID to "#name" or fall back to the ID itself. */
function formatChannelLabel(channelIdOrName: string | undefined): string {
  if (!channelIdOrName) return "";
  if (/^[CGD][A-Z0-9]{8,}$/.test(channelIdOrName)) {
    const name = resolveChannelNameFromCache(channelIdOrName);
    return `#${name}`;
  }
  return `#${channelIdOrName.replace(/^#/, "")}`;
}

// ─── Compact call label ─────────────────────────────────────────────────────

function callLabel(toolLabel: string, summary: string, theme: Theme): Text {
  const text = theme.fg("toolTitle", theme.bold(toolLabel + " ")) + theme.fg("muted", summary);
  return new Text(text, 0, 0);
}

export function renderCall(args: SlackToolCallArgs, theme: Theme): Text {
  const action = args.action || "search";
  switch (action) {
    case "search":
      return callLabel(
        `${ICON_SEARCH} Slack Search`,
        `"${args.query || "?"}"` +
          (args.limit ? ` (limit: ${args.limit})` : "") +
          (args.fields ? ` [${args.fields}]` : ""),
        theme,
      );
    case "thread": {
      const when = friendlyTime(args.ts);
      const channelLabel = formatChannelLabel(args.channel);
      const summary = when ? `${channelLabel} · ${when}` : channelLabel;
      return callLabel(
        `${ICON_THREAD} Slack Thread`,
        summary + (args.resolve_users ? " +names" : ""),
        theme,
      );
    }
    case "history": {
      let summary = formatChannelLabel(args.channel);
      if (args.oldest || args.latest) {
        const oldest = args.oldest ? friendlyTime(args.oldest) : "…";
        const latest = args.latest ? friendlyTime(args.latest) : "now";
        summary += " " + theme.fg("dim", `[${oldest} → ${latest}]`);
      }
      if (args.resolve_users) summary += " +names";
      return callLabel(`${ICON_HISTORY} Slack History`, summary, theme);
    }
    case "permalink":
      return callLabel(
        `${ICON_PERMALINK} Slack Permalink`,
        `${formatChannelLabel(args.channel)}${args.ts ? " · " + friendlyTime(args.ts) : ""}`,
        theme,
      );
    case "auth":
      return callLabel(`${ICON_AUTH} Slack Auth`, "checking status", theme);
    default:
      return callLabel("Slack", action, theme);
  }
}

// ─── Rate-limit friendly error line ────────────────────────────────────────────

function renderErrorLine(result: SlackToolRenderResult, theme: Theme): Text {
  const reason = result.details?.reason || "";
  const text = getFirstText(result.content) || "Slack call failed";
  if (reason === "rate_limited" || reason === "http_429" || /rate.?limit/i.test(text)) {
    return new Text(
      theme.fg("warning", "⏳ Slack rate limited") +
        theme.fg("dim", " · retried once, still throttled. Try again in a few seconds."),
      0,
      0,
    );
  }
  return new Text(theme.fg("error", "✗ " + text), 0, 0);
}

// ─── Header builders for thread / history / search ────────────────────────────

/** Build the rich section header with count + distinct-author + reaction totals.
 *  Each chip is separated by a subtle " · " in dim so it reads as one line. */
function buildRichHeader(
  icon: string,
  primary: string,
  chips: string[],
  permalink: string | undefined,
  theme: Theme,
): string {
  const rendered = [theme.fg("success", `${icon} ${primary}`)];
  for (const chip of chips.filter(Boolean)) {
    rendered.push(theme.fg("dim", " · ") + chip);
  }
  let out = rendered.join("");
  if (permalink) out += "   " + permalinkChip(permalink, theme);
  return out;
}

function countDistinctAuthors(messages: StructuredMessage[]): number {
  const set = new Set<string>();
  for (const message of messages) {
    const resolved = resolveUserNameFromCache(message.author || "") || message.author || "";
    if (resolved) set.add(resolved);
  }
  return set.size;
}

function countTotalReactions(messages: StructuredMessage[]): number {
  let total = 0;
  for (const message of messages) {
    for (const reaction of message.reactions || []) {
      total += reaction.count || 0;
    }
  }
  return total;
}

// ─── Full result rendering ──────────────────────────────────────────────────────

export function renderResult(
  result: SlackToolRenderResult,
  opts: { expanded: boolean; isPartial: boolean },
  theme: Theme,
): Text {
  const details = result.details || {};
  const action = details.action || "search";

  if (opts.isPartial) {
    return new Text(theme.fg("warning", `Slack ${action} running…`), 0, 0);
  }

  if (!details.ok && details.action !== "auth") {
    return renderErrorLine(result, theme);
  }

  if (action === "auth") {
    const text = getFirstText(result.content);
    const isActive = text.includes("✅");
    const icon = isActive
      ? theme.fg("success", "✓ Connected")
      : theme.fg("error", "✗ Not configured");
    return new Text(icon, 0, 0);
  }

  if (action === "permalink") {
    if (!details.ok) {
      return renderErrorLine(result, theme);
    }
    return new Text(theme.fg("success", "✓ ") + formatPermalink(details.permalink, theme), 0, 0);
  }

  if (action === "search") {
    const matches = details.matches || [];
    const count = matches.length;
    const query = details.query || "";

    if (count === 0) {
      return new Text(theme.fg("warning", `${ICON_SEARCH} No results for "${query}"`), 0, 0);
    }

    const chips: string[] = [];
    const distinct = new Set(matches.map((match) => match.channel).filter(Boolean));
    if (distinct.size > 1) chips.push(theme.fg("accent", `${distinct.size} channels`));
    chips.push(theme.fg("muted", `"${query}"`));

    const header = buildRichHeader(
      ICON_SEARCH,
      `${count} result${count !== 1 ? "s" : ""}`,
      chips,
      undefined,
      theme,
    );

    if (!opts.expanded) {
      return new Text(renderMatchesCollapsed(header, matches, theme), 0, 0);
    }

    return new Text(renderMatchesExpanded(header, matches, theme), 0, 0);
  }

  if (action === "thread") {
    const messages = details.messages || [];
    const count = messages.length;

    if (count === 0) {
      return new Text(theme.fg("warning", `${ICON_THREAD} No messages in thread`), 0, 0);
    }

    const channelLabel = formatChannelLabel(details.channel);
    const chips = [
      theme.fg("accent", channelLabel),
      theme.fg("muted", `${count} msg${count !== 1 ? "s" : ""}`),
    ];

    const authors = countDistinctAuthors(messages);
    if (authors > 1) chips.push(theme.fg("muted", `${authors} people`));

    const reactionCount = countTotalReactions(messages);
    if (reactionCount > 0) chips.push(theme.fg("mdCode", `${reactionCount} reactions`));

    if (details.has_more) chips.push(theme.fg("warning", "more available"));

    const header = buildRichHeader(ICON_THREAD, "Thread", chips, undefined, theme);

    if (!opts.expanded) {
      return new Text(renderThreadLadder(header, messages, theme, /* collapsed */ true), 0, 0);
    }
    return new Text(renderThreadLadder(header, messages, theme, /* collapsed */ false), 0, 0);
  }

  if (action === "history") {
    const messages = details.messages || [];
    const count = messages.length;

    if (count === 0) {
      return new Text(theme.fg("warning", `${ICON_HISTORY} No messages in this range`), 0, 0);
    }

    const channelLabel = formatChannelLabel(details.channel);
    const chips: string[] = [];
    if (channelLabel) chips.push(theme.fg("accent", channelLabel));

    const authors = countDistinctAuthors(messages);
    if (authors > 0)
      chips.push(theme.fg("muted", `${authors} ${authors === 1 ? "author" : "authors"}`));

    const reactionCount = countTotalReactions(messages);
    if (reactionCount > 0) chips.push(theme.fg("mdCode", `${reactionCount} reactions`));

    if (details.has_more) chips.push(theme.fg("warning", "more available"));

    const header = buildRichHeader(
      ICON_HISTORY,
      `${count} message${count !== 1 ? "s" : ""}`,
      chips,
      undefined,
      theme,
    );

    if (!opts.expanded) {
      return new Text(renderHistoryLadder(header, messages, theme, /* collapsed */ true), 0, 0);
    }
    return new Text(renderHistoryLadder(header, messages, theme, /* collapsed */ false), 0, 0);
  }

  return new Text(theme.fg("dim", getFirstText(result.content)), 0, 0);
}

// ─── Collapsed / expanded renderers ───────────────────────────────────────────

/** Target body width for clipped previews in collapsed mode. */
const COLLAPSED_PREVIEW_CHARS = 110;

function clipLine(raw: string, max: number): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : normalized.slice(0, max - 1).trimEnd() + "…";
}

function renderMatchesCollapsed(header: string, matches: StructuredMatch[], theme: Theme): string {
  const lines = [header, ""];
  for (const match of matches) {
    const preview = clipLine(match.text || "", COLLAPSED_PREVIEW_CHARS);
    const authorHeader = renderAuthorHeader(
      "●",
      match.author,
      match.ts,
      match.time,
      match.permalink,
      theme,
    );
    const chan = theme.fg("accent", `#${match.channel}`);
    lines.push(`${authorHeader}  ${theme.fg("dim", "in")} ${chan}`);
    if (preview) lines.push("    " + theme.fg("text", preview));
  }
  lines.push("");
  lines.push(theme.fg("dim", "  (expand for full bodies)"));
  return lines.join("\n");
}

function renderThreadLadder(
  header: string,
  messages: StructuredMessage[],
  theme: Theme,
  collapsed: boolean,
): string {
  const out: string[] = [header, ""];
  const gutter = theme.fg("borderMuted", "│ ");
  const g0 = theme.fg("borderMuted", "│");

  // A thread renders in full when the user opted into full bodies, even if
  // pi hasn't expanded the tool-result card. Search matches keep their
  // clipping — that's a results list, not a conversation.
  const clipBodies = collapsed && getPreferences().threadBodies !== "full";

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const isParent = index === 0;

    // Header row
    if (isParent) {
      out.push(
        renderAuthorHeader("●", message.author || "?", message.ts, message.time, undefined, theme) +
          (message.replyCount && message.replyCount > 0
            ? "  " +
              theme.fg(
                "accent",
                `↳ ${message.replyCount} ${plural(message.replyCount, "reply", "replies")}`,
              )
            : ""),
      );
    } else {
      out.push(g0);
      const replyHeader = renderAuthorHeader(
        "↳",
        message.author || "?",
        message.ts,
        message.time,
        undefined,
        theme,
      );
      out.push("  " + replyHeader);
    }

    // Body
    const prefix = isParent ? "  " : "  " + gutter;
    const bodyText = clipBodies
      ? clipLine(message.text || "", COLLAPSED_PREVIEW_CHARS)
      : message.text || "";
    for (const line of renderBodyLines(bodyText, theme)) {
      out.push(prefix + line);
    }

    // Reactions
    const reactionLine = renderReactions(message.reactions, theme);
    if (reactionLine) out.push(prefix + theme.fg("dim", "↻ ") + reactionLine);
  }

  out.push("");
  // Only tease "(expand for full message bodies)" when we actually clipped.
  if (clipBodies && messages.length >= 3) {
    out.push(theme.fg("dim", "  (expand for full message bodies)"));
  } else {
    out.push(theme.fg("borderMuted", "  ───"));
  }
  return out.join("\n");
}

function renderHistoryLadder(
  header: string,
  messages: StructuredMessage[],
  theme: Theme,
  collapsed: boolean,
): string {
  const out: string[] = [header];
  let previousAuthor = "";

  // Same rule as the thread ladder — opt-in full bodies wins over the
  // harness "collapsed" view for history listings, which are a
  // conversation just like threads.
  const clipBodies = collapsed && getPreferences().threadBodies !== "full";

  for (const message of messages) {
    const resolved = resolveUserNameFromCache(message.author || "") || message.author || "?";
    const sameAuthor = resolved === previousAuthor && !!previousAuthor;

    if (!sameAuthor) {
      out.push("");
      out.push(
        renderAuthorHeader("●", message.author || "?", message.ts, message.time, undefined, theme),
      );
      previousAuthor = resolved;
    } else {
      out.push(theme.fg("dim", "  · " + (friendlyTime(message.ts) || message.time || "")));
    }

    const bodyText = clipBodies
      ? clipLine(message.text || "", COLLAPSED_PREVIEW_CHARS)
      : message.text || "";
    for (const line of renderBodyLines(bodyText, theme)) {
      out.push("    " + line);
    }

    if (message.replyCount && message.replyCount > 0) {
      const label = `↳ ${message.replyCount} ${plural(message.replyCount, "reply", "replies")}`;
      out.push(
        "    " + theme.fg("accent", label) + theme.fg("dim", ` (thread_ts: ${message.threadTs})`),
      );
    }
    const reactionLine = renderReactions(message.reactions, theme);
    if (reactionLine) out.push("    " + theme.fg("dim", "↻ ") + reactionLine);
  }

  return out.join("\n");
}

/** Search results in expanded mode: rich card per match with permalink chip. */
function renderMatchesExpanded(header: string, matches: StructuredMatch[], theme: Theme): string {
  let text = header;
  for (const match of matches) {
    text += "\n\n";
    const authorHeader = renderAuthorHeader(
      "●",
      match.author,
      match.ts,
      match.time,
      match.permalink,
      theme,
    );
    text += authorHeader + "  " + theme.fg("dim", "in ") + theme.fg("accent", `#${match.channel}`);
    for (const line of renderBodyLines(match.text, theme)) {
      text += "\n    " + line;
    }
  }
  return text;
}

// ─── Misc ──────────────────────────────────────────────────────────────────────

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) {
    return "";
  }
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

// Exported for tests that want to inspect helpers without going through
// renderResult's Text-wrapping.
export const __internals = {
  shortPermalinkLabel,
  osc8Link,
  clipLine,
  formatPermalink,
  formatChannelLabel,
  friendlyTime,
  authorInitials,
  authorColor,
  hashToBucket,
};
