/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared types for sf-slack.
 *
 * Best-practice boundary for this extension:
 * - raw Slack API payload shapes are defined here
 * - network helpers parse JSON once in api.ts
 * - the rest of the extension works with named interfaces instead of `any`
 */
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";

// ─── Constants ──────────────────────────────────────────────────────────────────

export const PROVIDER_NAME = "sf-slack";
export const SLACK_API_BASE = "https://slack.com/api";
export const COMMAND_NAME = "sf-slack";
export const WIDGET_KEY = "sf-slack-status";

export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_HISTORY_LIMIT = 20;
export const DEFAULT_LIST_LIMIT = 100;
export const MANUAL_REFRESH_SENTINEL = "manual-token";
export const LONG_LIVED_EXPIRY_MS = 10 * 365 * 24 * 60 * 60 * 1000;

// ─── Environment variable names ─────────────────────────────────────────────────

export const ENV_TOKEN = "SLACK_USER_TOKEN";
export const ENV_TEAM_ID = "SLACK_TEAM_ID";
export const ENV_CLIENT_ID = "SLACK_CLIENT_ID";
export const ENV_CLIENT_SECRET = "SLACK_CLIENT_SECRET";
export const ENV_REDIRECT_URI = "SLACK_REDIRECT_URI";
export const ENV_SCOPES = "SLACK_SCOPES";

// ─── Keychain ───────────────────────────────────────────────────────────────────

export const KEYCHAIN_SERVICE = "pi-sf-slack";
export const KEYCHAIN_ACCOUNT = "sf-slack-token";

// ─── Default scopes ─────────────────────────────────────────────────────────────

// Default scope set requested at OAuth time. We intentionally use the
// granular `search:read.*` family instead of the coarse legacy `search:read`
// scope — some workspaces no longer approve the coarse scope at all. The
// scope probe still accepts either the coarse or the granular family as
// satisfying search-dependent tools, so tokens that happened to be granted
// the legacy scope continue to work unchanged.
export const DEFAULT_SCOPES = [
  "search:read.public",
  "search:read.private",
  "search:read.im",
  "search:read.mpim",
  "search:read.files",
  "search:read.users",
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "users:read",
  "users:read.email",
  "files:read",
  "canvases:read",
  "canvases:write",
  // Message sending (slack_send). User-token scopes; never requested unless the
  // user explicitly re-consents.
  "chat:write",
  "chat:write.public",
  "im:write",
  "mpim:write",
].join(",");

// ─── slack_send env vars ─────────────────────────────────────────────────────────────

/** Opt-in for slack_send in non-interactive modes (pi -p, RPC). Default is
 *  to refuse the send when there is no UI to show a confirm dialog. */
export const ENV_ALLOW_HEADLESS_SEND = "SLACK_ALLOW_HEADLESS_SEND";
/** Dry-run: every slack_send call produces the confirm UX and the audit
 *  entry but does not actually hit chat.postMessage. Useful for demos and
 *  local testing before re-consenting on scopes. */
export const ENV_SEND_DRY_RUN = "SLACK_SEND_DRY_RUN";

// ─── Common result / payload helpers ────────────────────────────────────────────

export type JsonCompatibleValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonCompatibleValue[]
  | { [key: string]: JsonCompatibleValue };

export type JsonCompatibleParams = Record<string, JsonCompatibleValue>;

export interface SlackTextContent {
  type: "text";
  text: string;
}

export interface SlackToolResult {
  content: SlackTextContent[];
  details: Record<string, unknown>;
}

export interface SlackResponseMetadata {
  next_cursor?: string;
}

export interface SlackPaging {
  page?: number;
  pages?: number;
  total?: number;
}

export interface SlackReaction {
  name?: string;
  count?: number;
}

export interface SlackChannelRef {
  id?: string;
  name?: string;
}

export interface SlackSearchMatch {
  channel?: SlackChannelRef;
  channel_id?: string;
  channel_name?: string;
  username?: string;
  author_name?: string;
  user?: string;
  author_user_id?: string;
  text?: string;
  content?: string;
  permalink?: string;
  ts?: string;
  message_ts?: string;
  reply_count?: number;
}

export interface SlackMessage {
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: SlackReaction[];
}

export interface SlackConversationTopic {
  value?: string;
}

export interface SlackConversation {
  id?: string;
  name?: string;
  name_normalized?: string;
  topic?: SlackConversationTopic;
  purpose?: SlackConversationTopic;
  num_members?: number;
  is_private?: boolean;
  is_archived?: boolean;
  created?: number | string;
  creator?: string;
}

