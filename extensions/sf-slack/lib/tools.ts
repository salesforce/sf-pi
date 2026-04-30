/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Slack tool registration for sf-slack.
 *
 * Registers the core read-only `slack` tool with actions:
 * - search
 * - thread
 * - history
 * - permalink
 * - auth
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  SlackParams,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_HISTORY_LIMIT,
  type ApiErr,
  type AssistantSearchContextResponse,
  type ChatGetPermalinkResponse,
  type ConversationsHistoryResponse,
  type ConversationsRepliesResponse,
  type SearchMessagesResponse,
  type SlackMessage,
  type SlackSearchMatch,
} from "./types.ts";
import { requireAuth } from "./auth.ts";
import {
  slackApi,
  slackApiJson,
  clampLimit,
  getTeamId,
  errorResult,
  resolveChannelName,
  getUserCache,
  warmUserCacheForIds,
  warmChannelCacheFromMatches,
  DEFAULT_ASSISTANT_CHANNEL_TYPES,
} from "./api.ts";
import {
  formatSearchResults,
  formatMessages,
  extractStructuredMatches,
  extractStructuredMessages,
  buildAuthStatus,
} from "./format.ts";
import { renderCall, renderResult } from "./render.ts";
import { buildSlackTextResult, SLACK_OUTPUT_DESCRIPTION_SUFFIX } from "./truncation.ts";
import { requireConfirmedChannel } from "./recipient-confirm.ts";
import type { FieldsMode } from "./format.ts";
import { readEffectiveSfPiDisplaySettings } from "../../../lib/common/display/settings.ts";
import type { SfPiDisplayProfile } from "../../../lib/common/display/types.ts";
import { getPreferences } from "./preferences.ts";
import { recordSample } from "./stats.ts";

/** Map shared display verbosity to Slack body detail. */
function fieldsForDisplayProfile(profile: SfPiDisplayProfile): FieldsMode {
  switch (profile) {
    case "compact":
      return "summary";
    case "verbose":
      return "full";
    case "balanced":
    default:
      return "preview";
  }
}

/** Resolve the effective body-detail mode for this call.
 *  Explicit param > Slack preference > shared /sf-pi display profile. */
function resolveFields(explicit: string | undefined, cwd: string): FieldsMode {
  if (explicit === "summary" || explicit === "preview" || explicit === "full") {
    return explicit;
  }

  const preference = getPreferences().defaultFields;
  if (preference !== "auto") {
    return preference;
  }

  return fieldsForDisplayProfile(readEffectiveSfPiDisplaySettings(cwd).profile);
}

