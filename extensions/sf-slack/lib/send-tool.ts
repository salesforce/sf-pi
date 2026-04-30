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
 *   - Scope gate (chat:write OR chat:write.public must be granted)
 *   - Low-confidence recipient gate (<0.85 forces a select-first step)
 *   - Mention re-confirm (@channel/@here/@everyone flips the default to Cancel)
 *   - Headless refusal unless SLACK_ALLOW_HEADLESS_SEND=1
 *   - Dry-run via SLACK_SEND_DRY_RUN=1 — confirm UX runs but no API call
 *   - Audit trail via pi.appendEntry(SEND_ENTRY_TYPE, ...)
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
  SlackSendParams,
  SEND_ENTRY_TYPE,
  ENV_ALLOW_HEADLESS_SEND,
  ENV_SEND_DRY_RUN,
  type ApiErr,
  type ChatPostMessageResponse,
  type ChatGetPermalinkResponse,
  type ConversationsOpenResponse,
  type JsonCompatibleParams,
  type SlackSendAuditEntry,
} from "./types.ts";
import { requireAuth } from "./auth.ts";
import {
  slackApi,
  chatPostMessage,
  conversationsOpenDM,
  errorResult,
  hasScope,
  detectTokenType,
} from "./api.ts";
import { isSlackUserId } from "./resolve.ts";
import {
  requireConfirmedChannel,
  requireConfirmedUser,
  type ConfirmResult as RecipientConfirmResult,
} from "./recipient-confirm.ts";
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
      "Actions: channel — post to a channel/MPIM. dm — post to a 1:1 DM. thread — reply in a thread. " +
      "Every send requires explicit user confirmation via a dialog; non-interactive sessions refuse unless SLACK_ALLOW_HEADLESS_SEND=1 is set. " +
      "Use this ONLY when the user has explicitly asked you to send a message in the current turn. Draft the text with the user first; the confirm dialog is a safety net, not a replacement for drafting together." +
      SLACK_OUTPUT_DESCRIPTION_SUFFIX,
    promptSnippet:
      "Post a Slack message to a channel, DM, or thread with explicit user confirmation",
    promptGuidelines: [
      "Call slack_send ONLY after the user has explicitly asked, in the current turn, to send a message.",
      "Draft the message with the user in chat first. Do NOT surprise the user with a dialog; they should already know what you are about to send.",
      'Never add your own signatures, footers, or "via pi"-style markers to the message text. Send the text verbatim.',
      "Pass the text in Slack mrkdwn (*bold*, _italic_, <url|label>) if formatting is requested. Otherwise plain text is fine.",
      "For dms use action=dm with a user reference (email, @handle, or display name). Do NOT try to post to an IM channel ID via action=channel.",
      "For thread replies, pass action=thread with the parent channel reference in `to` and the parent message ts in `thread_ts`.",
    ],
    parameters: SlackSendParams,

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
      // We check up front so the user doesn't sit through recipient
      // resolution + a confirm dialog only to learn at chat.postMessage
      // time that a needed scope (im:write for dm, mpim:write for mpim,
      // chat:write.public for public-channel-without-membership) is
      // missing. The Slack-returned `needed` list in that case also
      // tends to be noisy (all four *:write scopes); our explicit
      // preflight produces a single, actionable line.
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
        return errorResult(error.error, error.needed, error.provided);
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