export interface SlackUserProfile {
  display_name?: string;
  real_name?: string;
  email?: string;
  title?: string;
  status_emoji?: string;
  status_text?: string;
}

export interface SlackUser {
  id?: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_admin?: boolean;
  tz?: string;
  tz_label?: string;
  profile?: SlackUserProfile;
}

export interface SlackFile {
  id?: string;
  name?: string;
  title?: string;
  filetype?: string;
  pretty_type?: string;
  size?: number;
  created?: number | string;
  user?: string;
  url_private?: string;
  permalink?: string;
  channels?: string[];
}

export interface SlackCanvasSection {
  id?: string;
  type?: string;
  content?: string;
}

export interface AssistantSearchContextResponse {
  results?: {
    messages?: SlackSearchMatch[];
  };
}

export interface SearchMessagesResponse {
  messages?: {
    matches?: SlackSearchMatch[];
  };
}

export interface AuthTestResponse {
  user_id?: string;
  user?: string;
  team_id?: string;
  enterprise_id?: string;
}

export interface ConversationsRepliesResponse {
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: SlackResponseMetadata;
}

export interface ConversationsHistoryResponse {
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: SlackResponseMetadata;
}

export interface ConversationsInfoResponse {
  channel?: SlackConversation;
}

export interface ConversationsListResponse {
  channels?: SlackConversation[];
  response_metadata?: SlackResponseMetadata;
}

export interface ConversationsMembersResponse {
  members?: string[];
  response_metadata?: SlackResponseMetadata;
}

export interface UsersInfoResponse {
  user?: SlackUser;
}

export interface UsersLookupByEmailResponse {
  user?: SlackUser;
}

export interface UsersPresenceResponse {
  presence?: string;
  online?: boolean;
  auto_away?: boolean;
  manual_away?: boolean;
  last_activity?: number;
}

export interface UsersListResponse {
  members?: SlackUser[];
  response_metadata?: SlackResponseMetadata;
}

export interface FilesInfoResponse {
  file?: SlackFile;
}

export interface FilesListResponse {
  files?: SlackFile[];
  paging?: SlackPaging;
}

export interface ChatGetPermalinkResponse {
  permalink?: string;
}

export interface CanvasSectionsLookupResponse {
  sections?: SlackCanvasSection[];
}

export interface CanvasCreateResponse {
  canvas_id?: string;
}

export interface CanvasEditResponse {
  ok?: boolean;
}

// ─── Result types ───────────────────────────────────────────────────────────────

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string; needed?: string; provided?: string };
export type ApiResult<T> = ApiOk<T> | ApiErr;

export interface SlackIdentity {
  userId: string;
  userName: string;
  teamId: string;
}

export interface StructuredMatch {
  channel: string;
  author: string;
  text: string;
  time: string;
  permalink: string;
  ts: string;
}

export interface StructuredMessage {
  author: string;
  text: string;
  time: string;
  ts: string;
  threadTs?: string;
  replyCount?: number;
  reactions?: SlackReaction[];
}

export interface StructuredChannel {
  id: string;
  name: string;
  topic: string;
  purpose: string;
  numMembers?: number;
  isPrivate: boolean;
  isArchived: boolean;
  created: string;
  creator: string;
}

export interface StructuredUser {
  id: string;
  displayName: string;
  realName: string;
  email: string;
  title: string;
  timezone: string;
  isBot: boolean;
  isAdmin: boolean;
  status: string;
}

export interface StructuredFile {
  id: string;
  name: string;
  type: string;
  size: string;
  created: string;
  sharedBy: string;
  permalink: string;
  channels: string;
}

export interface StructuredMember {
  id: string;
  name: string;
}

export interface ResolvedChannel {
  id: string;
  name: string;
  confidence: number;
  source: string;
  isPrivate?: boolean;
  isArchived?: boolean;
}

export interface ResolvedUser {
  id: string;
  handle: string;
  displayName: string;
  realName: string;
  email: string;
  confidence: number;
  source: string;
}

export interface ResolveResult<T> {
  ok: boolean;
  input: string;
  type: "channel" | "user";
  best?: T;
  candidates: T[];
  confidence: number;
  strategy: string[];
  warnings: string[];
}

export interface SlackSearchPlan {
  primary: string;
  fallbacks: string[];
  explanation: string[];
  resolved: {
    channel?: ResolvedChannel;
    fromUser?: ResolvedUser | { handle: "me"; displayName: "me" };
    withUser?: ResolvedUser;
  };
}

export interface StructuredCanvasSection {
  id: string;
  type: string;
  content: string;
}