/** Approximate wire size of a tool text result, for the research widget. */
function textBytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function registerSlackTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof SlackParams>({
    name: "slack",
    label: "Slack",
    description:
      "Search and read Slack messages. " +
      "Actions: search — find messages by keyword/query. thread — fetch thread replies. " +
      "history — fetch channel messages with time range. permalink — get a durable message URL. " +
      "auth — check auth configuration status." +
      SLACK_OUTPUT_DESCRIPTION_SUFFIX,
    promptSnippet:
      "Search Slack messages, fetch threads, browse channel history, and get permalinks",
    // This tool is always active when sf-slack is enabled, so it owns the cross-tool
    // routing guidance. Other Slack tools keep their guidelines focused on their own
    // parameters so the flat Guidelines section does not repeat the same routing rule.
    promptGuidelines: [
      "All Slack tools are read-only except slack_canvas create/edit. No message posting.",
      "If auth fails for any Slack tool, tell the user to run `/login sf-slack` (recommended), use macOS Keychain, or set SLACK_USER_TOKEN.",
      "Prefer slack_research for natural-language Slack research: it compiles operators, resolves channels, and falls back strict→broad. Do not hand-roll Slack search queries when slack_research can run the plan.",
      "Use slack_resolve to turn a fuzzy channel or person reference into a Slack ID before calling slack/slack_channel/slack_file/slack_user.",
      "Use slack_time_range first for any relative or human date expression, then pass the returned oldest/latest to slack action:'history', or since/before to slack_research.",
      "Use slack action:'search' only when you already have a ready-to-run Slack query. Use action:'thread' when search results show reply_count > 0 — threads carry the most context. Use action:'history' with oldest/latest for chronological browsing.",
      'Start discovery with `fields: "preview"` (default) or `fields: "summary"` to save tokens. ' +
        "Escalate to `fields: \"full\"` or follow up with action:'thread' only on the messages that matter. reply_count is returned in every mode — use it to triage.",
      "Slack user and channel IDs are resolved to display names automatically; do NOT pass resolve_users:true unless you specifically need a network round-trip for missing IDs.",
    ],
    parameters: SlackParams,
    renderCall,
    renderResult,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const action = params.action;

      if (action === "auth") {
        return {
          content: [{ type: "text", text: await buildAuthStatus(ctx) }],
          details: { ok: true, action, provider: "sf-slack" },
        };
      }

      const auth = await requireAuth(ctx);
      if ("result" in auth) return auth.result;

      if (action === "search") {
        if (!params.query) {
          return {
            content: [
              { type: "text", text: 'The "search" action requires the "query" parameter.' },
            ],
            details: { ok: false, action, reason: "missing_query" },
          };
        }

        const assistantParams: Record<string, string | number> = {
          query: params.query,
          count: clampLimit(params.limit, DEFAULT_SEARCH_LIMIT, 20),
          // Include DMs and multi-party IMs by default — Slack's default for
          // assistant.search.context is public+private channels only, which
          // silently hides DM content from search.
          channel_types: DEFAULT_ASSISTANT_CHANNEL_TYPES,
        };
        const teamId = getTeamId();
        if (teamId) assistantParams.team_id = teamId;

        const assistantResult = await slackApiJson<AssistantSearchContextResponse>(
          "assistant.search.context",
          auth.token,
          assistantParams,
          signal,
        );

        if (assistantResult.ok) {
          const matches = Array.isArray(assistantResult.data.results?.messages)
            ? assistantResult.data.results.messages
            : [];
          return buildSearchSuccessResult(
            action,
            params.query,
            "assistant.search.context",
            matches,
            resolveFields(params.fields, ctx.cwd),
            auth.token,
            signal,
          );
        }

        const result = await slackApi<SearchMessagesResponse>(
          "search.messages",
          auth.token,
          {
            query: params.query,
            count: clampLimit(params.limit, DEFAULT_SEARCH_LIMIT, 20),
          },
          signal,
        );

        if (!result.ok) {
          const error = result as ApiErr;
          return errorResult(error.error, error.needed, error.provided);
        }

        const matches = Array.isArray(result.data.messages?.matches)
          ? result.data.messages.matches
          : [];
        return buildSearchSuccessResult(
          action,
          params.query,
          "search.messages",
          matches,
          resolveFields(params.fields, ctx.cwd),
          auth.token,
          signal,
        );
      }

      if (action === "thread") {
        if (!params.channel || !params.ts) {
          return {
            content: [
              { type: "text", text: 'The "thread" action requires "channel" and "ts" parameters.' },
            ],
            details: { ok: false, action, reason: "missing_params" },
          };
        }

        const resolvedChannel = await resolveChannelParam(ctx, auth.token, params.channel, signal);
        if ("result" in resolvedChannel) return resolvedChannel.result;

        const apiParams: Record<string, string | number | undefined> = {
          channel: resolvedChannel.id,
          ts: params.ts,
          limit: clampLimit(params.limit, DEFAULT_HISTORY_LIMIT, 200),
        };
        if (params.cursor) apiParams.cursor = params.cursor;

        const result = await slackApi<ConversationsRepliesResponse>(
          "conversations.replies",
          auth.token,
          apiParams,
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          return errorResult(error.error, error.needed, error.provided);
        }

        const messages = Array.isArray(result.data.messages) ? result.data.messages : [];
        const hasMore = result.data.has_more === true;
        const nextCursor = result.data.response_metadata?.next_cursor || undefined;
        // Always try to resolve author names from the pre-warmed cache;
        // only hit the network (users.info) if the LLM explicitly asked.
        const userNames = await maybeResolveUserNames(
          auth.token,
          params.resolve_users,
          messages,
          signal,
        );
        // Best-effort channel name resolution for the render header.
        // Fire-and-forget: failures are cached as the raw ID so we don't retry.
        void resolveChannelName(auth.token, resolvedChannel.id, signal).catch(() => {});

        const fields = resolveFields(params.fields, ctx.cwd);
        let text = formatMessages(messages, userNames, fields);
        if (hasMore && nextCursor) {
          text += `\n\n--- More replies available. Use cursor: "${nextCursor}" to fetch the next page. ---`;
        }

        recordSample({ action, messageCount: messages.length, bytes: textBytes(text) });
        return buildSlackTextResult(
          text,
          {
            ok: true,
            action,
            count: messages.length,
            channel: resolvedChannel.id,
            channel_ref: params.channel,
            ts: params.ts,
            has_more: hasMore,
            next_cursor: nextCursor,
            fields,
            messages: extractStructuredMessages(messages, userNames),
          },
          { prefix: "pi-slack-thread" },
        );
      }

      if (action === "history") {
        if (!params.channel) {
          return {
            content: [
              { type: "text", text: 'The "history" action requires the "channel" parameter.' },
            ],
            details: { ok: false, action, reason: "missing_channel" },
          };
        }

        const resolvedChannel = await resolveChannelParam(ctx, auth.token, params.channel, signal);
        if ("result" in resolvedChannel) return resolvedChannel.result;

        const apiParams: Record<string, string | number | undefined> = {
          channel: resolvedChannel.id,
          limit: clampLimit(params.limit, DEFAULT_HISTORY_LIMIT, 200),
        };
        if (params.latest) apiParams.latest = params.latest;
        if (params.oldest) apiParams.oldest = params.oldest;
        if (params.cursor) apiParams.cursor = params.cursor;

        const result = await slackApi<ConversationsHistoryResponse>(
          "conversations.history",
          auth.token,
          apiParams,
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          return errorResult(error.error, error.needed, error.provided);
        }

        const messages = Array.isArray(result.data.messages) ? result.data.messages : [];
        const hasMore = result.data.has_more === true;
        const nextCursor = result.data.response_metadata?.next_cursor || undefined;
        const userNames = await maybeResolveUserNames(
          auth.token,
          params.resolve_users,
          messages,
          signal,
        );
        void resolveChannelName(auth.token, resolvedChannel.id, signal).catch(() => {});

        const fields = resolveFields(params.fields, ctx.cwd);
        let text = formatMessages(messages, userNames, fields);
        if (hasMore && nextCursor) {
          text += `\n\n--- More messages available. Use cursor: "${nextCursor}" to fetch the next page. ---`;
        }

        recordSample({ action, messageCount: messages.length, bytes: textBytes(text) });
        return buildSlackTextResult(
          text,
          {
            ok: true,
            action,
            count: messages.length,
            channel: resolvedChannel.id,
            channel_ref: params.channel,
            has_more: hasMore,
            next_cursor: nextCursor,
            fields,
            messages: extractStructuredMessages(messages, userNames),
          },
          { prefix: "pi-slack-history" },
        );
      }

      if (action === "permalink") {
        if (!params.channel || !params.ts) {
          return {
            content: [
              {
                type: "text",
                text: 'The "permalink" action requires "channel" and "ts" parameters.',
              },
            ],
            details: { ok: false, action, reason: "missing_params" },
          };
        }

        const resolvedChannel = await resolveChannelParam(ctx, auth.token, params.channel, signal);
        if ("result" in resolvedChannel) return resolvedChannel.result;

        const result = await slackApi<ChatGetPermalinkResponse>(
          "chat.getPermalink",
          auth.token,
          {
            channel: resolvedChannel.id,
            message_ts: params.ts,
          },
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          return errorResult(error.error, error.needed, error.provided);
        }

        const permalink = result.data.permalink || "No permalink returned.";
        recordSample({ action, messageCount: 1, bytes: textBytes(String(permalink)) });
        return buildSlackTextResult(
          String(permalink),
          { ok: true, action, permalink },
          {
            prefix: "pi-slack-permalink",
          },
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `Unknown action: "${action}". Use one of: search, thread, history, permalink, auth.`,
          },
        ],
        details: { ok: false, action, reason: "unknown_action" },
      };
    },
  });
}