/** Action-aware scope gate. Action-less callers (legacy tests) can omit
 *  `action` and get only the base token-type + chat:write check; callers
 *  inside the tool pass their action so we can additionally require the
 *  narrower write scope Slack needs for DMs (im:write) and multi-party IMs
 *  (mpim:write).
 *
 *  Why not require chat:write.public for action=channel? Because we don't
 *  yet know whether the resolved channel is one the user is a member of.
 *  chat.postMessage to a channel the user is in only needs chat:write.
 *  chat:write.public is only needed for *public* channels they haven't
 *  joined — and we'd need to hit conversations.info first to tell.
 *  Runtime failure there is still normalized (not_in_channel → clear
 *  re-phrased error), so we let that path handle it instead of
 *  over-gating upfront.
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
  if (!hasScope("chat:write") && !hasScope("chat:write.public")) {
    return {
      content: [
        {
          type: "text",
          text:
            "slack_send needs chat:write (or chat:write.public) which this token does not have. " +
            "Re-run /login sf-slack to re-consent with chat:write granted.",
        },
      ],
      details: { ok: false, action: action || "send", reason: "missing_scope" },
    };
  }
  if (action === "dm" && !hasScope("im:write")) {
    // action=dm uses conversations.open which itself requires im:write — if
    // we don't surface this now, the resolve step runs, the confirm dialog
    // pops, and *then* the conversations.open call fails with a
    // multi-scope-sounding `missing_scope` error (needed lists all four
    // *:write scopes). Pre-empt that.
    return {
      content: [
        {
          type: "text",
          text:
            "slack_send action=dm needs the im:write scope to open a 1:1 DM, which this token does not have. " +
            "Re-run /login sf-slack to re-consent with im:write granted. " +
            "Alternatively, use action=channel with an existing DM channel ID (D...) that is already open.",
        },
      ],
      details: { ok: false, action, reason: "missing_scope" },
    };
  }
  return null;
}

// ─── Recipient routing ────────────────────────────────────────────────────────

interface RoutedRecipient {
  channelId: string;
  channelLabel?: string;
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

  // channel + thread share the same channel-resolution path. The HITL
  // helper takes care of raw-ID verification, fuzzy fallback, the
  // interactive select-or-type loop, and headless loud-failure — we no
  // longer short-circuit on isSlackChannelId() because that path used to
  // accept syntactically-valid-but-unverified IDs (live repro: a bogus
  // `C09ZZZZZZZZ` survived resolution and reached chat.postMessage).
  const confirmed = await requireConfirmedChannel(ctx, token, ref, signal);
  if (confirmed.ok && confirmed.recipient.type === "channel") {
    const { channel } = confirmed.recipient;
    return { channelId: channel.id, channelLabel: channel.name };
  }
  return channelConfirmationFailure(action, ref, confirmed);
}

async function routeDm(
  token: string,
  ref: string,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<RoutedRecipient | RouteFailure> {
  let userId: string | undefined;
  let displayName: string | undefined;

  if (isSlackUserId(ref)) {
    // Raw user IDs pass through — the DM-open step verifies the ID exists.
    // Display name stays undefined here; a cache hit in downstream rendering
    // will pick it up if available.
    userId = ref;
  } else {
    const confirmed = await requireConfirmedUser(ctx, token, ref, signal);
    if (!confirmed.ok) return userConfirmationFailure(ref, confirmed);
    const user = confirmed.recipient.type === "user" ? confirmed.recipient.user : null;
    if (!user || user.id === "me") {
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
    userId = user.id;
    displayName = user.displayName;
  }

  const opened = await conversationsOpenDM(token, [userId], signal);
  if (!opened.ok) {
    const error = opened as ApiErr;
    return {
      result: errorResult(error.error, error.needed, error.provided),
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
  return { channelId: im, channelLabel: displayName ? `@${displayName}` : undefined };
}

// Translate the HITL helper's ConfirmResult into a RouteFailure shaped like
// the rest of slack_send's error contract. Reasons flow through verbatim
// (cancelled, ambiguous_headless, not_found, headless_unverified) so the
// LLM's observation matches what the human experienced.
// The repo runs tsc with `strict: false`, which does not narrow
// discriminated unions on simple `if (x.ok) { ... }` guards. Use an
// Extract cast on the failure branch so we can read the failure fields
// without TS noise; the runtime `confirmed.ok` check above still
// guarantees correctness.
type RecipientFailure = Extract<RecipientConfirmResult, { ok: false }>;

function channelConfirmationFailure(
  action: string,
  ref: string,
  confirmed: RecipientConfirmResult,
): RouteFailure {
  if (confirmed.ok) {
    // Type-level guard: this branch shouldn't fire in practice because
    // callers only enter the failure path when confirmed.ok is false.
    return {
      result: {
        content: [
          { type: "text", text: `Unable to route channel "${ref}" — unexpected success state.` },
        ],
        details: { ok: false, action, reason: "channel_resolution_required", ref },
      },
    };
  }
  const failure = confirmed as RecipientFailure;
  return {
    result: {
      content: [{ type: "text", text: failure.message }],
      details: {
        ok: false,
        action,
        reason: failure.reason,
        ref,
        candidates: failure.candidates,
      },
    },
  };
}

function userConfirmationFailure(ref: string, confirmed: RecipientConfirmResult): RouteFailure {
  if (confirmed.ok) {
    return {
      result: {
        content: [
          { type: "text", text: `Unable to route user "${ref}" — unexpected success state.` },
        ],
        details: { ok: false, action: "dm", reason: "user_resolution_required", ref },
      },
    };
  }
  const failure = confirmed as RecipientFailure;
  return {
    result: {
      content: [{ type: "text", text: failure.message }],
      details: {
        ok: false,
        action: "dm",
        reason: failure.reason,
        ref,
        candidates: failure.candidates,
      },
    },
  };
}

// ─── Confirmation dialog ──────────────────────────────────────────────────────

interface ConfirmContext {
  action: "channel" | "dm" | "thread";
  channelId: string;
  channelLabel?: string;
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

  let currentText = initial.text;
  // Edit loop: user can repeatedly edit, then confirm or cancel.
  for (;;) {
    const preview = buildConfirmMessage({ ...initial, text: currentText });
    const confirmed = await ctx.ui.confirm("Send Slack message?", preview, {
      signal,
      timeout: CONFIRM_TIMEOUT_SECONDS * 1000,
    });
    if (!confirmed) {
      // Offer one edit pass before giving up, but only if the text contains
      // no mentions (mentions get their own re-confirm below).
      const choice = await ctx.ui.select("Cancelled. What next?", [
        "Cancel (do not send)",
        "Edit text and retry",
      ]);
      if (choice !== "Edit text and retry") {
        return cancelledResult(initial.action);
      }
      const edited = await ctx.ui.input("Edit message text", currentText);
      if (edited === undefined || !edited.trim()) {
        return cancelledResult(initial.action);
      }
      currentText = edited.trim();
      continue;
    }

    // Mention re-confirm (Recommendation #4 in the proposal).
    if (MENTION_PATTERN.test(currentText)) {
      const mentionOk = await ctx.ui.confirm(
        "⚠ This message contains @channel / @here / @everyone. Send anyway?",
        buildMentionWarning({ ...initial, text: currentText }),
        { signal, timeout: CONFIRM_TIMEOUT_SECONDS * 1000 },
      );
      if (!mentionOk) {
        return cancelledResult(initial.action);
      }
    }

    return { ok: true, text: currentText };
  }
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
    `Length: ${ctx.text.length} char${ctx.text.length === 1 ? "" : "s"}`,
    "",
    "--- Preview ---",
    body,
    "---",
    "",
    "Press Enter to send, Esc to cancel.",
  ].join("\n");
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