export interface PresenceDetails {
  userId: string;
  userName: string;
  presence: string;
  online: boolean;
  autoAway: boolean;
  manualAway: boolean;
  lastActivity: string;
}

// ─── Tool parameter schemas ─────────────────────────────────────────────────────

export const SlackParams = Type.Object({
  action: StringEnum(["search", "thread", "history", "permalink", "auth"] as const, {
    description:
      "search: find messages by keyword. thread: fetch thread replies. " +
      "history: fetch channel messages. permalink: get message URL. auth: check auth status.",
  }),
  query: Type.Optional(
    Type.String({
      description:
        "Search query (for search). Supports operators: in:#channel, from:@name, " +
        "has:link, before:/after: dates.",
    }),
  ),
  channel: Type.Optional(
    Type.String({ description: "Channel ID, e.g. C123... (for thread, history, permalink)" }),
  ),
  ts: Type.Optional(
    Type.String({
      description:
        "Message timestamp in Slack ts format, e.g. '1773439922.558000' (for thread, permalink)",
    }),
  ),
  oldest: Type.Optional(
    Type.String({
      description:
        "Oldest timestamp boundary (for history). Use slack_time_range for human ranges.",
    }),
  ),
  latest: Type.Optional(
    Type.String({
      description:
        "Latest timestamp boundary (for history). Use slack_time_range for human ranges.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Max results (default varies by action, max 200)" }),
  ),
  cursor: Type.Optional(
    Type.String({ description: "Pagination cursor from a previous call's next_cursor" }),
  ),
  resolve_users: Type.Optional(
    Type.Boolean({ description: "Replace user IDs with display names (for thread, history)" }),
  ),
  // ─── P2: body-detail control for search/thread/history ────────────────────
  // Lets the LLM start with a token-cheap triage call (summary or preview)
  // and only request full bodies on the matches that actually matter.
  fields: Type.Optional(
    StringEnum(["summary", "preview", "full"] as const, {
      description:
        "Body-detail level for search/thread/history results. " +
        "summary = metadata only (channel, author, time, reply_count). " +
        "preview = summary plus a short text snippet (default). " +
        "full = complete message text. Start with summary or preview for " +
        "discovery, then use thread/full only for the messages worth reading.",
    }),
  ),
});

export const SlackTimeRangeParams = Type.Object({
  expression: Type.String({
    description:
      "Human time range to resolve. Examples: last week, yesterday, last 7 days, last month, 2026-04-13, 2026-04-13 to 2026-04-20.",
  }),
  timezone: Type.Optional(
    Type.String({
      description:
        "IANA timezone for calendar boundaries, e.g. UTC or America/Los_Angeles. Defaults to PI_SLACK_TIMEZONE, TZ, system timezone, then UTC.",
    }),
  ),
  week_starts_on: Type.Optional(
    StringEnum(["monday", "sunday"] as const, {
      description: "Week start for calendar week expressions. Defaults to monday.",
    }),
  ),
  anchor: Type.Optional(
    Type.String({
      description:
        "Optional ISO date/time used as 'now' for deterministic evaluation. Defaults to current time.",
    }),
  ),
  calendar_mode: Type.Optional(
    StringEnum(["calendar", "rolling"] as const, {
      description:
        "How to interpret ambiguous ranges such as last week. calendar = previous calendar week (default); rolling = last 7 days ending at anchor.",
    }),
  ),
  explicit_end: Type.Optional(
    StringEnum(["exclusive", "inclusive"] as const, {
      description:
        "For explicit date ranges only. exclusive means 2026-04-13 to 2026-04-20 ends before Apr 20 (default); inclusive includes the end date.",
    }),
  ),
});

export const SlackChannelParams = Type.Object({
  action: StringEnum(["info", "list", "members"] as const, {
    description:
      "info: get channel metadata by ID. list: find channels by name. members: list channel members.",
  }),
  channel: Type.Optional(
    Type.String({ description: "Channel ID, e.g. C123... (for info, members)" }),
  ),
  name_filter: Type.Optional(
    Type.String({ description: "Substring to filter channel names, case-insensitive (for list)" }),
  ),
  types: Type.Optional(
    Type.String({
      description:
        "Comma-separated: public_channel, private_channel, mpim, im (for list, default: public_channel,private_channel)",
    }),
  ),
  limit: Type.Optional(Type.Number({ description: "Max results (default 100, max 200)" })),
  cursor: Type.Optional(Type.String({ description: "Pagination cursor" })),
  resolve_users: Type.Optional(
    Type.Boolean({ description: "Resolve user IDs to display names (for members)" }),
  ),
});