// Unified channel-ref resolution for slack action=thread/history/permalink.
// Delegates to the HITL helper so raw-ID verification, fuzzy fallback, the
// select-or-type dialog, and headless loud-failure all behave the same way
// here as in slack_send. Previously this function used a permissive 0.60
// threshold and short-circuited on isSlackChannelId() — both of those
// behaviors were bugs per the chaos-test findings.
async function resolveChannelParam(
  ctx: ExtensionContext,
  token: string,
  channel: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; id: string }
  | {
      ok: false;
      result: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> };
    }
> {
  const confirmed = await requireConfirmedChannel(ctx, token, channel, signal);
  if (confirmed.ok && confirmed.recipient.type === "channel") {
    return { ok: true, id: confirmed.recipient.channel.id };
  }
  const failure = confirmed as Extract<typeof confirmed, { ok: false }>;
  return {
    ok: false,
    result: {
      content: [{ type: "text", text: failure.message }],
      details: {
        ok: false,
        reason: failure.reason,
        channel_ref: channel,
        candidates: failure.candidates,
      },
    },
  };
}

async function buildSearchSuccessResult(
  action: string,
  query: string,
  api: string,
  matches: SlackSearchMatch[],
  fields: FieldsMode,
  token: string,
  signal?: AbortSignal,
) {
  // Warm the shared user cache for every author and <@UID> mention in the
  // hits so formatSearchResults / extractStructuredMatches (both of which
  // call resolveUserMentionsInText) surface display names instead of IDs.
  await warmUserCacheForMatches(token, matches, signal);

  // Also harvest {channel_id → channel_name} from every hit so a follow-up
  // slack action:'thread' / 'history' / 'permalink' on any returned ID can
  // resolve via cache_by_id and skip the HITL dialog entirely.
  warmChannelCacheFromMatches(matches);

  const text = formatSearchResults(matches, fields);
  recordSample({ action: "search", messageCount: matches.length, bytes: textBytes(text) });

  return buildSlackTextResult(
    text,
    {
      ok: true,
      action,
      count: matches.length,
      api,
      query,
      fields,
      matches: extractStructuredMatches(matches),
    },
    { prefix: "pi-slack-search" },
  );
}

