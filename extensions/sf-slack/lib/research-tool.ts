/* SPDX-License-Identifier: Apache-2.0 */
/**
 * slack_research tool — high-level agentic Slack search.
 *
 * Builds an operator-aware query plan, executes strict→relaxed searches, and
 * optionally fetches thread context for high-signal matches.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
  SlackResearchParams,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_HISTORY_LIMIT,
  type AssistantSearchContextResponse,
  type ConversationsRepliesResponse,
  type SearchMessagesResponse,
  type SlackMessage,
  type SlackSearchMatch,
  type ResolvedChannel,
} from "./types.ts";
import { requireAuth } from "./auth.ts";
import {
  slackApi,
  slackApiJson,
  clampLimit,
  getTeamId,
  warmUserCacheForIds,
  warmChannelCacheFromMatches,
  getUserCache,
  DEFAULT_ASSISTANT_CHANNEL_TYPES,
} from "./api.ts";
import {
  formatMessages,
  formatSearchResults,
  extractStructuredMatches,
  extractStructuredMessages,
  type FieldsMode,
} from "./format.ts";
import { buildSlackSearchPlan, type SlackResearchInput } from "./search-plan.ts";
import { requireConfirmedChannel } from "./recipient-confirm.ts";
import { buildSlackTextResult, SLACK_OUTPUT_DESCRIPTION_SUFFIX } from "./truncation.ts";
import type { ApiErr } from "./types.ts";

interface ResearchToolCallArgs {
  task?: string;
  query?: string;
  channel_ref?: string;
  from_ref?: string;
  since?: string;
  include_threads?: boolean;
}

interface ResearchToolRenderResult {
  content?: unknown[];
  details?: {
    ok?: boolean;
    count?: number;
    queries?: string[];
    thread_count?: number;
  };
}

interface ThreadBundle {
  channel: string;
  ts: string;
  messages: SlackMessage[];
}

function callLabel(label: string, summary: string, theme: Theme): Text {
  return new Text(
    theme.fg("toolTitle", theme.bold(label + " ")) + theme.fg("muted", summary),
    0,
    0,
  );
}

export function registerResearchTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof SlackResearchParams>({
    name: "slack_research",
    label: "Slack Research",
    description:
      "Agentic Slack research. Builds correct Slack search operators from intent, executes strict-to-broad fallback queries, dedupes results, and can fetch thread context." +
      SLACK_OUTPUT_DESCRIPTION_SUFFIX,
    promptSnippet:
      "Run operator-aware Slack research from natural-language intent with strict-to-broad fallbacks",
    // Cross-tool routing lives on the `slack` tool (single owner). The guidelines here
    // document slack_research's own parameter surface and the Slack operator syntax it
    // compiles — so the LLM sees operator syntax only when slack_research is actually
    // active, rather than bleeding into every Slack tool's guideline block.
    promptGuidelines: [
      "Pass channel_ref/from_ref/with_ref/since/before/during/content_filters/reaction_names/thread_only to slack_research; it compiles them to Slack's `in:#channel`, `from:@Name`, `with:@Name`, `after:YYYY-MM-DD`, `before:YYYY-MM-DD`, `during:`, `has:link|file|pin|reaction`, `has::emoji:`, and `is:thread` operators.",
      "If slack_research cannot confidently resolve channel_ref, it asks for clarification or returns candidates — it will not silently broaden to a workspace-wide search. Pick from the returned candidates or supply the exact channel name/ID.",
      "Use `query` for free-text intent. Exact phrases in quotes are preserved. Use strategy:'broad' only when the strict plan returned too few results; default strict_then_broaden is almost always correct.",
      "Set include_threads:true to pull full replies for matching threaded results in a single call — cheaper than a follow-up slack action:'thread' loop when you need discussion context.",
    ],
    parameters: SlackResearchParams,

    renderCall(args: ResearchToolCallArgs, theme: Theme) {
      const bits = [args.task || "search", args.query ? `"${args.query}"` : "?"];
      if (args.channel_ref) bits.push(`in ${args.channel_ref}`);
      if (args.from_ref) bits.push(`from ${args.from_ref}`);
      if (args.since) bits.push(`since ${args.since}`);
      if (args.include_threads) bits.push("+threads");
      return callLabel("Slack Research", bits.join(" · "), theme);
    },

    renderResult(result: ResearchToolRenderResult, _opts, theme: Theme) {
      const details = result.details || {};
      if (!details.ok) {
        return new Text(
          theme.fg("error", "✗ " + (getFirstText(result.content) || "Slack research failed")),
          0,
          0,
        );
      }
      const count = details.count || 0;
      const queryCount = details.queries?.length || 0;
      const threadCount = details.thread_count || 0;
      let text = theme.fg("success", `✓ ${count} result${count === 1 ? "" : "s"}`);
      text += theme.fg("dim", ` via ${queryCount} quer${queryCount === 1 ? "y" : "ies"}`);
      if (threadCount > 0)
        text += theme.fg("accent", ` · ${threadCount} thread${threadCount === 1 ? "" : "s"}`);
      return new Text(text, 0, 0);
    },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const auth = await requireAuth(ctx);
      if ("result" in auth) return auth.result;

      const input = params as SlackResearchInput;
      const fields = resolveFields(input.fields);
      const limit = clampLimit(input.limit, DEFAULT_SEARCH_LIMIT, 20);
      const maxQueries = clampLimit(input.max_queries, 3, 6);
      const channelResolution = await resolveRequiredChannel(auth.token, input, signal, ctx);
      if ("result" in channelResolution) return channelResolution.result;

      const plan = await buildSlackSearchPlan(auth.token, input, signal, {
        resolved: channelResolution.channel ? { channel: channelResolution.channel } : undefined,
      });
      const candidateQueries = [plan.primary, ...plan.fallbacks]
        .filter(Boolean)
        .slice(0, maxQueries);

      if (candidateQueries.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No Slack search query could be built from the provided research intent.",
            },
          ],
          details: { ok: false, action: "research", reason: "empty_plan", plan },
        };
      }

      const executedQueries: string[] = [];
      const unique = new Map<string, SlackSearchMatch>();
      const queryCounts: Array<{ query: string; count: number; api: string }> = [];

      for (const query of candidateQueries) {
        const search = await runSearch(auth.token, query, limit, signal);
        executedQueries.push(query);
        queryCounts.push({ query, count: search.matches.length, api: search.api });
        // Harvest {channel_id → channel_name} from every hit into the shared
        // cache so a follow-up slack action:'history' / 'thread' on any of
        // these IDs short-circuits via cache_by_id and never prompts.
        warmChannelCacheFromMatches(search.matches);
        for (const match of search.matches) {
          const key =
            match.permalink ||
            `${match.channel_id || match.channel?.id || "unknown"}:${match.ts || match.message_ts || ""}:${match.text || match.content || ""}`;
          if (!unique.has(key)) unique.set(key, match);
        }
        if (unique.size >= limit) break;
        if (
          search.matches.length >= Math.max(3, Math.floor(limit / 2)) &&
          input.strategy !== "broad"
        )
          break;
      }

      const matches = Array.from(unique.values()).slice(0, limit);
      await warmUsersForMatches(auth.token, matches, signal);

      const threads = input.include_threads
        ? await fetchThreadsForMatches(auth.token, matches, signal)
        : [];

      const text = buildResearchText({
        planExplanation: plan.explanation,
        queryCounts,
        matches,
        threads,
        fields,
      });

      return buildSlackTextResult(
        text,
        {
          ok: true,
          action: "research",
          count: matches.length,
          thread_count: threads.length,
          plan,
          queries: executedQueries,
          query_counts: queryCounts,
          fields,
          matches: extractStructuredMatches(matches),
          threads: threads.map((thread) => ({
            channel: thread.channel,
            ts: thread.ts,
            messages: extractStructuredMessages(thread.messages, userNameMap(thread.messages)),
          })),
        },
        { prefix: "pi-slack-research" },
      );
    },
  });
}

// slack_research is scoped to a user-named channel_ref. Delegate to the
// shared HITL helper so the dialog flow matches every other workflow —
// including the 'Type exact name/ID' escape hatch, infinite retry loop,
// and headless loud-failure.
async function resolveRequiredChannel(
  token: string,
  input: SlackResearchInput,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<
  | { channel?: ResolvedChannel }
  | { result: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } }
> {
  const channelRef = input.channel_ref?.trim();
  if (!channelRef) return {};

  const confirmed = await requireConfirmedChannel(ctx, token, channelRef, signal);
  if (confirmed.ok && confirmed.recipient.type === "channel") {
    return { channel: confirmed.recipient.channel };
  }
  const failure = confirmed as Extract<typeof confirmed, { ok: false }>;
  return { result: buildChannelClarificationResult(channelRef, failure) };
}

function buildChannelClarificationResult(
  channelRef: string,
  failure: { reason: string; message: string; candidates: (ResolvedChannel | unknown)[] },
): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  return {
    content: [
      {
        type: "text",
        text:
          `Could not confidently resolve Slack channel_ref "${channelRef}". ` +
          "I did not run a broad workspace search because the user scoped the request to a channel. " +
          failure.message,
      },
    ],
    details: {
      ok: false,
      action: "research",
      reason: failure.reason,
      channel_ref: channelRef,
      candidates: failure.candidates,
    },
  };
}

async function runSearch(
  token: string,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<{ api: string; matches: SlackSearchMatch[] }> {
  const assistantParams: Record<string, string | number> = {
    query,
    count: clampLimit(limit, DEFAULT_SEARCH_LIMIT, 20),
    // Include DMs + MPIMs so research doesn't silently drop DM content.
    channel_types: DEFAULT_ASSISTANT_CHANNEL_TYPES,
  };
  const teamId = getTeamId();
  if (teamId) assistantParams.team_id = teamId;

  const assistantResult = await slackApiJson<AssistantSearchContextResponse>(
    "assistant.search.context",
    token,
    assistantParams,
    signal,
  );
  if (assistantResult.ok) {
    return {
      api: "assistant.search.context",
      matches: Array.isArray(assistantResult.data.results?.messages)
        ? assistantResult.data.results.messages
        : [],
    };
  }

  const result = await slackApi<SearchMessagesResponse>(
    "search.messages",
    token,
    { query, count: clampLimit(limit, DEFAULT_SEARCH_LIMIT, 20) },
    signal,
  );
  if (!result.ok) {
    const error = result as ApiErr;
    return {
      api: `error:${error.error}`,
      matches: [],
    };
  }

  return {
    api: "search.messages",
    matches: Array.isArray(result.data.messages?.matches) ? result.data.messages.matches : [],
  };
}

async function fetchThreadsForMatches(
  token: string,
  matches: SlackSearchMatch[],
  signal?: AbortSignal,
): Promise<ThreadBundle[]> {
  const threadable = matches
    .filter((match) => (match.reply_count || 0) > 0)
    .map((match) => ({
      channel: match.channel_id || match.channel?.id || "",
      ts: match.ts || match.message_ts || "",
    }))
    .filter((item) => item.channel && item.ts)
    .slice(0, 5);

  // Fire all thread fetches concurrently. The global Slack semaphore in
  // lib/api.ts (MAX_CONCURRENT) already caps actual in-flight requests, so
  // this can't stampede Slack; it just stops us from paying the round-trip
  // latency for each of up to 5 threads serially.
  const results = await Promise.all(
    threadable.map(async (item) => {
      const result = await slackApi<ConversationsRepliesResponse>(
        "conversations.replies",
        token,
        {
          channel: item.channel,
          ts: item.ts,
          limit: DEFAULT_HISTORY_LIMIT,
        },
        signal,
      );
      if (!result.ok || !Array.isArray(result.data.messages) || result.data.messages.length === 0) {
        return undefined;
      }
      await warmUsersForMessages(token, result.data.messages, signal);
      return {
        channel: item.channel,
        ts: item.ts,
        messages: result.data.messages,
      } satisfies ThreadBundle;
    }),
  );

  return results.filter((bundle): bundle is ThreadBundle => bundle !== undefined);
}

function buildResearchText(args: {
  planExplanation: string[];
  queryCounts: Array<{ query: string; count: number; api: string }>;
  matches: SlackSearchMatch[];
  threads: ThreadBundle[];
  fields: FieldsMode;
}): string {
  const lines: string[] = [];
  lines.push("Slack research plan:");
  for (const note of args.planExplanation) lines.push(`- ${note}`);
  lines.push("");
  lines.push("Executed queries:");
  args.queryCounts.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.query} — ${entry.count} result(s) via ${entry.api}`);
  });
  lines.push("");
  lines.push("Search results:");
  lines.push(formatSearchResults(args.matches, args.fields));

  if (args.threads.length > 0) {
    lines.push("");
    lines.push("Thread context:");
    args.threads.forEach((thread, index) => {
      lines.push("");
      lines.push(`Thread ${index + 1}: channel ${thread.channel}, ts ${thread.ts}`);
      lines.push(formatMessages(thread.messages, userNameMap(thread.messages), args.fields));
    });
  }

  return lines.join("\n");
}

async function warmUsersForMatches(
  token: string,
  matches: SlackSearchMatch[],
  signal?: AbortSignal,
): Promise<void> {
  const ids = new Set<string>();
  for (const match of matches) {
    if (match.user) ids.add(match.user);
    if (match.author_user_id) ids.add(match.author_user_id);
    const body = match.text || match.content || "";
    for (const mention of body.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g)) ids.add(mention[1]);
  }
  await warmUserCacheForIds(token, Array.from(ids), signal);
}

async function warmUsersForMessages(
  token: string,
  messages: SlackMessage[],
  signal?: AbortSignal,
): Promise<void> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.user) ids.add(message.user);
    const body = message.text || "";
    for (const mention of body.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g)) ids.add(mention[1]);
  }
  await warmUserCacheForIds(token, Array.from(ids), signal);
}

function userNameMap(messages: SlackMessage[]): Map<string, string> | undefined {
  const cache = getUserCache();
  const map = new Map<string, string>();
  for (const message of messages) {
    if (!message.user) continue;
    const name = cache.get(message.user);
    if (name) map.set(message.user, name);
  }
  return map.size > 0 ? map : undefined;
}

function resolveFields(value: string | undefined): FieldsMode {
  if (value === "summary" || value === "preview" || value === "full") return value;
  return "preview";
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