export const SlackUserParams = Type.Object({
  action: StringEnum(["info", "email", "presence", "list"] as const, {
    description:
      "info: lookup by user ID. email: lookup by email. presence: check online/away. list: browse org directory.",
  }),
  user: Type.Optional(
    Type.String({ description: "User ID, e.g. U01ABC... (required for info, presence)" }),
  ),
  email: Type.Optional(Type.String({ description: "Email address (required for email action)" })),
  name_filter: Type.Optional(
    Type.String({ description: "Filter by name or title, case-insensitive (for list)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Max results for list (default 50, max 200)" })),
  cursor: Type.Optional(Type.String({ description: "Pagination cursor for list" })),
});

export const SlackFileParams = Type.Object({
  action: StringEnum(["info", "list"] as const, {
    description: "info: get file metadata by ID. list: list files in a channel or by a user.",
  }),
  file: Type.Optional(Type.String({ description: "File ID, e.g. F01ABC... (required for info)" })),
  channel: Type.Optional(
    Type.String({ description: "Channel ID to filter files from (for list)" }),
  ),
  user: Type.Optional(Type.String({ description: "User ID who shared the file (for list)" })),
  types: Type.Optional(
    Type.String({
      description: "File types: images, pdfs, snippets, gdocs, zips, canvases, all (default: all)",
    }),
  ),
  limit: Type.Optional(Type.Number({ description: "Max results (default 20, max 100)" })),
  cursor: Type.Optional(
    Type.String({ description: "Pagination cursor (page number for files.list)" }),
  ),
});

export const SlackResolveParams = Type.Object({
  type: StringEnum(["channel", "user"] as const, {
    description: "Entity type to resolve from fuzzy human text into Slack IDs/operators.",
  }),
  text: Type.String({
    description:
      "Human reference, e.g. '#team-lab', 'team lab', 'me', 'Jane Doe', or jane@example.com.",
  }),
  limit: Type.Optional(
    Type.Number({ description: "Maximum candidates to return (default 5, max 10)." }),
  ),
  clarify: Type.Optional(
    Type.Boolean({
      description:
        "When true in interactive mode, ask the user to pick from low-confidence candidates.",
    }),
  ),
});

export const SlackResearchParams = Type.Object({
  task: Type.Optional(
    StringEnum(["search", "summarize", "summarize_channel", "find_threads"] as const, {
      description: "High-level research task. Defaults to search.",
    }),
  ),
  query: Type.String({
    description:
      "Natural-language topic or terms to search for. Exact phrases in quotes are preserved.",
  }),
  channel_ref: Type.Optional(
    Type.String({
      description: "Optional channel reference. Accepts channel ID, #name, or fuzzy name.",
    }),
  ),
  from_ref: Type.Optional(
    Type.String({
      description:
        "Optional author reference. Use 'me' for current user's messages; otherwise name, handle, ID, or email.",
    }),
  ),
  with_ref: Type.Optional(
    Type.String({
      description:
        "Optional participant reference for conversations involving a user. Uses Slack's with:@Display Name operator.",
    }),
  ),
  exact_phrases: Type.Optional(
    Type.Array(Type.String(), { description: "Phrases that must be quoted in Slack search." }),
  ),
  exclude_terms: Type.Optional(
    Type.Array(Type.String(), { description: "Terms to exclude with Slack's -term modifier." }),
  ),
  content_filters: Type.Optional(
    Type.Array(StringEnum(["link", "pin", "file", "reaction"] as const), {
      description: "Slack has: filters to apply.",
    }),
  ),
  reaction_names: Type.Optional(
    Type.Array(Type.String(), { description: "Specific reaction names for has::emoji: filters." }),
  ),
  since: Type.Optional(
    Type.String({
      description:
        "Date/time lower bound. Prefer slack_time_range.slack.research.since for human ranges. Examples: 2026-03-01, March, today, week.",
    }),
  ),
  before: Type.Optional(
    Type.String({
      description:
        "Date upper bound, usually YYYY-MM-DD. Prefer slack_time_range.slack.research.before for human ranges.",
    }),
  ),
  during: Type.Optional(
    Type.String({ description: "Slack during: value, e.g. today, yesterday, week, march, 2026." }),
  ),
  thread_only: Type.Optional(
    Type.Boolean({ description: "Add is:thread to search only threaded messages." }),
  ),
  include_threads: Type.Optional(
    Type.Boolean({ description: "Fetch replies for matching threaded search results." }),
  ),
  strategy: Type.Optional(
    StringEnum(["strict_then_broaden", "broad", "thread_first", "artifact_first"] as const, {
      description: "Query strategy for fallback construction.",
    }),
  ),
  fields: Type.Optional(
    StringEnum(["summary", "preview", "full"] as const, {
      description: "Body-detail level for returned search results.",
    }),
  ),
  limit: Type.Optional(Type.Number({ description: "Max results per query (default 10, max 20)." })),
  max_queries: Type.Optional(
    Type.Number({ description: "Max primary+fallback queries to execute (default 3, max 6)." }),
  ),
});

