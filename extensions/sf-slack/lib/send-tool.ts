/* SPDX-License-Identifier: Apache-2.0 */
/**
 * slack_send tool — human-in-the-loop messaging.
 *
 * This is the only "post arbitrary text as the user" surface in sf-slack.
 * Every call routes through a confirmation dialog in interactive mode; in
 * non-interactive mode it refuses unless the user has explicitly opted in
 * with SLACK_ALLOW_HEADLESS_SEND=1.
 *
 * Routing:
 *   action=channel  → chat.postMessage to a channel/MPIM the user resolves
 *   action=dm       → conversations.open(user_id) → chat.postMessage to the IM
 *   action=thread   → chat.postMessage with thread_ts to reply in a thread
 *
 * Safety rails:
 *   - Token-type gate (user tokens only; bot/app rejected upfront)
 *   - Scope gate (user-token chat:write must be granted)
 *   - Unified recipient + message confirmation (low-confidence matches are shown inline)
 *   - Mention re-confirm (@channel/@here/@everyone flips the default to Cancel)
 *   - Headless refusal unless SLACK_ALLOW_HEADLESS_SEND=1
 *   - Dry-run via SLACK_SEND_DRY_RUN=1 — confirm UX runs but no API call
 *   - Audit trail via pi.appendEntry(SEND_ENTRY_TYPE, ...)
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  SlackSendParams,
  SEND_ENTRY_TYPE,
  ENV_ALLOW_HEADLESS_SEND,
  ENV_SEND_DRY_RUN,
  type ApiErr,
  type AssistantSearchContextResponse,
  type ChatGetPermalinkResponse,
  type ConversationsOpenResponse,
  type JsonCompatibleParams,
  type ResolveResult,
  type ResolvedChannel,
  type ResolvedUser,
  type SlackSearchMatch,
  type SlackSendAuditEntry,
} from "./types.ts";
import { requireAuth } from "./auth.ts";
import {
  slackApi,
  slackApiJson,
  chatPostMessage,
  conversationsOpenDM,
  errorResult,
  hasScope,
  detectTokenType,
} from "./api.ts";
import { isSlackChannelId, isSlackUserId, resolveChannel, resolveUser } from "./resolve.ts";
import { buildSlackTextResult, SLACK_OUTPUT_DESCRIPTION_SUFFIX } from "./truncation.ts";

// ─── Tunables ──────────────────────────────────────────────────────────────────

/** Seconds the confirm dialog waits before auto-cancelling. Keeps an agent
 *  that wandered off from accidentally sending after long idle. */
const CONFIRM_TIMEOUT_SECONDS = 60;

// Slack broadcast-scoped mention tokens. These all notify more people than
// a regular user @-mention and deserve an extra confirmation step before
// pi pushes the button. The list:
//   - <!channel> / @channel     — every active member of the channel
//   - <!here>    / @here        — every currently-active member
//   - <!everyone> / @everyone   — workspace-wide broadcast
//   - <!subteam^SID|@group>     — every member of a Slack user group;
//                                 live repro showed this bypassed the
//                                 warning previously.
const MENTION_PATTERN =
  /<!channel\b|<!here\b|<!everyone\b|<!subteam\b|@channel\b|@here\b|@everyone\b/i;

const MAX_MESSAGE_LENGTH = 40_000;
const RECIPIENT_AUTO_CONFIRM_THRESHOLD = 0.85;

// ─── Render helpers ────────────────────────────────────────────────────────────

function callLabel(label: string, summary: string, theme: Theme): Text {
  return new Text(
    theme.fg("toolTitle", theme.bold(label + " ")) + theme.fg("muted", summary),
    0,
    0,
  );
}

interface SendToolCallArgs {
  action?: string;
  to?: string;
  text?: string;
  thread_ts?: string;
  broadcast?: boolean;
}

interface SendToolRenderResult {
  content?: unknown[];
  details?: {
    ok?: boolean;
    action?: string;
    channel?: string;
    channel_name?: string;
    message_ts?: string;
    permalink?: string;
    dry_run?: boolean;
    reason?: string;
  };
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function previewBody(text: string, limit = 80): string {
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= limit) return single;
  return single.slice(0, limit - 1) + "…";
}

