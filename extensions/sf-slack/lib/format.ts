/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Text formatters for sf-slack.
 *
 * Pure functions: typed data → string. No Pi or TUI dependencies.
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  PROVIDER_NAME,
  KEYCHAIN_SERVICE,
  KEYCHAIN_ACCOUNT,
  ENV_TOKEN,
  type SlackSearchMatch,
  type SlackMessage,
  type SlackConversation,
  type SlackUser,
  type SlackFile,
  type StructuredMatch,
  type StructuredMessage,
  type StructuredChannel,
  type StructuredUser,
  type StructuredFile,
} from "./types.ts";
import {
  type TokenSource,
  detectTokenSource,
  getSlackToken,
  resolveTokenFromConfiguredSources,
  maskToken,
  oauthScopes,
} from "./auth.ts";
import {
  tsToLabel,
  relativeTime,
  resolveUserMentionsInText,
  getGrantedScopes,
  detectTokenType,
} from "./api.ts";

// ─── Search results (text for LLM consumption) ─────────────────────────────────

/** How much message body text to emit in LLM-facing output.
 *
 *   - summary: channel / author / time / reply-count metadata only
 *   - preview: summary + first ~200 chars of each message (default)
 *   - full:    summary + complete message text (legacy behavior)
 *
 * Preview mode is almost always enough to let the agent pick which messages
 * to drill into with action="thread" or fields="full". */
export type FieldsMode = "summary" | "preview" | "full";

const PREVIEW_CHARS = 200;

function clipBody(raw: string, fields: FieldsMode): string | undefined {
  if (fields === "summary") return undefined;
  // Resolve <@UID> mentions before trimming so the character budget isn't
  // eaten by raw IDs the reader can't recognize.
  const resolved = resolveUserMentionsInText(String(raw || ""));
  const normalized = resolved.replace(/\s+/g, " ").trim();
  if (!normalized) return "(empty)";
  if (fields === "full" || normalized.length <= PREVIEW_CHARS) return normalized;
  return normalized.slice(0, PREVIEW_CHARS).trimEnd() + "…";
}