async function maybeResolveUserNames(
  token: string,
  _resolveUsers: boolean | undefined,
  messages: SlackMessage[],
  signal?: AbortSignal,
): Promise<Map<string, string> | undefined> {
  if (messages.length === 0) {
    return undefined;
  }

  // Collect *every* user ID that will show up in rendered output:
  //   1. author IDs on each message
  //   2. <@UID> mentions inside message bodies
  // Both sets need to be resolved so nothing surfaces as a raw ID.
  const allIds = new Set<string>();
  for (const message of messages) {
    if (message.user) allIds.add(message.user);
    const body = message.text || "";
    const mentionMatches = body.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g);
    for (const match of mentionMatches) {
      allIds.add(match[1]);
    }
  }

  if (allIds.size === 0) return undefined;

  // Warm the shared cache for any IDs that aren't already there. This also
  // lets the render-path mention resolver (resolveUserMentionsInText) pick
  // them up for free, since it reads from the same cache.
  await warmUserCacheForIds(token, Array.from(allIds), signal);

  // Build the author-only map the callers expect. The caller uses this for
  // the `author:` column in the rendered output; mentions inside text are
  // resolved separately by the format/render layer.
  const cache = getUserCache();
  const resolved = new Map<string, string>();
  for (const message of messages) {
    const id = message.user;
    if (!id) continue;
    const name = cache.get(id);
    if (name) resolved.set(id, name);
  }

  return resolved.size > 0 ? resolved : undefined;
}

/** Pre-warm the user cache for every ID that appears as author or mention
 *  inside the given search matches, so the render path surfaces names. */
async function warmUserCacheForMatches(
  token: string,
  matches: SlackSearchMatch[],
  signal?: AbortSignal,
): Promise<void> {
  if (matches.length === 0) return;
  const allIds = new Set<string>();
  for (const match of matches) {
    const author = match.user || match.author_user_id;
    if (author) allIds.add(author);
    const body = match.text || match.content || "";
    const mentionMatches = body.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g);
    for (const m of mentionMatches) {
      allIds.add(m[1]);
    }
  }
  if (allIds.size === 0) return;
  await warmUserCacheForIds(token, Array.from(allIds), signal);
}
