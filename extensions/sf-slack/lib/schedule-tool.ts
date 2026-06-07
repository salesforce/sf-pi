/* SPDX-License-Identifier: Apache-2.0 */
/**
 * slack_schedule tool — public Slack Web API scheduled messages.
 *
 * This tool intentionally uses Slack's supported chat.* scheduled-message
 * endpoints instead of Slack's internal drafts APIs. Consequence: scheduled
 * messages are fully functional (visible through chat.scheduledMessages.list
 * and posted on time), but they are API queue items rather than Slack client
 * scheduled drafts, so they do not show in Drafts & sent → Scheduled.
 *
 * Safety rails mirror slack_send:
 *   - user-token + chat:write preflight
 *   - explicit confirmation before schedule/delete in interactive mode
 *   - headless refusal unless SLACK_ALLOW_HEADLESS_SEND=1
 *   - dry-run via SLACK_SEND_DRY_RUN=1 for action=schedule
 *   - audit trail via pi.appendEntry(SCHEDULE_ENTRY_TYPE, ...)
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  ENV_ALLOW_HEADLESS_SEND,
  ENV_SEND_DRY_RUN,
  SCHEDULE_ENTRY_TYPE,
  SlackScheduleParams,
  type ApiErr,
  type JsonCompatibleParams,
  type ScheduledMessage,
  type SlackScheduleAuditEntry,
} from "./types.ts";
import { requireAuth } from "./auth.ts";
import {
  chatDeleteScheduledMessage,
  chatScheduleMessage,
  chatScheduledMessagesList,
  errorResult,
  resolveChannelName,
} from "./api.ts";
import { preflightSend } from "./send-tool.ts";

const CONFIRM_TIMEOUT_SECONDS = 60;
const MAX_MESSAGE_LENGTH = 40_000;
const MIN_SCHEDULE_LEAD_SECONDS = 120;
const MAX_SCHEDULE_AHEAD_SECONDS = 120 * 24 * 60 * 60;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const CHANNEL_ID_PATTERN = /^[CDG][A-Z0-9]+$/;
const MENTION_PATTERN =
  /<!channel\b|<!here\b|<!everyone\b|<!subteam\b|@channel\b|@here\b|@everyone\b/i;

interface ScheduleToolCallArgs {
  action?: string;
  channel_id?: string;
  message?: string;
  post_at?: number;
  scheduled_message_id?: string;
}

interface ScheduleToolRenderResult {
  content?: unknown[];
  details?: {
    ok?: boolean;
    action?: string;
    channel?: string;
    channel_name?: string;
    scheduled_message_id?: string;
    post_at?: number;
    dry_run?: boolean;
    reason?: string;
  };
}

function callLabel(label: string, summary: string, theme: Theme): Text {
  return new Text(
    theme.fg("toolTitle", theme.bold(label + " ")) + theme.fg("muted", summary),
    0,
    0,
  );
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function previewBody(text: string | undefined, limit = 80): string {
  const single = (text || "").replace(/\s+/g, " ").trim();
  if (single.length <= limit) return single;
  return single.slice(0, limit - 1) + "…";
}

export function registerScheduleTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof SlackScheduleParams>({
    name: "slack_schedule",
    label: "Slack Schedule",
    description:
      "Schedule, list, or delete Slack messages using Slack's supported scheduled-message Web API. " +
      "Actions: schedule — queue a future post; list — list pending API-scheduled messages; delete — cancel a pending scheduled message. " +
      "Schedule/delete require explicit user confirmation; non-interactive sessions refuse unless SLACK_ALLOW_HEADLESS_SEND=1 is set. " +
      "Use this ONLY when the user explicitly asks for future Slack delivery or scheduled-message management.",
    promptSnippet: "Schedule, list, or cancel Slack messages",
    promptGuidelines: [
      "Call slack_schedule action:'schedule' ONLY when the user explicitly asks for future delivery or supplies a send time.",
      "Use slack_resolve first for fuzzy channel names, then pass the resolved C..., G..., or D... ID as channel_id.",
      "Scheduled messages use Slack's public chat.scheduleMessage API. They post on time and are visible through slack_schedule action:'list', but they are API queue items rather than Slack client scheduled drafts, so they do not show in Drafts & sent → Scheduled.",
      "For schedule/delete, do not add signatures, footers, or via-pi markers. Preserve the requested message text.",
      "For action:'delete', pass the scheduled_message_id returned by action:'schedule' or action:'list'.",
    ],
    parameters: SlackScheduleParams,
    prepareArguments(args): {
      action: "schedule" | "list" | "delete";
      channel_id?: string;
      message?: string;
      post_at?: number;
      thread_ts?: string;
      reply_broadcast?: boolean;
      scheduled_message_id?: string;
      oldest?: string;
      latest?: string;
      limit?: number;
      cursor?: string;
    } {
      if (!args || typeof args !== "object" || Array.isArray(args)) return args as never;
      const input = args as {
        channel?: unknown;
        channel_id?: unknown;
        text?: unknown;
        message?: unknown;
        scheduled_message_id?: unknown;
      };
      return {
        ...input,
        ...(input.channel_id === undefined && typeof input.channel === "string"
          ? { channel_id: input.channel }
          : {}),
        ...(input.message === undefined && typeof input.text === "string"
          ? { message: input.text }
          : {}),
      } as never;
    },

    renderCall(args: ScheduleToolCallArgs, theme: Theme) {
      const action = args.action || "schedule";
      if (action === "list") return callLabel("Slack Schedule", "list pending", theme);
      if (action === "delete") {
        return callLabel(
          "Slack Unschedule",
          `${args.channel_id || "?"} ${args.scheduled_message_id || "?"}`,
          theme,
        );
      }
      const when = args.post_at ? ` at ${formatUnixTime(args.post_at)}` : "";
      return callLabel(
        "Slack Schedule",
        `${args.channel_id || "?"}${when} — "${previewBody(args.message, 60)}"`,
        theme,
      );
    },

    renderResult(
      result: ScheduleToolRenderResult,
      opts: { expanded: boolean; isPartial: boolean },
      theme: Theme,
    ) {
      if (opts.isPartial) {
        return new Text(theme.fg("warning", "Slack schedule awaiting confirmation…"), 0, 0);
      }
      const details = result.details || {};
      if (!details.ok) {
        const line = getFirstText(result.content) || "Slack schedule failed";
        if (details.reason === "user_cancelled") {
          return new Text(theme.fg("muted", "✗ Slack schedule cancelled by user"), 0, 0);
        }
        return new Text(theme.fg("error", `✗ ${line}`), 0, 0);
      }
      if (details.action === "list") {
        return new Text(theme.fg("success", "✓ Listed scheduled messages"), 0, 0);
      }
      const dest = details.channel_name ? `#${details.channel_name}` : details.channel || "?";
      if (details.action === "delete") {
        return new Text(theme.fg("success", `✓ Cancelled scheduled message in ${dest}`), 0, 0);
      }
      const prefix = details.dry_run ? "✓ [dry-run] " : "✓ ";
      return new Text(
        theme.fg("success", prefix) +
          theme.fg("text", `Scheduled for `) +
          theme.fg("accent", dest) +
          (details.post_at ? theme.fg("dim", ` at ${formatUnixTime(details.post_at)}`) : "") +
          (details.scheduled_message_id
            ? theme.fg("dim", `\n  ${details.scheduled_message_id}`)
            : ""),
        0,
        0,
      );
    },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const auth = await requireAuth(ctx);
      if ("result" in auth) return auth.result;

      switch (params.action) {
        case "schedule":
          return scheduleMessage(pi, auth.token, params, signal, ctx);
        case "list":
          return listScheduledMessages(auth.token, params, signal);
        case "delete":
          return deleteScheduledMessage(pi, auth.token, params, signal, ctx);
        default:
          return {
            content: [{ type: "text" as const, text: "slack_schedule requires a valid action." }],
            details: { ok: false, action: params.action, reason: "invalid_action" },
          };
      }
    },
  });
}

async function scheduleMessage(
  pi: ExtensionAPI,
  token: string,
  params: {
    channel_id?: string;
    message?: string;
    post_at?: number;
    thread_ts?: string;
    reply_broadcast?: boolean;
  },
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
) {
  const preflight = preflightSend(token, "channel");
  if (preflight) return preflight;

  const channelId = (params.channel_id || "").trim();
  const channelError = validateChannelId(channelId, "schedule");
  if (channelError) return channelError;

  const text = (params.message || "").trim();
  if (!text) {
    return {
      content: [{ type: "text" as const, text: "action=schedule requires non-empty `message`." }],
      details: { ok: false, action: "schedule", reason: "missing_message" },
    };
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Message exceeds Slack's ${MAX_MESSAGE_LENGTH}-char limit (${text.length}). Shorten and retry.`,
        },
      ],
      details: { ok: false, action: "schedule", reason: "text_too_long" },
    };
  }

  const schedule = validatePostAt(params.post_at);
  if ("result" in schedule) return schedule.result;

  const channelName = await resolveChannelName(token, channelId, signal);
  const confirmation = await confirmWrite(
    ctx,
    "Schedule Slack message?",
    buildScheduleConfirmMessage({
      channelId,
      channelName,
      text,
      postAt: schedule.postAt,
      threadTs: params.thread_ts,
      replyBroadcast: params.reply_broadcast,
    }),
    "schedule",
    signal,
  );
  if (confirmation.ok === false) return confirmation.result;

  if (MENTION_PATTERN.test(text)) {
    const mentionOk = await confirmWrite(
      ctx,
      "⚠ This scheduled message contains @channel / @here / @everyone. Schedule anyway?",
      buildMentionWarning(channelName || channelId, text),
      "schedule",
      signal,
    );
    if (mentionOk.ok === false) return mentionOk.result;
  }

  if (process.env[ENV_SEND_DRY_RUN]?.trim() === "1") {
    await appendScheduleAuditEntry(pi, {
      ts: Date.now(),
      action: "schedule",
      channel: channelId,
      channel_name: channelName,
      text,
      post_at: schedule.postAt,
      thread_ts: params.thread_ts,
      reply_broadcast: params.reply_broadcast,
      dry_run: true,
    });
    return textResult(
      `[dry-run] Would schedule ${channelLabel(channelId, channelName)} at ${formatUnixTime(schedule.postAt)}:\n${text}`,
      {
        ok: true,
        action: "schedule",
        channel: channelId,
        channel_name: channelName,
        post_at: schedule.postAt,
        dry_run: true,
      },
    );
  }

  const body: JsonCompatibleParams = {
    channel: channelId,
    text,
    post_at: schedule.postAt,
  };
  if (params.thread_ts) {
    body.thread_ts = params.thread_ts;
    if (params.reply_broadcast) body.reply_broadcast = true;
  }

  const result = await chatScheduleMessage(token, body, signal);
  if (!result.ok) {
    const error = result as ApiErr;
    return errorResult(error.error, error.needed, error.provided, error.messages);
  }

  const scheduledMessageId = result.data.scheduled_message_id;
  await appendScheduleAuditEntry(pi, {
    ts: Date.now(),
    action: "schedule",
    channel: channelId,
    channel_name: channelName,
    text,
    post_at: schedule.postAt,
    thread_ts: params.thread_ts,
    reply_broadcast: params.reply_broadcast,
    scheduled_message_id: scheduledMessageId,
  });

  return textResult(
    [
      `Scheduled for ${channelLabel(channelId, channelName)} at ${formatUnixTime(schedule.postAt)}.`,
      scheduledMessageId ? `scheduled_message_id: ${scheduledMessageId}` : "",
      "Note: this is a functional API-scheduled message. It is visible through slack_schedule action='list' and will post on time, but it does not show in Slack's Drafts & sent → Scheduled UI.",
    ]
      .filter(Boolean)
      .join("\n"),
    {
      ok: true,
      action: "schedule",
      channel: channelId,
      channel_name: channelName,
      scheduled_message_id: scheduledMessageId,
      post_at: schedule.postAt,
    },
  );
}

async function listScheduledMessages(
  token: string,
  params: {
    channel_id?: string;
    oldest?: string;
    latest?: string;
    limit?: number;
    cursor?: string;
  },
  signal: AbortSignal | undefined,
) {
  const body: JsonCompatibleParams = {};
  const channelId = params.channel_id?.trim();
  if (channelId) {
    const channelError = validateChannelId(channelId, "list");
    if (channelError) return channelError;
    body.channel = channelId;
  }
  if (params.oldest) body.oldest = params.oldest;
  if (params.latest) body.latest = params.latest;
  if (params.cursor) body.cursor = params.cursor;
  body.limit = clampLimit(params.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);

  const result = await chatScheduledMessagesList(token, body, signal);
  if (!result.ok) {
    const error = result as ApiErr;
    return errorResult(error.error, error.needed, error.provided, error.messages);
  }

  const messages = Array.isArray(result.data.scheduled_messages)
    ? result.data.scheduled_messages
    : [];
  const lines = [
    `Scheduled messages (${messages.length}):`,
    "",
    ...messages.map(formatScheduledMessage),
  ];
  if (messages.length === 0) lines.push("(none)");
  const cursor = result.data.response_metadata?.next_cursor;
  if (cursor) lines.push("", `next_cursor: ${cursor}`);

  return textResult(lines.join("\n"), {
    ok: true,
    action: "list",
    count: messages.length,
    next_cursor: cursor,
  });
}

async function deleteScheduledMessage(
  pi: ExtensionAPI,
  token: string,
  params: { channel_id?: string; scheduled_message_id?: string },
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
) {
  const preflight = preflightSend(token, "channel");
  if (preflight) return preflight;

  const channelId = (params.channel_id || "").trim();
  const channelError = validateChannelId(channelId, "delete");
  if (channelError) return channelError;

  const scheduledMessageId = (params.scheduled_message_id || "").trim();
  if (!scheduledMessageId) {
    return {
      content: [
        {
          type: "text" as const,
          text: "action=delete requires `scheduled_message_id` from action=schedule or action=list.",
        },
      ],
      details: { ok: false, action: "delete", reason: "missing_scheduled_message_id" },
    };
  }

  const channelName = await resolveChannelName(token, channelId, signal);
  const confirmation = await confirmWrite(
    ctx,
    "Delete scheduled Slack message?",
    [
      `Channel: ${channelLabel(channelId, channelName)}`,
      `Scheduled message ID: ${scheduledMessageId}`,
      "",
      "This cancels the pending API-scheduled message if Slack still allows deletion.",
      "Press Enter to delete, Esc to cancel.",
    ].join("\n"),
    "delete",
    signal,
  );
  if (confirmation.ok === false) return confirmation.result;

  const result = await chatDeleteScheduledMessage(
    token,
    { channel: channelId, scheduled_message_id: scheduledMessageId },
    signal,
  );
  if (!result.ok) {
    const error = result as ApiErr;
    return errorResult(error.error, error.needed, error.provided, error.messages);
  }

  await appendScheduleAuditEntry(pi, {
    ts: Date.now(),
    action: "delete",
    channel: channelId,
    channel_name: channelName,
    scheduled_message_id: scheduledMessageId,
  });

  return textResult(
    `Cancelled scheduled message ${scheduledMessageId} in ${channelLabel(channelId, channelName)}.`,
    {
      ok: true,
      action: "delete",
      channel: channelId,
      channel_name: channelName,
      scheduled_message_id: scheduledMessageId,
    },
  );
}

function validateChannelId(channelId: string, action: "schedule" | "list" | "delete") {
  if (!channelId) {
    return {
      content: [
        {
          type: "text" as const,
          text: `action=${action} requires channel_id. Use slack_resolve first for fuzzy channel names.`,
        },
      ],
      details: { ok: false, action, reason: "missing_channel_id" },
    };
  }
  if (!CHANNEL_ID_PATTERN.test(channelId)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `channel_id must be a Slack conversation ID (C..., G..., or D...), got "${channelId}". Use slack_resolve first for fuzzy names.`,
        },
      ],
      details: { ok: false, action, reason: "invalid_channel_id" },
    };
  }
  return null;
}

function validatePostAt(postAt: number | undefined):
  | { postAt: number }
  | {
      result: {
        content: { type: "text"; text: string }[];
        details: Record<string, unknown>;
      };
    } {
  if (postAt === undefined) {
    return {
      result: {
        content: [{ type: "text", text: "action=schedule requires `post_at` Unix timestamp." }],
        details: { ok: false, action: "schedule", reason: "missing_post_at" },
      },
    };
  }
  if (!Number.isFinite(postAt)) {
    return {
      result: {
        content: [{ type: "text", text: "post_at must be a finite Unix timestamp in seconds." }],
        details: { ok: false, action: "schedule", reason: "invalid_post_at" },
      },
    };
  }
  if (postAt > 10_000_000_000) {
    return {
      result: {
        content: [
          {
            type: "text",
            text: "post_at looks like milliseconds. Pass Unix timestamp in seconds.",
          },
        ],
        details: { ok: false, action: "schedule", reason: "post_at_milliseconds" },
      },
    };
  }

  const rounded = Math.floor(postAt);
  const now = Math.floor(Date.now() / 1000);
  if (rounded < now + MIN_SCHEDULE_LEAD_SECONDS) {
    return {
      result: {
        content: [
          {
            type: "text",
            text: `post_at must be at least ${MIN_SCHEDULE_LEAD_SECONDS} seconds in the future.`,
          },
        ],
        details: { ok: false, action: "schedule", reason: "post_at_too_soon" },
      },
    };
  }
  if (rounded > now + MAX_SCHEDULE_AHEAD_SECONDS) {
    return {
      result: {
        content: [
          {
            type: "text",
            text: "post_at is too far in the future. Slack supports scheduling up to 120 days out.",
          },
        ],
        details: { ok: false, action: "schedule", reason: "post_at_too_far" },
      },
    };
  }

  return { postAt: rounded };
}

type ConfirmResult =
  | { ok: true }
  | {
      ok: false;
      result: {
        content: { type: "text"; text: string }[];
        details: Record<string, unknown>;
      };
    };

async function confirmWrite(
  ctx: ExtensionContext,
  title: string,
  body: string,
  action: "schedule" | "delete",
  signal?: AbortSignal,
): Promise<ConfirmResult> {
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
                "slack_schedule refuses to run write actions without an interactive confirmation dialog. " +
                `Export ${ENV_ALLOW_HEADLESS_SEND}=1 to allow schedule/delete in non-interactive sessions, or run pi interactively so the dialog can be shown.`,
            },
          ],
          details: { ok: false, action, reason: "headless_refused" },
        },
      };
    }
    ctx.ui.notify(`slack_schedule (headless): ${action}`, "info");
    return { ok: true };
  }

  const confirmed = await ctx.ui.confirm(title, body, {
    signal,
    timeout: CONFIRM_TIMEOUT_SECONDS * 1000,
  });
  if (confirmed) return { ok: true };
  return {
    ok: false,
    result: {
      content: [{ type: "text" as const, text: "Slack schedule action cancelled by user." }],
      details: { ok: false, action, reason: "user_cancelled" },
    },
  };
}

function buildScheduleConfirmMessage(input: {
  channelId: string;
  channelName?: string;
  text: string;
  postAt: number;
  threadTs?: string;
  replyBroadcast?: boolean;
}): string {
  const body = input.text.length > 600 ? input.text.slice(0, 600) + "…" : input.text;
  return [
    `To: ${channelLabel(input.channelId, input.channelName)}`,
    `Post at: ${formatUnixTime(input.postAt)}`,
    input.threadTs ? `Thread: ${input.threadTs}` : "",
    input.replyBroadcast ? "Reply broadcast: true" : "",
    `Length: ${input.text.length} char${input.text.length === 1 ? "" : "s"}`,
    "",
    "--- Preview ---",
    body,
    "---",
    "",
    "Note: this is a functional API-scheduled message. It is visible through slack_schedule action='list' and will post on time, but it does not show in Slack's Drafts & sent → Scheduled UI.",
    "Press Enter to schedule, Esc to cancel.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function buildMentionWarning(destination: string, text: string): string {
  return [
    `This scheduled message would notify every member of ${destination}.`,
    "",
    "--- Text ---",
    text.length > 400 ? text.slice(0, 400) + "…" : text,
    "---",
    "",
    "Confirm the wide-broadcast intent before proceeding.",
  ].join("\n");
}

function formatScheduledMessage(message: ScheduledMessage): string {
  const id = message.id || "unknown-id";
  const channel = message.channel_id || "unknown-channel";
  const postAt = Number(message.post_at);
  const time = Number.isFinite(postAt) ? formatUnixTime(postAt) : String(message.post_at || "?");
  const text = previewBody(message.text, 120);
  return `- ${id} — ${channel} at ${time}${text ? ` — ${text}` : ""}`;
}

function channelLabel(channelId: string, channelName: string | undefined): string {
  return channelName && channelName !== channelId ? `#${channelName} (${channelId})` : channelId;
}

function formatUnixTime(value: number): string {
  return new Date(value * 1000).toISOString();
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function textResult(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

async function appendScheduleAuditEntry(
  pi: ExtensionAPI,
  entry: SlackScheduleAuditEntry,
): Promise<void> {
  try {
    pi.appendEntry<SlackScheduleAuditEntry>(SCHEDULE_ENTRY_TYPE, entry);
  } catch {
    // Audit must never block a real Slack write.
  }
}