export function formatSearchResults(
  matches: SlackSearchMatch[],
  fields: FieldsMode = "full",
): string {
  if (!matches.length) return "No Slack messages matched the query.";
  return matches
    .map((match, index) => {
      const channelName =
        match.channel?.name ||
        match.channel_name ||
        match.channel?.id ||
        match.channel_id ||
        "unknown-channel";
      const author =
        match.username || match.author_name || match.user || match.author_user_id || "unknown-user";
      const permalink = match.permalink || "(no permalink)";
      const ts = match.ts || match.message_ts;
      const body = clipBody(match.text || match.content || "", fields);

      const lines = [
        `Result ${index + 1}`,
        `Channel: #${channelName}`,
        `Author: ${author}`,
        `Time: ${tsToLabel(ts)}`,
        `Permalink: ${permalink}`,
      ];
      if (body !== undefined) lines.push(`Text: ${body}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

// ─── Messages (text for LLM consumption) ────────────────────────────────────────

export function formatMessages(
  messages: SlackMessage[],
  userNames?: Map<string, string>,
  fields: FieldsMode = "full",
): string {
  if (!messages.length) return "No messages returned.";
  return messages
    .map((message, index) => {
      const rawAuthor = message.user || message.username || message.bot_id || "unknown-user";
      const author = userNames?.get(rawAuthor) || rawAuthor;
      const threadTs = message.thread_ts;
      const replyCount = message.reply_count;
      const threadInfo = replyCount ? ` [${replyCount} replies, thread_ts: ${threadTs}]` : "";
      const header = `${index + 1}. [${tsToLabel(message.ts)}] ${author}`;
      const body = clipBody(message.text || "", fields);
      if (body === undefined) return `${header}${threadInfo}`;
      return `${header}: ${body}${threadInfo}`;
    })
    .join("\n");
}

// ─── Structured extractors (for renderResult details) ───────────────────────────

export function extractStructuredMatches(matches: SlackSearchMatch[]): StructuredMatch[] {
  return matches.map((match) => ({
    channel: match.channel?.name || match.channel_name || match.channel?.id || "unknown",
    author: match.username || match.author_name || match.user || "unknown",
    text: resolveUserMentionsInText(String(match.text || ""))
      .replace(/\s+/g, " ")
      .trim(),
    time: relativeTime(match.ts || match.message_ts),
    permalink: match.permalink || "",
    ts: match.ts || match.message_ts || "",
  }));
}

export function extractStructuredMessages(
  messages: SlackMessage[],
  userNames?: Map<string, string>,
): StructuredMessage[] {
  return messages.map((message) => {
    const rawAuthor = message.user || message.username || message.bot_id || "unknown-user";
    return {
      author: userNames?.get(rawAuthor) || rawAuthor,
      text: resolveUserMentionsInText(String(message.text || ""))
        .replace(/\s+/g, " ")
        .trim(),
      time: relativeTime(message.ts),
      ts: message.ts || "",
      threadTs: message.thread_ts,
      replyCount: message.reply_count,
      reactions: message.reactions,
    };
  });
}

// ─── Channel info (text for LLM) ────────────────────────────────────────────────

export function formatChannelInfo(channel: SlackConversation): string {
  return [
    `Channel: #${channel.name || "unknown"}`,
    `ID: ${channel.id || "unknown"}`,
    `Topic: ${channel.topic?.value || "(none)"}`,
    `Purpose: ${channel.purpose?.value || "(none)"}`,
    `Members: ${channel.num_members ?? "unknown"}`,
    `Created: ${tsToLabel(toOptionalString(channel.created))}`,
    `Archived: ${channel.is_archived ? "yes" : "no"}`,
    `Private: ${channel.is_private ? "yes" : "no"}`,
    `Creator: ${channel.creator || "unknown"}`,
  ].join("\n");
}

export function extractStructuredChannel(channel: SlackConversation): StructuredChannel {
  return {
    id: channel.id || "unknown",
    name: channel.name || "unknown",
    topic: channel.topic?.value || "(none)",
    purpose: channel.purpose?.value || "(none)",
    numMembers: channel.num_members,
    isPrivate: !!channel.is_private,
    isArchived: !!channel.is_archived,
    created: tsToLabel(toOptionalString(channel.created)),
    creator: channel.creator || "unknown",
  };
}

// ─── User info (text for LLM) ───────────────────────────────────────────────────

export function formatUserInfo(user: SlackUser): string {
  const profile = user.profile || {};
  return [
    `User: ${profile.display_name || profile.real_name || user.name || "unknown"}`,
    `ID: ${user.id || "unknown"}`,
    `Real Name: ${profile.real_name || "unknown"}`,
    `Display Name: ${profile.display_name || "(not set)"}`,
    `Email: ${profile.email || "(not available)"}`,
    `Title: ${profile.title || "(not set)"}`,
    `Timezone: ${user.tz_label || user.tz || "unknown"}`,
    `Is Bot: ${user.is_bot ? "yes" : "no"}`,
    `Is Admin: ${user.is_admin ? "yes" : "no"}`,
    `Status: ${[profile.status_emoji, profile.status_text].filter(Boolean).join(" ").trim() || "(none)"}`,
  ].join("\n");
}

export function extractStructuredUser(user: SlackUser): StructuredUser {
  const profile = user.profile || {};
  return {
    id: user.id || "unknown",
    displayName: profile.display_name || "(not set)",
    realName: profile.real_name || user.real_name || "unknown",
    email: profile.email || "(not available)",
    title: profile.title || "(not set)",
    timezone: user.tz_label || user.tz || "unknown",
    isBot: !!user.is_bot,
    isAdmin: !!user.is_admin,
    status: [profile.status_emoji, profile.status_text].filter(Boolean).join(" ").trim(),
  };
}

// ─── File info (text for LLM) ───────────────────────────────────────────────────

export function formatFileInfo(file: SlackFile): string {
  return [
    `File: ${file.name || file.title || "unknown"}`,
    `ID: ${file.id || "unknown"}`,
    `Type: ${file.filetype || file.pretty_type || "unknown"}`,
    `Size: ${file.size ? `${Math.round(file.size / 1024)}KB` : "unknown"}`,
    `Created: ${tsToLabel(toOptionalString(file.created))}`,
    `Shared by: ${file.user || "unknown"}`,
    `URL (private): ${file.url_private || "(not available)"}`,
    `Permalink: ${file.permalink || "(not available)"}`,
    `Channels: ${Array.isArray(file.channels) ? file.channels.join(", ") : "(none)"}`,
  ].join("\n");
}

export function extractStructuredFile(file: SlackFile): StructuredFile {
  return {
    id: file.id || "unknown",
    name: file.name || file.title || "unknown",
    type: file.filetype || file.pretty_type || "unknown",
    size: file.size ? `${Math.round(file.size / 1024)}KB` : "unknown",
    created: tsToLabel(toOptionalString(file.created)),
    sharedBy: file.user || "unknown",
    permalink: file.permalink || "",
    channels: Array.isArray(file.channels) ? file.channels.join(", ") : "",
  };
}

// ─── Auth status ────────────────────────────────────────────────────────────────

export async function buildAuthStatus(ctx: ExtensionContext): Promise<string> {
  const configuredToken = resolveTokenFromConfiguredSources();
  const auth = await getSlackToken(ctx);
  const source = detectTokenSource();

  const lines: string[] = [];
  lines.push(`Provider: ${PROVIDER_NAME}`);

  if (!auth.ok) {
    lines.push("Auth method: ❌ Not configured");
    lines.push("Status: Slack tools are unavailable.");
    lines.push("");
    lines.push("Recommended setup:");
    lines.push(`  1. Pi auth: /login ${PROVIDER_NAME}`);
    lines.push(
      `  2. macOS Keychain: security add-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${KEYCHAIN_SERVICE}" -w "xoxp-token" -U`,
    );
    lines.push(`  3. Environment: export ${ENV_TOKEN}=xoxp-...`);
    lines.push("");
    lines.push(`Requested scopes: ${oauthScopes()}`);
    return lines.join("\n");
  }

  const sourceLabel: Record<TokenSource, string> = {
    keychain: "✓ macOS Keychain (hardware-backed) 🔒",
    env: `✓ Environment variable (${ENV_TOKEN})`,
    "pi-auth": "✓ Pi auth store (via /login) ★ recommended",
    none: "✓ Configured",
  };
  const effectiveSource: TokenSource = configuredToken ? source : "pi-auth";
  const tokenType = detectTokenType(auth.token);
  const tokenTypeLabel =
    tokenType === "user"
      ? "user token (xoxp-)"
      : tokenType === "bot"
        ? "bot token (xoxb-) ⚠ some actions need a user token"
        : tokenType === "app"
          ? "app-level token"
          : "unknown token type";

  lines.push(`Auth method: ${sourceLabel[effectiveSource]}`);
  lines.push(`Token: ${maskToken(auth.token)}  [${tokenTypeLabel}]`);
  lines.push("Status: ✅ Active — all Slack tools are ready.");

  // Granted vs requested scope diff (P4). This is the big robustness win:
  // previously we rendered `oauthScopes()` — i.e. what we asked for at
  // OAuth time — which can silently drift from what Slack actually granted.
  // We now read the X-OAuth-Scopes header Slack returned on its last
  // response (populated during session_start's auth.test probe) and render
  // both lists plus the diff.
  const granted = getGrantedScopes();
  const requested = oauthScopes()
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  lines.push("");
  if (granted) {
    const sortedGranted = [...granted].sort();
    lines.push(`Granted scopes (from Slack, ${sortedGranted.length}):`);
    lines.push(`  ${sortedGranted.join(", ")}`);

    const missingGranted = requested.filter((scope) => !granted.has(scope));
    if (missingGranted.length > 0) {
      lines.push("");
      lines.push(`⚠ Requested but not granted (${missingGranted.length}):`);
      lines.push(`  ${missingGranted.join(", ")}`);
      lines.push(
        "  → Some tools or actions may be gated. Re-run /login sf-slack to re-consent with these scopes.",
      );
    }
  } else {
    lines.push(
      "Granted scopes: (unknown — no Slack call has captured the X-OAuth-Scopes header yet)",
    );
    lines.push("  → Run /sf-slack refresh to probe, or invoke any Slack tool once.");
  }

  lines.push("");
  lines.push(
    `Requested scopes (from ${PROVIDER_NAME} defaults / SLACK_SCOPES, ${requested.length}):`,
  );
  lines.push(`  ${requested.join(", ")}`);

  return lines.join("\n");
}

function toOptionalString(value: string | number | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}