// ─── Registration ──────────────────────────────────────────────────────────────

export function registerSendTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof SlackSendParams>({
    name: "slack_send",
    label: "Slack Send",
    description:
      "Post a message to Slack as the authenticated user. " +
      "Actions: channel — post to a channel/MPIM/known D... DM ID. dm — post to a 1:1 DM by user reference. thread — reply in a thread. " +
      "Every send requires explicit user confirmation via a dialog; non-interactive sessions refuse unless SLACK_ALLOW_HEADLESS_SEND=1 is set. " +
      "Use this ONLY when the user has explicitly asked you to send a message in the current turn. Draft text first only when exact wording is missing; the confirm dialog is the approval step, not a surprise." +
      SLACK_OUTPUT_DESCRIPTION_SUFFIX,
    promptSnippet:
      "Post a Slack message to a channel, DM, or thread with explicit user confirmation",
    promptGuidelines: [
      "Call slack_send ONLY after the user has explicitly asked, in the current turn, to send a message.",
      "If the user did not supply exact wording, draft the message in chat first. If they did, do not ask for another chat-level confirmation; the slack_send dialog is the approval step. Do NOT surprise the user with a dialog; they should already know what you are about to send.",
      'Never add your own signatures, footers, or "via pi"-style markers to the message text. Send the text verbatim.',
      "Pass the text in Slack mrkdwn (*bold*, _italic_, <url|label>) if formatting is requested. Otherwise plain text is fine.",
      "For DMs to people, use action=dm with a user reference (email, @handle, or display name). If the token lacks im:write, the tool can reuse an existing DM found by Slack search; use action=channel with a D... ID only when the user explicitly provides that existing DM channel ID.",
      "For thread replies, pass action=thread with the parent channel reference in `to` and the parent message ts in `thread_ts`.",
    ],
    parameters: SlackSendParams,
    prepareArguments(args): {
      action: "channel" | "dm" | "thread";
      to: string;
      text: string;
      thread_ts?: string;
      broadcast?: boolean;
    } {
      if (!args || typeof args !== "object" || Array.isArray(args)) return args as never;
      const input = args as {
        to?: unknown;
        text?: unknown;
        recipient?: unknown;
        message?: unknown;
      };
      return {
        ...input,
        ...(input.to === undefined && typeof input.recipient === "string"
          ? { to: input.recipient }
          : {}),
        ...(input.text === undefined && typeof input.message === "string"
          ? { text: input.message }
          : {}),
      } as never;
    },

    renderCall(args: SendToolCallArgs, theme: Theme) {
      const action = args.action || "send";
      const to = args.to || "?";
      const preview = previewBody(args.text || "", 60);
      const summary = preview ? `${to} — "${preview}"` : to;
      switch (action) {
        case "channel":
          return callLabel(
            "Slack Send",
            `#${to.replace(/^#/, "")} "${previewBody(args.text || "", 60)}"`,
            theme,
          );
        case "dm":
          return callLabel("Slack DM", summary, theme);
        case "thread":
          return callLabel(
            "Slack Reply",
            `${to} (ts=${args.thread_ts || "?"}) "${preview}"`,
            theme,
          );
        default:
          return callLabel("Slack Send", summary, theme);
      }
    },

    renderResult(
      result: SendToolRenderResult,
      opts: { expanded: boolean; isPartial: boolean },
      theme: Theme,
    ) {
      if (opts.isPartial) {
        return new Text(theme.fg("warning", "Slack send awaiting confirmation…"), 0, 0);
      }
      const details = result.details || {};
      if (!details.ok) {
        const reason = details.reason || "";
        const line = getFirstText(result.content) || "Send failed";
        if (reason === "user_cancelled") {
          return new Text(theme.fg("muted", "✗ Send cancelled by user"), 0, 0);
        }
        return new Text(theme.fg("error", `✗ ${line}`), 0, 0);
      }
      const dest = details.channel_name ? `#${details.channel_name}` : details.channel || "?";
      const prefix = details.dry_run ? "✓ [dry-run] " : "✓ ";
      return new Text(
        theme.fg("success", prefix) +
          theme.fg("text", `Sent to `) +
          theme.fg("accent", dest) +
          (details.permalink ? theme.fg("dim", `\n  ${details.permalink}`) : ""),
        0,
        0,
      );
    },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const auth = await requireAuth(ctx);
      if ("result" in auth) return auth.result;

      const action = params.action;

      // ─── Preflight: token type + action-aware scope gate ────────────
      // We check the non-recoverable cases up front so the user doesn't sit
      // through recipient resolution + a confirm dialog only to learn at
      // chat.postMessage time that the base posting scope is missing. DM
      // routing intentionally happens later: when im:write is absent we can
      // still reuse an existing DM channel discovered via Slack search.
      const preflight = preflightSend(auth.token, action);
      if (preflight) return preflight;
      const text = (params.text || "").trim();
      if (!text) {
        return {
          content: [{ type: "text", text: "slack_send requires non-empty `text`." }],
          details: { ok: false, action, reason: "missing_text" },
        };
      }
      if (text.length > MAX_MESSAGE_LENGTH) {
        return {
          content: [
            {
              type: "text",
              text: `Message exceeds Slack's ${MAX_MESSAGE_LENGTH}-char limit (${text.length}). Shorten and retry.`,
            },
          ],
          details: { ok: false, action, reason: "text_too_long" },
        };
      }

      // ─── Resolve recipient to a channel ID ───────────────────────────
      const routed = await routeRecipient(auth.token, action, params.to || "", signal, ctx);
      if ("result" in routed) return routed.result;

      if (action === "thread" && !params.thread_ts) {
        return {
          content: [
            {
              type: "text",
              text: 'action="thread" requires thread_ts (parent message timestamp).',
            },
          ],
          details: { ok: false, action, reason: "missing_thread_ts" },
        };
      }

      // ─── Confirm with the user (or refuse if headless) ───────────────
      const confirmation = await confirmSend(
        ctx,
        {
          action,
          channelId: routed.channelId,
          channelLabel: routed.channelLabel,
          recipientReview: routed.recipientReview,
          text,
          threadTs: params.thread_ts,
        },
        signal,
      );
      if (confirmation.ok === false) return confirmation.result;
      const finalText = confirmation.text;

      // ─── Dry-run: audit + short-circuit ──────────────────────────────
      if (process.env[ENV_SEND_DRY_RUN]?.trim() === "1") {
        await appendAuditEntry(pi, {
          ts: Date.now(),
          action,
          channel: routed.channelId,
          channel_ref: params.to || "",
          channel_name: routed.channelLabel,
          thread_ts: params.thread_ts,
          broadcast: params.broadcast,
          text: finalText,
          dry_run: true,
        });
        return buildSlackTextResult(
          `[dry-run] Would send to ${routed.channelLabel ? "#" + routed.channelLabel : routed.channelId}:\n${finalText}`,
          {
            ok: true,
            action,
            channel: routed.channelId,
            channel_name: routed.channelLabel,
            dry_run: true,
          },
          { prefix: "pi-slack-send-dry-run" },
        );
      }

      // ─── Actual send ────────────────────────────────────────────────
      const body: JsonCompatibleParams = {
        channel: routed.channelId,
        text: finalText,
      };
      if (action === "thread" && params.thread_ts) {
        body.thread_ts = params.thread_ts;
        if (params.broadcast) body.reply_broadcast = true;
      }
      const result = await chatPostMessage(auth.token, body, signal);
      if (!result.ok) {
        const error = result as ApiErr;
        return errorResult(error.error, error.needed, error.provided, error.messages);
      }

      const messageTs = result.data.ts;
      const permalink = messageTs
        ? await fetchPermalink(auth.token, routed.channelId, messageTs, signal)
        : undefined;

      await appendAuditEntry(pi, {
        ts: Date.now(),
        action,
        channel: routed.channelId,
        channel_ref: params.to || "",
        channel_name: routed.channelLabel,
        thread_ts: params.thread_ts,
        broadcast: params.broadcast,
        text: finalText,
        message_ts: messageTs,
        permalink,
      });

      const destLabel = routed.channelLabel ? `#${routed.channelLabel}` : routed.channelId;
      const lines = [`Sent to ${destLabel}.`];
      if (permalink) lines.push(permalink);
      return buildSlackTextResult(
        lines.join("\n"),
        {
          ok: true,
          action,
          channel: routed.channelId,
          channel_name: routed.channelLabel,
          message_ts: messageTs,
          permalink,
        },
        { prefix: "pi-slack-send" },
      );
    },
  });
}

