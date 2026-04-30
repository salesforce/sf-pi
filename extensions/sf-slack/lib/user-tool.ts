/* SPDX-License-Identifier: Apache-2.0 */
/**
 * slack_user tool — info, email, presence, list.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
  SlackUserParams,
  type ApiErr,
  type AssistantSearchContextResponse,
  type PresenceDetails,
  type SlackUser,
  type StructuredUser,
  type UsersInfoResponse,
  type UsersListResponse,
  type UsersLookupByEmailResponse,
  type UsersPresenceResponse,
} from "./types.ts";
import { requireAuth } from "./auth.ts";
import {
  slackApi,
  slackApiJson,
  clampLimit,
  getUserCache,
  getTeamId,
  errorResult,
  relativeTime,
  warmUserCacheFromMatches,
  DEFAULT_ASSISTANT_CHANNEL_TYPES,
} from "./api.ts";
import { formatUserInfo, extractStructuredUser } from "./format.ts";
import { buildSlackTextResult } from "./truncation.ts";
import { requireConfirmedUser } from "./recipient-confirm.ts";

interface UserToolCallArgs {
  action?: string;
  user?: string;
  email?: string;
  name_filter?: string;
}

interface UserToolRenderResult {
  content?: unknown[];
  details?: {
    ok?: boolean;
    action?: string;
    filter?: string;
    next_cursor?: string;
    userData?: StructuredUser;
    users?: StructuredUser[];
    presence?: PresenceDetails;
  };
}

function callLabel(label: string, summary: string, theme: Theme): Text {
  return new Text(
    theme.fg("toolTitle", theme.bold(label + " ")) + theme.fg("muted", summary),
    0,
    0,
  );
}

export function registerUserTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof SlackUserParams>({
    name: "slack_user",
    label: "Slack User",
    description:
      "Look up Slack users (info, email, presence, list). " +
      "Actions: info — resolve user ID to profile. email — resolve email to profile. " +
      "presence — check if online/away. list — browse org directory with filter.",
    promptSnippet: "Look up Slack users by ID, email, presence, or browse the org directory",
    // Action names are qualified with the tool name because the flat Guidelines section
    // contains similar action:'list' semantics on slack/slack_channel/slack_file, and the
    // LLM cannot disambiguate "action 'list'" without the tool prefix.
    promptGuidelines: [
      "Use slack_user action:'list' with name_filter to find people by display name, real name, or title.",
      "Use slack_user action:'email' to cross-reference CRM contacts with Slack identities by email.",
      "Use slack_user action:'info' or action:'presence' only when you already have a Slack user ID; for fuzzy names use slack_resolve first.",
    ],
    parameters: SlackUserParams,

    renderCall(args: UserToolCallArgs, theme: Theme) {
      const action = args.action || "info";
      switch (action) {
        case "info":
          return callLabel("Slack User", args.user || "?", theme);
        case "email":
          return callLabel("Slack Lookup", args.email || "?", theme);
        case "presence":
          return callLabel(
            "Slack Presence",
            getUserCache().get(args.user || "") || args.user || "?",
            theme,
          );
        case "list": {
          let summary = "org directory";
          if (args.name_filter) summary += ` matching "${args.name_filter}"`;
          return callLabel("Slack Users", summary, theme);
        }
        default:
          return callLabel("Slack User", action, theme);
      }
    },

    renderResult(
      result: UserToolRenderResult,
      opts: { expanded: boolean; isPartial: boolean },
      theme: Theme,
    ) {
      if (opts.isPartial) {
        return new Text(theme.fg("warning", "Slack user lookup running…"), 0, 0);
      }

      const details = result.details || {};
      if (!details.ok) {
        return new Text(
          theme.fg("error", "✗ " + (getFirstText(result.content) || "User lookup failed")),
          0,
          0,
        );
      }
      const action = details.action || "info";

      if (action === "presence") {
        const presence = details.presence;
        if (!presence) return new Text(theme.fg("warning", "No presence data"), 0, 0);

        const icon = presence.online ? "🟢" : presence.presence === "away" ? "🟡" : "⚫";
        const color = presence.online
          ? "success"
          : presence.presence === "away"
            ? "warning"
            : "dim";
        const label = presence.online
          ? "Online"
          : presence.autoAway
            ? "Auto-away"
            : presence.manualAway
              ? "Away (manual)"
              : "Away";
        let text =
          icon +
          " " +
          theme.fg(color, label) +
          "  " +
          theme.fg("warning", presence.userName || presence.userId || "?");
        if (presence.lastActivity) {
          text +=
            "\n  " + theme.fg("muted", "Last active: ") + theme.fg("dim", presence.lastActivity);
        }
        return new Text(text, 0, 0);
      }

      if (action === "list") {
        const users = details.users || [];
        if (!users.length) {
          return new Text(
            theme.fg(
              "warning",
              "No users found" + (details.filter ? ` matching "${details.filter}"` : ""),
            ),
            0,
            0,
          );
        }
        let text = theme.fg("success", `✓ ${users.length} user${users.length !== 1 ? "s" : ""}`);
        if (details.filter) text += theme.fg("dim", ` matching "${details.filter}"`);
        if (details.next_cursor) text += theme.fg("warning", " [more pages]");
        text += "\n" + theme.fg("borderMuted", "  ─────────────────────────────────────");
        for (const user of users) {
          text += "\n  " + theme.fg("warning", user.displayName || user.realName || "?");
          if (user.title) text += "  " + theme.fg("dim", user.title);
          text += "\n    " + theme.fg("dim", user.id);
          if (user.email && user.email !== "(not available)")
            text += "  " + theme.fg("mdLink", user.email);
        }
        text += "\n" + theme.fg("borderMuted", "  ─────────────────────────────────────");
        return new Text(text, 0, 0);
      }

      const user = details.userData;
      if (!user) return new Text(theme.fg("warning", "No user data"), 0, 0);

      let text =
        theme.fg("success", "✓ ") +
        theme.fg("warning", user.displayName || user.realName || "unknown") +
        theme.fg("dim", ` (${user.id || "?"})`);
      text += "\n" + theme.fg("borderMuted", "  ─────────────────────────────────────");
      text +=
        "\n  " + theme.fg("muted", "Real Name:    ") + theme.fg("text", user.realName || "unknown");
      text +=
        "\n  " +
        theme.fg("muted", "Display Name: ") +
        theme.fg("text", user.displayName || "(not set)");
      text +=
        "\n  " +
        theme.fg("muted", "Email:        ") +
        theme.fg("mdLink", user.email || "(not available)");
      text +=
        "\n  " + theme.fg("muted", "Title:        ") + theme.fg("text", user.title || "(not set)");
      text +=
        "\n  " + theme.fg("muted", "Timezone:     ") + theme.fg("dim", user.timezone || "unknown");
      if (user.status)
        text += "\n  " + theme.fg("muted", "Status:       ") + theme.fg("text", user.status);
      const flags = [];
      if (user.isBot) flags.push(theme.fg("accent", "bot"));
      if (user.isAdmin) flags.push(theme.fg("warning", "admin"));
      if (flags.length) text += "\n  " + theme.fg("muted", "Flags:        ") + flags.join(", ");
      text += "\n" + theme.fg("borderMuted", "  ─────────────────────────────────────");
      return new Text(text, 0, 0);
    },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const auth = await requireAuth(ctx);
      if ("result" in auth) return auth.result;
      const action = params.action;
      const cache = getUserCache();

      if (action === "info") {
        if (!params.user) {
          return {
            content: [{ type: "text", text: '"info" requires "user" parameter.' }],
            details: { ok: false, action, reason: "missing_user" },
          };
        }

        const resolvedUser = await resolveUserParam(ctx, auth.token, params.user, signal);
        if ("result" in resolvedUser) return resolvedUser.result;

        const result = await slackApi<UsersInfoResponse>(
          "users.info",
          auth.token,
          { user: resolvedUser.id },
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          return errorResult(error.error, error.needed, error.provided);
        }

        const user = result.data.user;
        if (!user) {
          return {
            content: [{ type: "text", text: "No user data returned." }],
            details: { ok: false, action },
          };
        }

        cacheUser(cache, user);
        return buildSlackTextResult(
          formatUserInfo(user),
          { ok: true, action, user_id: user.id, userData: extractStructuredUser(user) },
          { prefix: "pi-slack-user-info" },
        );
      }

      if (action === "email") {
        if (!params.email) {
          return {
            content: [{ type: "text", text: '"email" requires "email" parameter.' }],
            details: { ok: false, action, reason: "missing_email" },
          };
        }

        const result = await slackApi<UsersLookupByEmailResponse>(
          "users.lookupByEmail",
          auth.token,
          {
            email: params.email,
          },
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          if (error.error === "users_not_found") {
            return {
              content: [{ type: "text", text: `No Slack user found for email: ${params.email}` }],
              details: { ok: false, action, reason: "not_found", email: params.email },
            };
          }
          return errorResult(error.error, error.needed, error.provided);
        }

        const user = result.data.user;
        if (!user) {
          return {
            content: [{ type: "text", text: "No user data returned." }],
            details: { ok: false, action },
          };
        }

        cacheUser(cache, user);
        return buildSlackTextResult(
          formatUserInfo(user),
          {
            ok: true,
            action,
            user_id: user.id,
            email: params.email,
            userData: extractStructuredUser(user),
          },
          { prefix: "pi-slack-user-email" },
        );
      }

      if (action === "presence") {
        if (!params.user) {
          return {
            content: [{ type: "text", text: '"presence" requires "user" parameter.' }],
            details: { ok: false, action, reason: "missing_user" },
          };
        }

        const resolvedUser = await resolveUserParam(ctx, auth.token, params.user, signal);
        if ("result" in resolvedUser) return resolvedUser.result;

        const result = await slackApi<UsersPresenceResponse>(
          "users.getPresence",
          auth.token,
          { user: resolvedUser.id },
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          return errorResult(error.error, error.needed, error.provided);
        }

        const presence = result.data;
        const userName = cache.get(resolvedUser.id) || resolvedUser.displayName || resolvedUser.id;
        const lastActivity = presence.last_activity
          ? relativeTime(String(presence.last_activity))
          : "";
        const text = [
          `User: ${userName} (${resolvedUser.id})`,
          `Presence: ${presence.presence || "unknown"}`,
          `Online: ${presence.online ? "yes" : "no"}`,
          lastActivity ? `Last activity: ${lastActivity}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        return buildSlackTextResult(
          text,
          {
            ok: true,
            action,
            presence: {
              userId: resolvedUser.id,
              userName,
              presence: presence.presence || "unknown",
              online: !!presence.online,
              autoAway: !!presence.auto_away,
              manualAway: !!presence.manual_away,
              lastActivity,
            },
          },
          { prefix: "pi-slack-user-presence" },
        );
      }

      if (action === "list") {
        const result = await slackApi<UsersListResponse>(
          "users.list",
          auth.token,
          {
            limit: clampLimit(params.limit, 50, 200),
            cursor: params.cursor,
          },
          signal,
        );

        // Grid-safe fallback: when the directory call fails (most often
        // team_access_not_granted on enterprise grid) AND the caller is
        // trying to find a specific person via name_filter, degrade to
        // mining message search for author names — same pattern Slackbot
        // uses when its directory lookup comes back empty. Without a
        // name_filter we have nothing to search on, so the original error
        // still surfaces.
        if (!result.ok) {
          const error = result as ApiErr;
          if (params.name_filter) {
            const fallback = await searchUsersForNameFilter(auth.token, params.name_filter, signal);
            if (fallback.length > 0) {
              for (const member of fallback) cacheUser(cache, member);
              const users = fallback.map((member) => extractStructuredUser(member));
              const text =
                `Directory lookup unavailable (${error.error}); showing authors mined from recent messages matching "${params.name_filter}":\n\n` +
                fallback
                  .map((member, index) => {
                    const profile = member.profile || {};
                    const name =
                      profile.display_name || profile.real_name || member.name || "unknown";
                    return `${index + 1}. ${name} (${member.id})`;
                  })
                  .join("\n");
              return buildSlackTextResult(
                text,
                {
                  ok: true,
                  action,
                  count: users.length,
                  filter: params.name_filter,
                  users,
                  source: "assistant.search.context",
                  directory_error: error.error,
                },
                { prefix: "pi-slack-user-list" },
              );
            }
          }
          return errorResult(error.error, error.needed, error.provided);
        }

        let members = Array.isArray(result.data.members) ? result.data.members : [];
        const nextCursor = result.data.response_metadata?.next_cursor || undefined;
        members = members.filter(
          (member) => !member.is_bot && !member.deleted && member.id !== "USLACKBOT",
        );
        if (params.name_filter) {
          const filterValue = params.name_filter.toLowerCase();
          members = members.filter((member) => matchesUserFilter(member, filterValue));

          // If the directory call succeeded but had zero fuzzy matches for
          // this filter (common on grid where users.list only returns the
          // home workspace), try the same search-based fallback before
          // giving up.
          if (members.length === 0) {
            const fallback = await searchUsersForNameFilter(auth.token, params.name_filter, signal);
            if (fallback.length > 0) {
              members = fallback;
            }
          }
        }

        for (const member of members) {
          cacheUser(cache, member);
        }

        const users = members.map((member) => extractStructuredUser(member));
        const text =
          members
            .map((member, index) => {
              const profile = member.profile || {};
              const name = profile.display_name || profile.real_name || member.name || "unknown";
              const title = profile.title ? ` — ${profile.title}` : "";
              return `${index + 1}. ${name} (${member.id})${title}`;
            })
            .join("\n") + (nextCursor ? `\n\n--- More available. cursor: "${nextCursor}" ---` : "");

        return buildSlackTextResult(
          text,
          {
            ok: true,
            action,
            count: users.length,
            filter: params.name_filter,
            next_cursor: nextCursor,
            users,
          },
          { prefix: "pi-slack-user-list" },
        );
      }

      return {
        content: [
          { type: "text", text: `Unknown action: "${action}". Use: info, email, presence, list.` },
        ],
        details: { ok: false, action, reason: "unknown_action" },
      };
    },
  });
}

// slack_user action=info / action=presence now route through the HITL
// helper. Raw user IDs verify via users.info; fuzzy @handles, display
// names, and emails use the select-or-type dialog when below 0.85.
async function resolveUserParam(
  ctx: ExtensionContext,
  token: string,
  user: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; id: string; displayName?: string }
  | {
      ok: false;
      result: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> };
    }
> {
  const confirmed = await requireConfirmedUser(ctx, token, user, signal);
  if (confirmed.ok && confirmed.recipient.type === "user" && confirmed.recipient.user.id !== "me") {
    const u = confirmed.recipient.user;
    return { ok: true, id: u.id, displayName: u.displayName };
  }
  const failure = confirmed as Extract<typeof confirmed, { ok: false }>;
  return {
    ok: false,
    result: {
      content: [{ type: "text", text: failure.message || `Could not resolve user "${user}".` }],
      details: {
        ok: false,
        reason: failure.reason || "user_resolution_failed",
        user_ref: user,
        candidates: failure.candidates || [],
      },
    },
  };
}

function cacheUser(cache: Map<string, string>, user: SlackUser): void {
  const displayName = user.profile?.display_name || user.profile?.real_name || user.name;
  if (user.id && displayName) {
    cache.set(user.id, displayName);
  }
}

function matchesUserFilter(user: SlackUser, filterValue: string): boolean {
  const profile = user.profile || {};
  return [
    profile.display_name,
    profile.real_name,
    user.real_name,
    user.name,
    profile.title,
    profile.email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(filterValue);
}

/** Search messages for `nameFilter` and synthesize SlackUser shapes from
 *  the author fields of matching hits. This is the degrade path for
 *  `slack_user action:'list'` when `users.list` is gated by
 *  `team_access_not_granted` (enterprise grid) or returns zero fuzzy
 *  matches — same recovery Slackbot uses when a human asks for someone
 *  it can't find in the directory.
 *
 *  Returns at most `max` unique {id, name} pairs. Profile fields we don't
 *  have (title, email) are left empty so downstream renderers show "(not
 *  set)" instead of lying. */
async function searchUsersForNameFilter(
  token: string,
  nameFilter: string,
  signal?: AbortSignal,
  max: number = 8,
): Promise<SlackUser[]> {
  const seen = new Map<string, SlackUser>();
  const params: Record<string, string | number> = {
    query: nameFilter,
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
  if (!result.ok) return [];

  const matches = Array.isArray(result.data.results?.messages) ? result.data.results.messages : [];
  warmUserCacheFromMatches(matches);

  for (const match of matches) {
    const id = match.author_user_id || match.user;
    const name = match.author_name || match.username;
    if (!id || !name || seen.has(id)) continue;
    seen.set(id, {
      id,
      name,
      real_name: name,
      profile: { display_name: name, real_name: name },
    });
    if (seen.size >= max) break;
  }
  return Array.from(seen.values());
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) {
    return "";
  }

  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
