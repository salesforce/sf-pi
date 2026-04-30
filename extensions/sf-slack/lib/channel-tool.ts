/* SPDX-License-Identifier: Apache-2.0 */
/**
 * slack_channel tool — info, list, members.
 *
 * When `channels:read` is missing, this tool falls back to search and history
 * so the agent can still do useful discovery work.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
  SlackChannelParams,
  DEFAULT_LIST_LIMIT,
  type ApiErr,
  type AssistantSearchContextResponse,
  type ConversationsHistoryResponse,
  type ConversationsInfoResponse,
  type ConversationsListResponse,
  type ConversationsMembersResponse,
  type StructuredChannel,
  type StructuredMember,
} from "./types.ts";
import { requireAuth } from "./auth.ts";
import {
  slackApi,
  slackApiJson,
  clampLimit,
  resolveUserNames,
  getTeamId,
  errorResult,
  DEFAULT_ASSISTANT_CHANNEL_TYPES,
} from "./api.ts";
import { formatChannelInfo, extractStructuredChannel } from "./format.ts";
import { buildSlackTextResult } from "./truncation.ts";
import { requireConfirmedChannel } from "./recipient-confirm.ts";

interface ChannelToolCallArgs {
  action?: string;
  channel?: string;
  name_filter?: string;
  resolve_users?: boolean;
}

interface ChannelToolRenderResult {
  content?: unknown[];
  details?: {
    ok?: boolean;
    action?: string;
    next_cursor?: string;
    channelData?: StructuredChannel;
    channels?: StructuredChannel[];
    members?: StructuredMember[];
  };
}

function callLabel(label: string, summary: string, theme: Theme): Text {
  return new Text(
    theme.fg("toolTitle", theme.bold(label + " ")) + theme.fg("muted", summary),
    0,
    0,
  );
}

export function registerChannelTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof SlackChannelParams>({
    name: "slack_channel",
    label: "Slack Channel",
    description:
      "Look up Slack channels (info, list, members). " +
      "Actions: info — get channel metadata by ID. list — find channels by name. members — list channel members.",
    promptSnippet: "Get Slack channel info, list channels by name, or list channel members",
    parameters: SlackChannelParams,

    renderCall(args: ChannelToolCallArgs, theme: Theme) {
      const action = args.action || "info";
      switch (action) {
        case "info":
          return callLabel("Slack Channel Info", args.channel || "?", theme);
        case "list": {
          let summary = "channels";
          if (args.name_filter) summary += ` matching "${args.name_filter}"`;
          return callLabel("Slack Channels", summary, theme);
        }
        case "members":
          return callLabel(
            "Slack Members",
            (args.channel || "?") + (args.resolve_users ? " +names" : ""),
            theme,
          );
        default:
          return callLabel("Slack Channel", action, theme);
      }
    },

    renderResult(
      result: ChannelToolRenderResult,
      opts: { expanded: boolean; isPartial: boolean },
      theme: Theme,
    ) {
      if (opts.isPartial) {
        return new Text(theme.fg("warning", "Slack channel lookup running…"), 0, 0);
      }

      const details = result.details || {};
      if (!details.ok) {
        return new Text(
          theme.fg("error", "✗ " + (getFirstText(result.content) || "Channel call failed")),
          0,
          0,
        );
      }
      const action = details.action || "info";

      if (action === "info") {
        const channel = details.channelData;
        if (!channel) return new Text(theme.fg("warning", "No channel data"), 0, 0);

        let text =
          theme.fg("success", "✓ ") +
          theme.fg("accent", `#${channel.name || "unknown"}`) +
          theme.fg("dim", ` (${channel.id || "?"})`);
        text += "\n" + theme.fg("borderMuted", "  ─────────────────────────────────────");
        text +=
          "\n  " +
          theme.fg("muted", "Members:  ") +
          theme.fg("text", `${channel.numMembers ?? "unknown"}`);
        text +=
          "\n  " + theme.fg("muted", "Topic:    ") + theme.fg("text", channel.topic || "(none)");
        text +=
          "\n  " + theme.fg("muted", "Purpose:  ") + theme.fg("text", channel.purpose || "(none)");
        text +=
          "\n  " + theme.fg("muted", "Created:  ") + theme.fg("dim", channel.created || "unknown");
        const flags = [];
        if (channel.isPrivate) flags.push(theme.fg("warning", "private"));
        if (channel.isArchived) flags.push(theme.fg("error", "archived"));
        if (flags.length) text += "\n  " + theme.fg("muted", "Flags:    ") + flags.join(", ");
        text += "\n" + theme.fg("borderMuted", "  ─────────────────────────────────────");
        return new Text(text, 0, 0);
      }

      if (action === "list") {
        const channels = details.channels || [];
        if (!channels.length) return new Text(theme.fg("warning", "No channels found"), 0, 0);
        let text = theme.fg(
          "success",
          `✓ ${channels.length} channel${channels.length !== 1 ? "s" : ""}`,
        );
        if (details.next_cursor) text += theme.fg("warning", " [more pages]");
        for (const channel of channels) {
          text +=
            "\n  " +
            theme.fg("accent", `#${channel.name}`) +
            theme.fg("dim", ` (${channel.id})`) +
            (channel.isPrivate ? " " + theme.fg("warning", "[private]") : "") +
            "  " +
            theme.fg("muted", `${channel.numMembers ?? "?"} members`);
          if (channel.topic && channel.topic !== "(none)") {
            const shortTopic =
              channel.topic.length > 80 ? channel.topic.substring(0, 80) + "…" : channel.topic;
            text += "\n    " + theme.fg("dim", shortTopic);
          }
        }
        return new Text(text, 0, 0);
      }

      const members = details.members || [];
      if (!members.length) return new Text(theme.fg("warning", "No members found"), 0, 0);
      let text = theme.fg(
        "success",
        `✓ ${members.length} member${members.length !== 1 ? "s" : ""}`,
      );
      if (details.next_cursor) text += theme.fg("warning", " [more pages]");
      for (const member of members) {
        text += "\n  " + theme.fg("warning", member.name || member.id);
        if (member.name && member.name !== member.id) text += theme.fg("dim", ` (${member.id})`);
      }
      return new Text(text, 0, 0);
    },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const auth = await requireAuth(ctx);
      if ("result" in auth) return auth.result;
      const action = params.action;

      if (action === "info") {
        if (!params.channel) {
          return {
            content: [{ type: "text", text: '"info" requires the "channel" parameter.' }],
            details: { ok: false, action, reason: "missing_channel" },
          };
        }

        const resolvedChannel = await resolveChannelParam(ctx, auth.token, params.channel, signal);
        if ("result" in resolvedChannel) return resolvedChannel.result;

        const result = await slackApi<ConversationsInfoResponse>(
          "conversations.info",
          auth.token,
          {
            channel: resolvedChannel.id,
            include_num_members: true,
          },
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          if (error.error === "missing_scope") {
            const fallback = await searchChannelById(auth.token, resolvedChannel.id, signal);
            const channelName =
              fallback?.channel_name || resolvedChannel.name || resolvedChannel.id;
            return buildSlackTextResult(
              `Channel: #${channelName}\nID: ${resolvedChannel.id}\nNote: Limited info — token lacks channels:read scope.`,
              {
                ok: true,
                action,
                channelData: buildFallbackChannel(resolvedChannel.id, channelName),
                channel_ref: params.channel,
                fallback: true,
              },
              { prefix: "pi-slack-channel-info" },
            );
          }
          return errorResult(error.error, error.needed, error.provided);
        }

        const channel = result.data.channel;
        if (!channel) {
          return {
            content: [{ type: "text", text: "No channel data returned." }],
            details: { ok: false, action },
          };
        }

        return buildSlackTextResult(
          formatChannelInfo(channel),
          {
            ok: true,
            action,
            channel_id: channel.id,
            channelData: extractStructuredChannel(channel),
          },
          { prefix: "pi-slack-channel-info" },
        );
      }

      if (action === "list") {
        const result = await slackApi<ConversationsListResponse>(
          "conversations.list",
          auth.token,
          {
            types: params.types || "public_channel,private_channel",
            limit: clampLimit(params.limit, DEFAULT_LIST_LIMIT, 200),
            cursor: params.cursor,
            exclude_archived: true,
          },
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          if (isRecoverableChannelListError(error.error) && params.name_filter) {
            const fallback = await buildChannelSearchFallback(
              auth.token,
              params.name_filter,
              action,
              signal,
            );
            if (fallback) return fallback;
          }
          return errorResult(error.error, error.needed, error.provided);
        }

        let channels = Array.isArray(result.data.channels) ? result.data.channels : [];
        const nextCursor = result.data.response_metadata?.next_cursor || undefined;
        if (params.name_filter) {
          const filterValue = params.name_filter.toLowerCase();
          channels = channels.filter((channel) => {
            const name = (channel.name || "").toLowerCase();
            const normalizedName = (channel.name_normalized || "").toLowerCase();
            return name.includes(filterValue) || normalizedName.includes(filterValue);
          });
        }

        if (channels.length === 0 && params.name_filter) {
          const fallback = await buildChannelSearchFallback(
            auth.token,
            params.name_filter,
            action,
            signal,
          );
          if (fallback) return fallback;
        }

        const structured = channels.map((channel) => extractStructuredChannel(channel));
        const text =
          channels
            .map((channel, index) => {
              const topic = channel.topic?.value
                ? ` — ${channel.topic.value.substring(0, 80)}`
                : "";
              const isPrivate = channel.is_private ? " [private]" : "";
              const members = channel.num_members ? ` (${channel.num_members} members)` : "";
              return `${index + 1}. #${channel.name || "unknown"} (${channel.id})${isPrivate}${members}${topic}`;
            })
            .join("\n") + (nextCursor ? `\n\n--- More available. cursor: "${nextCursor}" ---` : "");

        return buildSlackTextResult(
          text,
          {
            ok: true,
            action,
            count: channels.length,
            next_cursor: nextCursor,
            channels: structured,
          },
          { prefix: "pi-slack-channel-list" },
        );
      }

      if (action === "members") {
        if (!params.channel) {
          return {
            content: [{ type: "text", text: '"members" requires the "channel" parameter.' }],
            details: { ok: false, action, reason: "missing_channel" },
          };
        }

        const resolvedChannel = await resolveChannelParam(ctx, auth.token, params.channel, signal);
        if ("result" in resolvedChannel) return resolvedChannel.result;

        const result = await slackApi<ConversationsMembersResponse>(
          "conversations.members",
          auth.token,
          {
            channel: resolvedChannel.id,
            limit: clampLimit(params.limit, DEFAULT_LIST_LIMIT, 200),
            cursor: params.cursor,
          },
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          if (error.error === "missing_scope") {
            const history = await slackApi<ConversationsHistoryResponse>(
              "conversations.history",
              auth.token,
              {
                channel: resolvedChannel.id,
                limit: 100,
              },
              signal,
            );
            if (history.ok) {
              const ids = [...new Set(getMessageUserIds(history.data.messages || []))];
              if (ids.length > 0) {
                const names = params.resolve_users
                  ? await resolveUserNames(auth.token, ids, signal)
                  : undefined;
                const members = ids.map((id) => ({ id, name: names?.get(id) || id }));
                const text =
                  "Active members from recent messages (incomplete):\n" +
                  members
                    .map(
                      (member, index) =>
                        `${index + 1}. ${member.name}${member.name !== member.id ? ` (${member.id})` : ""}`,
                    )
                    .join("\n");
                return buildSlackTextResult(
                  text,
                  {
                    ok: true,
                    action,
                    count: ids.length,
                    channel: resolvedChannel.id,
                    channel_ref: params.channel,
                    members,
                    fallback: true,
                  },
                  { prefix: "pi-slack-channel-members" },
                );
              }
            }
          }
          return errorResult(error.error, error.needed, error.provided);
        }

        const memberIds = Array.isArray(result.data.members) ? result.data.members : [];
        const nextCursor = result.data.response_metadata?.next_cursor || undefined;
        if (!memberIds.length) {
          return {
            content: [{ type: "text", text: "No members found." }],
            details: { ok: true, action, count: 0 },
          };
        }

        const names = params.resolve_users
          ? await resolveUserNames(auth.token, memberIds, signal)
          : undefined;
        const members = memberIds.map((id) => ({ id, name: names?.get(id) || id }));
        const text =
          members
            .map(
              (member, index) =>
                `${index + 1}. ${member.name}${member.name !== member.id ? ` (${member.id})` : ""}`,
            )
            .join("\n") + (nextCursor ? `\n\n--- More available. cursor: "${nextCursor}" ---` : "");

        return buildSlackTextResult(
          text,
          {
            ok: true,
            action,
            count: memberIds.length,
            channel: resolvedChannel.id,
            channel_ref: params.channel,
            next_cursor: nextCursor,
            members,
          },
          { prefix: "pi-slack-channel-members" },
        );
      }

      return {
        content: [{ type: "text", text: `Unknown action: "${action}". Use: info, list, members.` }],
        details: { ok: false, action, reason: "unknown_action" },
      };
    },
  });
}

// Channel-ref resolution for slack_channel info/members. Routes through
// the shared HITL helper so raw IDs are verified, fuzzy names use the
// select-or-type dialog, and headless mode fails loudly — same behavior
// as slack_send and slack.
async function resolveChannelParam(
  ctx: ExtensionContext,
  token: string,
  channel: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; id: string; name?: string }
  | {
      ok: false;
      result: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> };
    }
> {
  const confirmed = await requireConfirmedChannel(ctx, token, channel, signal);
  if (confirmed.ok && confirmed.recipient.type === "channel") {
    return { ok: true, id: confirmed.recipient.channel.id, name: confirmed.recipient.channel.name };
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

function isRecoverableChannelListError(error: string): boolean {
  return error === "missing_scope" || error === "missing_argument" || error === "channel_not_found";
}

async function buildChannelSearchFallback(
  token: string,
  nameFilter: string,
  action: string,
  signal?: AbortSignal,
) {
  const matches = await searchChannelsByName(token, nameFilter, signal);
  if (matches.length === 0) return undefined;

  const channels = matches.map((match) =>
    buildFallbackChannel(match.channel_id || "unknown", match.channel_name || "unknown"),
  );
  const text =
    "Fallback channel discovery via Slack search context:\n" +
    channels.map((channel, index) => `${index + 1}. #${channel.name} (${channel.id})`).join("\n");

  return buildSlackTextResult(
    text,
    { ok: true, action, count: channels.length, channels, fallback: true },
    { prefix: "pi-slack-channel-list" },
  );
}

function buildFallbackChannel(id: string, name: string): StructuredChannel {
  return {
    id,
    name,
    topic: "(unavailable)",
    purpose: "(unavailable)",
    numMembers: undefined,
    isPrivate: false,
    isArchived: false,
    created: "unknown",
    creator: "unknown",
  };
}

async function searchChannelById(token: string, channelId: string, signal?: AbortSignal) {
  const params: Record<string, string | number> = {
    query: `in:${channelId}`,
    count: 1,
    channel_types: DEFAULT_ASSISTANT_CHANNEL_TYPES,
  };
  const teamId = getTeamId();
  if (teamId) params.team_id = teamId;

  const result = await slackApiJson<AssistantSearchContextResponse>(
    "assistant.search.context",
    token,
    params,
    signal,
  );
  return result.ok ? result.data.results?.messages?.[0] : undefined;
}

async function searchChannelsByName(token: string, nameFilter: string, signal?: AbortSignal) {
  const unique = new Map<string, { channel_id?: string; channel_name?: string; score: number }>();

  for (const query of buildChannelDiscoveryQueries(nameFilter)) {
    const params: Record<string, string | number> = {
      query,
      count: 20,
      channel_types: DEFAULT_ASSISTANT_CHANNEL_TYPES,
    };
    const teamId = getTeamId();
    if (teamId) params.team_id = teamId;

    const result = await slackApiJson<AssistantSearchContextResponse>(
      "assistant.search.context",
      token,
      params,
      signal,
    );
    if (!result.ok) continue;

    const matches = Array.isArray(result.data.results?.messages)
      ? result.data.results.messages
      : [];
    for (const match of matches) {
      const id = match.channel_id || match.channel?.id;
      const name = match.channel_name || match.channel?.name;
      if (!id || !name) continue;

      const score = scoreChannelName(nameFilter, name);
      const previous = unique.get(id);
      if (!previous || score > previous.score) {
        unique.set(id, { channel_id: id, channel_name: name, score });
      }
    }
  }

  return Array.from(unique.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
}

function buildChannelDiscoveryQueries(nameFilter: string): string[] {
  const raw = nameFilter.trim().replace(/^#/, "");
  if (!raw) return [];

  const tokens = tokenizeChannelName(raw);
  const queries = [
    `in:#${raw}`,
    `in:${raw}`,
    raw,
    tokens.join(" "),
    tokens.slice(0, 3).join(" "),
    normalizeChannelName(raw),
  ];

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 8);
}

function tokenizeChannelName(value: string): string[] {
  return value
    .replace(/^#/, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function normalizeChannelName(value: string): string {
  return value
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function scoreChannelName(target: string, candidate: string): number {
  const targetNorm = normalizeChannelName(target);
  const candidateNorm = normalizeChannelName(candidate);
  if (!targetNorm || !candidateNorm) return 0;
  if (targetNorm === candidateNorm) return 100;
  if (candidateNorm.includes(targetNorm) || targetNorm.includes(candidateNorm)) return 90;

  const targetTokens = new Set(tokenizeChannelName(target));
  const candidateTokens = new Set(tokenizeChannelName(candidate));
  const overlap = [...targetTokens].filter((token) => candidateTokens.has(token)).length;
  const tokenScore = targetTokens.size > 0 ? (overlap / targetTokens.size) * 20 : 0;
  const editScore = normalizedEditSimilarity(targetNorm, candidateNorm) * 80;
  return editScore + tokenScore;
}

function normalizedEditSimilarity(left: string, right: string): number {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;
  return 1 - levenshteinDistance(left, right) / maxLength;
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function getMessageUserIds(messages: { user?: string }[]): string[] {
  return messages.map((message) => message.user).filter((value): value is string => Boolean(value));
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) {
    return "";
  }

  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