// ─── Preflight helpers ────────────────────────────────────────────────────────

interface PreflightFailure {
  content: { type: "text"; text: string }[];
  details: { ok: false; action: string; reason: string };
}

/** Base send scope gate. Action-less callers (legacy tests) can omit
 *  `action`; callers inside the tool pass their action so the returned
 *  failure can name the attempted route. We intentionally do not reject
 *  action=dm here when im:write is absent: routeDm can still reuse an
 *  already-open DM channel found via Slack search and then post with
 *  chat:write.
 *
 *  Why not support chat:write.public here? slack_send posts as the authenticated
 *  user token. `chat:write.public` is a bot/app public-channel posting enhancer,
 *  not a replacement for user-token `chat:write`. Runtime failures such as
 *  not_in_channel are still normalized into friendly guidance.
 */
export function preflightSend(
  token: string,
  action?: "channel" | "dm" | "thread",
): PreflightFailure | null {
  const tokenType = detectTokenType(token);
  if (tokenType === "bot" || tokenType === "app") {
    return {
      content: [
        {
          type: "text",
          text:
            "slack_send requires a user token (xoxp-). The configured token appears to be a " +
            `${tokenType} token, which posts as the app (not as you) and has a different blast ` +
            "radius. Re-run /login sf-slack with a user token.",
        },
      ],
      details: { ok: false, action: action || "send", reason: "wrong_token_type" },
    };
  }
  if (!hasScope("chat:write")) {
    return {
      content: [
        {
          type: "text",
          text:
            "slack_send posts as your Slack user token and needs chat:write. " +
            "Re-auth after the Slack app/workspace has approved chat:write.",
        },
      ],
      details: { ok: false, action: action || "send", reason: "missing_scope" },
    };
  }
  return null;
}