// ─── slack_send ────────────────────────────────────────────────────────────────────────────
//
// Sending is the one "high blast-radius" Slack surface this extension
// exposes. Every send goes through an explicit confirm dialog in interactive
// mode and is refused in non-interactive mode unless the user opts in via
// SLACK_ALLOW_HEADLESS_SEND=1.

export const SlackSendParams = Type.Object({
  action: StringEnum(["channel", "dm", "thread"] as const, {
    description:
      "channel: post to a public/private channel or MPIM. dm: post to a 1:1 DM. thread: reply to an existing thread.",
  }),
  to: Type.String({
    description:
      "Destination reference. For action=channel: channel ID, #name, or fuzzy channel name. " +
      "For action=dm: user ID, @handle, display name, or email. " +
      "For action=thread: channel ID, #name, or fuzzy channel name (the same channel the thread lives in).",
  }),
  text: Type.String({
    description:
      "Message body. Supports Slack mrkdwn (*bold*, _italic_, ~strike~, `code`, <url|label>, <#CID|name>, <@UID>). " +
      "No Slack-side footer is appended.",
  }),
  thread_ts: Type.Optional(
    Type.String({
      description:
        "Parent message timestamp (required for action=thread). Slack format, e.g. '1773439922.558000'.",
    }),
  ),
  broadcast: Type.Optional(
    Type.Boolean({
      description:
        "When action=thread, also broadcasts the reply to the parent channel (reply_broadcast=true). Default false.",
    }),
  ),
});

export interface ChatPostMessageResponse {
  channel?: string;
  ts?: string;
  message?: {
    text?: string;
    user?: string;
    ts?: string;
  };
}

export interface ConversationsOpenResponse {
  ok?: boolean;
  channel?: {
    id?: string;
  };
  already_open?: boolean;
  no_op?: boolean;
}

/** Shape of the audit entry appended to the session branch after every
 *  successful (or dry-run) send. Readers: /sf-slack sent subcommand, future
 *  analytics. */
export const SEND_ENTRY_TYPE = "sf-slack-sent";

export interface SlackSendAuditEntry {
  ts: number;
  action: "channel" | "dm" | "thread";
  channel: string;
  channel_ref: string;
  channel_name?: string;
  thread_ts?: string;
  broadcast?: boolean;
  text: string;
  message_ts?: string;
  permalink?: string;
  dry_run?: boolean;
}

export const SlackCanvasParams = Type.Object({
  action: StringEnum(["read", "create", "edit"] as const, {
    description:
      "read: get canvas content or look up sections. create: create a new canvas. edit: modify an existing canvas.",
  }),
  canvas_id: Type.Optional(
    Type.String({ description: "Canvas file ID, e.g. F01ABC... (required for read, edit)" }),
  ),
  title: Type.Optional(Type.String({ description: "Canvas title (required for create)" })),
  markdown: Type.Optional(
    Type.String({ description: "Canvas content in markdown format (for create, edit)" }),
  ),
  channel_id: Type.Optional(
    Type.String({ description: "Pin the canvas as a tab in this channel (for create)" }),
  ),
  operation: Type.Optional(
    Type.Union(
      [
        Type.Literal("insert_at_start"),
        Type.Literal("insert_at_end"),
        Type.Literal("replace"),
        Type.Literal("delete"),
        Type.Literal("insert_before"),
        Type.Literal("insert_after"),
      ],
      {
        description:
          "Edit operation (required for edit): insert_at_start, insert_at_end, replace, delete, insert_before, insert_after",
      },
    ),
  ),
  section_id: Type.Optional(
    Type.String({
      description:
        "Target section ID (for edit: replace, delete, insert_before, insert_after — use read with criteria to find IDs)",
    }),
  ),
  criteria: Type.Optional(
    Type.Object(
      {
        contains: Type.Optional(Type.String({ description: "Text the section must contain" })),
        section_types: Type.Optional(
          Type.Array(Type.String(), { description: "Section types to match, e.g. ['any_header']" }),
        ),
      },
      { description: "Criteria to find specific sections (for read)" },
    ),
  ),
});