// ─── Recipient routing ────────────────────────────────────────────────────────

interface RoutedRecipient {
  channelId: string;
  channelLabel?: string;
  recipientReview?: RecipientReview;
}

interface RecipientReview {
  input: string;
  selected: string;
  confidence?: number;
  source?: string;
  alternates?: string[];
  warning?: string;
}

interface RouteFailure {
  result: {
    content: { type: "text"; text: string }[];
    details: Record<string, unknown>;
  };
}

async function routeRecipient(
  token: string,
  action: "channel" | "dm" | "thread",
  to: string,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<RoutedRecipient | RouteFailure> {
  const ref = to.trim();
  if (!ref) {
    return {
      result: {
        content: [{ type: "text", text: "slack_send requires a non-empty `to` reference." }],
        details: { ok: false, action, reason: "missing_to" },
      },
    };
  }

  if (action === "dm") {
    return routeDm(token, ref, signal, ctx);
  }

  // channel + thread share the same channel-resolution path. For sends we do
  // not call the shared recipient-confirm helper, because that helper opens a
  // separate select dialog and then slack_send opens its final send dialog.
  // Instead we resolve candidates here and fold the selected recipient + any
  // ambiguity into the single final confirmation dialog.
  const resolved = await resolveChannel(token, ref, signal, { limit: 5 });
  const routed = routeResolvedChannel(action, ref, resolved, ctx.hasUI);
  if ("result" in routed) return routed;
  return routed;
}

function routeResolvedChannel(
  action: "channel" | "thread",
  ref: string,
  resolution: ResolveResult<ResolvedChannel>,
  hasUI: boolean,
): RoutedRecipient | RouteFailure {
  if (resolution.best) {
    if (!hasUI && resolution.confidence < RECIPIENT_AUTO_CONFIRM_THRESHOLD) {
      return recipientResolutionFailure(action, "channel", ref, resolution);
    }
    const channel = resolution.best;
    return {
      channelId: channel.id,
      channelLabel: channel.name,
      recipientReview: buildChannelReview(ref, resolution, channel),
    };
  }

  if (hasUI && isSlackChannelId(ref)) {
    return {
      channelId: ref.trim(),
      channelLabel: ref.trim(),
      recipientReview: {
        input: ref,
        selected: ref.trim(),
        confidence: 0,
        source: "user_unverified",
        warning: "Slack could not verify this raw channel/DM ID; confirm only if you trust it.",
      },
    };
  }

  return recipientResolutionFailure(action, "channel", ref, resolution);
}

type SelectedUserForSend = { user: ResolvedUser; review: RecipientReview } | RouteFailure;

function selectUserForSend(
  ref: string,
  resolution: ResolveResult<ResolvedUser>,
  hasUI: boolean,
): SelectedUserForSend {
  if (resolution.best) {
    if (!hasUI && resolution.confidence < RECIPIENT_AUTO_CONFIRM_THRESHOLD) {
      return recipientResolutionFailure("dm", "user", ref, resolution);
    }
    return { user: resolution.best, review: buildUserReview(ref, resolution, resolution.best) };
  }

  if (hasUI && isSlackUserId(ref)) {
    const user: ResolvedUser = {
      id: ref.trim(),
      handle: ref.trim(),
      displayName: ref.trim(),
      realName: ref.trim(),
      email: "",
      confidence: 0,
      source: "user_unverified",
    };
    return {
      user,
      review: {
        input: ref,
        selected: ref.trim(),
        confidence: 0,
        source: "user_unverified",
        warning: "Slack could not verify this raw user ID; confirm only if you trust it.",
      },
    };
  }

  return recipientResolutionFailure("dm", "user", ref, resolution);
}

async function routeDm(
  token: string,
  ref: string,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<RoutedRecipient | RouteFailure> {
  const resolved = await resolveUser(token, ref, signal, { limit: 5 });
  const selected = selectUserForSend(ref, resolved, ctx.hasUI);
  if ("result" in selected) return selected;

  const { user, review } = selected;
  if (user.id === "me") {
    return {
      result: {
        content: [
          {
            type: "text",
            text: `action=dm requires a specific other user; got "${ref}". Use an @handle, email, or user ID.`,
          },
        ],
        details: { ok: false, action: "dm", reason: "self_not_allowed" },
      },
    };
  }

  const fallbackContext = {
    ref,
    userId: user.id,
    handle: user.handle,
    displayName: user.displayName,
    realName: user.realName,
  };

  if (!hasScope("im:write")) {
    const existing = await findExistingDmChannel(token, fallbackContext, signal);
    if (existing) return { ...existing, recipientReview: review };
    return missingDmOpenScopeFailure(ref, fallbackContext);
  }

  const opened = await conversationsOpenDM(token, [user.id], signal);
  if (!opened.ok) {
    const error = opened as ApiErr;
    if (error.error === "missing_scope") {
      const existing = await findExistingDmChannel(token, fallbackContext, signal);
      if (existing) return { ...existing, recipientReview: review };
      return missingDmOpenScopeFailure(ref, fallbackContext, error.needed, error.provided);
    }
    return {
      result: errorResult(error.error, error.needed, error.provided, error.messages),
    };
  }
  const im = (opened.data as ConversationsOpenResponse).channel?.id;
  if (!im) {
    return {
      result: {
        content: [
          {
            type: "text",
            text: "conversations.open did not return a DM channel ID. Retry with a different recipient.",
          },
        ],
        details: { ok: false, action: "dm", reason: "no_dm_channel" },
      },
    };
  }
  return { channelId: im, channelLabel: dmLabel(fallbackContext), recipientReview: review };
}

function buildChannelReview(
  ref: string,
  resolution: ResolveResult<ResolvedChannel>,
  selected: ResolvedChannel,
): RecipientReview {
  return {
    input: ref,
    selected: `#${selected.name} (${selected.id})`,
    confidence: selected.confidence,
    source: selected.source,
    alternates: formatAlternates(resolution.candidates, selected.id),
    warning: lowConfidenceWarning(resolution.confidence),
  };
}

function buildUserReview(
  ref: string,
  resolution: ResolveResult<ResolvedUser>,
  selected: ResolvedUser,
): RecipientReview {
  return {
    input: ref,
    selected: `${displayUser(selected)} (${selected.id})`,
    confidence: selected.confidence,
    source: selected.source,
    alternates: formatAlternates(resolution.candidates, selected.id),
    warning: lowConfidenceWarning(resolution.confidence),
  };
}

function lowConfidenceWarning(confidence: number): string | undefined {
  if (confidence >= RECIPIENT_AUTO_CONFIRM_THRESHOLD) return undefined;
  return `Recipient match is below ${Math.round(RECIPIENT_AUTO_CONFIRM_THRESHOLD * 100)}% confidence; review before sending.`;
}

function formatAlternates(
  candidates: Array<ResolvedChannel | ResolvedUser>,
  selectedId: string,
): string[] {
  return candidates
    .filter((candidate) => candidate.id !== selectedId)
    .slice(0, 4)
    .map((candidate) => {
      if ("name" in candidate) {
        return `#${candidate.name} (${candidate.id}, ${confidencePercent(candidate.confidence)}%)`;
      }
      return `${displayUser(candidate)} (${candidate.id}, ${confidencePercent(candidate.confidence)}%)`;
    });
}

function displayUser(user: ResolvedUser): string {
  return user.displayName || user.realName || user.handle || user.id;
}

function confidencePercent(confidence: number): number {
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

function recipientResolutionFailure(
  action: string,
  type: "channel" | "user",
  ref: string,
  resolution: ResolveResult<ResolvedChannel | ResolvedUser>,
): RouteFailure {
  const candidates = resolution.candidates.map((candidate) => {
    if ("name" in candidate) {
      return `#${candidate.name} (${candidate.id}, ${confidencePercent(candidate.confidence)}%)`;
    }
    return `${displayUser(candidate)} (${candidate.id}, ${confidencePercent(candidate.confidence)}%)`;
  });
  const suffix = candidates.length ? ` Candidates: ${candidates.join("; ")}` : "";
  return {
    result: {
      content: [
        {
          type: "text",
          text: `Slack ${type} "${ref}" could not be safely resolved. Re-run with an exact name or ID.${suffix}`,
        },
      ],
      details: {
        ok: false,
        action,
        reason: resolution.ok ? "headless_unverified" : "not_found",
        ref,
        candidates,
      },
    },
  };
}

interface DmFallbackContext {
  ref: string;
  userId?: string;
  handle?: string;
  displayName?: string;
  realName?: string;
}

async function findExistingDmChannel(
  token: string,
  ctx: DmFallbackContext,
  signal?: AbortSignal,
): Promise<RoutedRecipient | null> {
  if (!canSearchExistingDms()) return null;
  const queries = buildExistingDmSearchQueries(ctx);
  for (const query of queries) {
    const result = await slackApiJson<AssistantSearchContextResponse>(
      "assistant.search.context",
      token,
      {
        query,
        count: 20,
        // Restrict discovery to 1:1 DMs. We only use this as an im:write
        // fallback; MPDMs and channels should still route through action=channel.
        channel_types: "im",
      },
      signal,
    );
    if (!result.ok) continue;
    const channelId = firstDmChannelId(result.data.results?.messages);
    if (channelId) return { channelId, channelLabel: dmLabel(ctx) };
  }
  return null;
}

export function buildExistingDmSearchQueries(ctx: DmFallbackContext): string[] {
  const queries: string[] = [];
  const add = (query: string | undefined) => {
    const trimmed = query?.trim();
    if (trimmed && !queries.includes(trimmed)) queries.push(trimmed);
  };

  const display = cleanSearchValue(ctx.displayName || ctx.realName || "");
  const handle = cleanHandle(ctx.handle);
  const ref = cleanSearchValue(ctx.ref.replace(/^@/, ""));

  // The with:/from: operators are the precise path when the workspace's
  // search backend can map names to users. Bare quoted fallbacks are less
  // precise but still constrained to channel_types=im above.
  if (display) add(`with:@${display}`);
  if (handle) add(`from:${handle}`);
  if (display) add(quoteSearchPhrase(display));
  if (ref && ref !== display && ref !== handle) add(quoteSearchPhrase(ref));
  if (ctx.userId) add(ctx.userId);

  return queries.slice(0, 5);
}

function firstDmChannelId(matches: SlackSearchMatch[] | undefined): string | undefined {
  if (!matches) return undefined;
  for (const match of matches) {
    const channelId = match.channel_id || match.channel?.id;
    if (channelId?.startsWith("D")) return channelId;
  }
  return undefined;
}

function missingDmOpenScopeFailure(
  ref: string,
  ctx: DmFallbackContext,
  needed?: string,
  provided?: string,
): RouteFailure {
  const searchHint = canSearchExistingDms()
    ? `I also could not find an existing DM channel for "${dmLabel(ctx) || ref}" via Slack search.`
    : "This token also lacks search:read.im, so I cannot discover an already-open DM as a fallback.";
  const text =
    "slack_send action=dm needs im:write to open a new 1:1 DM, which this token does not have. " +
    `${searchHint} Ask a workspace admin to grant im:write, or provide an existing DM channel ID (D...) and send with action=channel.`;

  return {
    result: {
      content: [{ type: "text", text }],
      details: {
        ok: false,
        action: "dm",
        reason: "missing_scope",
        needed: needed || "im:write",
        provided,
        ref,
      },
    },
  };
}

function canSearchExistingDms(): boolean {
  return hasScope("search:read") || hasScope("search:read.im");
}

function dmLabel(ctx: DmFallbackContext): string | undefined {
  const label = ctx.displayName || ctx.realName || ctx.handle;
  return label ? `@${label.replace(/^@/, "")}` : undefined;
}

function cleanHandle(value: string | undefined): string {
  return cleanSearchValue(value || "").replace(/^@/, "");
}

function cleanSearchValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function quoteSearchPhrase(value: string): string {
  return `"${value.replace(/"/g, "").trim()}"`;
}

// ─── Confirmation dialog ──────────────────────────────────────────────────────

interface ConfirmContext {
  action: "channel" | "dm" | "thread";
  channelId: string;
  channelLabel?: string;
  recipientReview?: RecipientReview;
  text: string;
  threadTs?: string;
}

type ConfirmResult =
  | { ok: true; text: string }
  | {
      ok: false;
      result: {
        content: { type: "text"; text: string }[];
        details: Record<string, unknown>;
      };
    };

async function confirmSend(
  ctx: ExtensionContext,
  initial: ConfirmContext,
  signal?: AbortSignal,
): Promise<ConfirmResult> {
  // Headless mode: refuse unless the user has explicitly opted in.
  if (!ctx.hasUI) {
    const optedIn = process.env[ENV_ALLOW_HEADLESS_SEND]?.trim() === "1";
    if (!optedIn) {
      return {
        ok: false,
        result: {
          content: [
            {
              type: "text" as const,
              text:
                "slack_send refuses to run without an interactive confirmation dialog. " +
                `Export ${ENV_ALLOW_HEADLESS_SEND}=1 to allow sends in non-interactive sessions ` +
                "(pi -p, RPC, CI), or run pi interactively so the dialog can be shown.",
            },
          ],
          details: { ok: false, action: initial.action, reason: "headless_refused" },
        },
      };
    }
    // Headless opt-in: still log a one-liner so operators see what went out.
    ctx.ui.notify(
      `slack_send (headless): posting to ${initial.channelLabel || initial.channelId}`,
      "info",
    );
    return { ok: true, text: initial.text };
  }

  const preview = buildConfirmMessage(initial);
  const confirmed = await ctx.ui.confirm("Send Slack message?", preview, {
    signal,
    timeout: CONFIRM_TIMEOUT_SECONDS * 1000,
  });
  if (!confirmed) return cancelledResult(initial.action);

  // Mention re-confirm is intentionally the only second dialog, and only for
  // messages with broadcast-scoped mentions.
  if (MENTION_PATTERN.test(initial.text)) {
    const mentionOk = await ctx.ui.confirm(
      "⚠ This message contains @channel / @here / @everyone. Send anyway?",
      buildMentionWarning(initial),
      { signal, timeout: CONFIRM_TIMEOUT_SECONDS * 1000 },
    );
    if (!mentionOk) return cancelledResult(initial.action);
  }

  return { ok: true, text: initial.text };
}

function buildConfirmMessage(ctx: ConfirmContext): string {
  const dest =
    ctx.action === "dm"
      ? `DM to ${ctx.channelLabel || ctx.channelId}`
      : ctx.action === "thread"
        ? `Thread reply in ${ctx.channelLabel ? "#" + ctx.channelLabel : ctx.channelId} (ts=${ctx.threadTs})`
        : `Channel ${ctx.channelLabel ? "#" + ctx.channelLabel : ctx.channelId}`;
  const body = ctx.text.length > 600 ? ctx.text.slice(0, 600) + "…" : ctx.text;
  return [
    `To: ${dest}`,
    ...formatRecipientReview(ctx.recipientReview),
    `Length: ${ctx.text.length} char${ctx.text.length === 1 ? "" : "s"}`,
    "",
    "--- Preview ---",
    body,
    "---",
    "",
    "Press Enter to send, Esc to cancel.",
  ].join("\n");
}

function formatRecipientReview(review: RecipientReview | undefined): string[] {
  if (!review) return [];
  const lines = [
    `Resolved from: ${review.input}`,
    `Recipient: ${review.selected}${review.confidence === undefined ? "" : ` (${confidencePercent(review.confidence)}% via ${review.source || "resolve"})`}`,
  ];
  if (review.warning) lines.push(`Warning: ${review.warning}`);
  if (review.alternates?.length) {
    lines.push("Other possible matches:");
    for (const alternate of review.alternates) lines.push(`  - ${alternate}`);
  }
  lines.push("");
  return lines;
}

function buildMentionWarning(ctx: ConfirmContext): string {
  const dest = ctx.channelLabel ? "#" + ctx.channelLabel : ctx.channelId;
  return [
    `This message would notify every member of ${dest}.`,
    "",
    "--- Text ---",
    ctx.text.length > 400 ? ctx.text.slice(0, 400) + "…" : ctx.text,
    "---",
    "",
    "Confirm the wide-broadcast intent before proceeding.",
  ].join("\n");
}

function cancelledResult(action: string) {
  return {
    ok: false as const,
    result: {
      content: [{ type: "text" as const, text: "Send cancelled by user." }],
      details: { ok: false, action, reason: "user_cancelled" },
    },
  };
}

// ─── Audit trail ──────────────────────────────────────────────────────────────

async function appendAuditEntry(pi: ExtensionAPI, entry: SlackSendAuditEntry): Promise<void> {
  try {
    pi.appendEntry<SlackSendAuditEntry>(SEND_ENTRY_TYPE, entry);
  } catch {
    // Audit must never block a real send. Swallow errors; worst case is we
    // lose the trail, not the message.
  }
}

// ─── Permalink helper ─────────────────────────────────────────────────────────

async function fetchPermalink(
  token: string,
  channel: string,
  ts: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const result = await slackApi<ChatGetPermalinkResponse>(
    "chat.getPermalink",
    token,
    { channel, message_ts: ts },
    signal,
  );
  return result.ok ? result.data.permalink : undefined;
}
