/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Slack API callers, user cache, channel cache, and rate-limit handling.
 *
 * Best practice used here:
 * - parse JSON as `unknown`
 * - narrow once at the boundary
 * - return typed endpoint payloads to the rest of the extension
 *
 * Rate-limit behavior (P6 — added for VP-demo polish):
 * - All outgoing Slack calls flow through `withSlot()` — a tiny in-process
 *   semaphore (MAX_CONCURRENT=3) so parallel tool calls do not burst past
 *   Slack's tier-2/3 budgets.
 * - On HTTP 429 we honor the `Retry-After` header and retry once. If the
 *   second attempt also fails we surface `error: "rate_limited"` so the
 *   render path can show a friendly ⏳ inline message instead of http_429.
 */
import {
  SLACK_API_BASE,
  ENV_TEAM_ID,
  type ApiResult,
  type ChatPostMessageResponse,
  type ConversationsInfoResponse,
  type ConversationsListResponse,
  type ConversationsOpenResponse,
  type AssistantSearchContextResponse,
  type JsonCompatibleParams,
  type UsersInfoResponse,
  type UsersListResponse,
} from "./types.ts";

interface SlackApiEnvelope {
  ok?: boolean;
  error?: string;
  needed?: string;
  provided?: string;
}

type FormParams = Record<string, string | number | boolean | undefined>;

// ─── Granted-scope cache (P1) ──────────────────────────────────────────────────
//
// Slack returns the scopes actually granted to the current token on every
// successful response via the `X-OAuth-Scopes` header. That is the only
// authoritative source — the scopes we *requested* at OAuth time can drift
// from what the workspace actually approved. We opportunistically update this
// cache on every API response so the rest of the extension (scope probe,
// auth-status render, per-action gates) can answer "do we have scope X?"
// without making extra calls.

let grantedScopes: Set<string> | null = null;

/** Read-only view of the scopes Slack has told us the token actually has.
 *  Returns null when no Slack response has been captured yet. */
export function getGrantedScopes(): Set<string> | null {
  return grantedScopes ? new Set(grantedScopes) : null;
}

/** True when Slack told us the token has `scope`. When nothing has been
 *  captured yet (grantedScopes === null) we return `true` — the header is
 *  unknown, not denied, and we don't want to falsely pre-gate callers before
 *  the first response lands. Callers that *require* certainty should call
 *  `hasScopeKnown()`. */
export function hasScope(scope: string): boolean {
  if (!grantedScopes) return true;
  return grantedScopes.has(scope);
}

/** True only when the granted-scope cache has been populated AND contains
 *  `scope`. Use this in places where a false-positive would lead to a worse
 *  experience than a false-negative (e.g. the mismatch warning). */
export function hasScopeKnown(scope: string): boolean {
  return grantedScopes !== null && grantedScopes.has(scope);
}

/** Convenience: any-of check used by the scope probe. */
export function hasAnyScope(scopes: string[]): boolean {
  if (!grantedScopes) return true;
  for (const scope of scopes) {
    if (grantedScopes.has(scope)) return true;
  }
  return false;
}

/** Test-only reset hook. Not re-exported via any public barrel. */
export function _resetGrantedScopes(): void {
  grantedScopes = null;
}

function captureAuthHeaders(response: Response): void {
  // Slack sends this header on every OK response and on many error responses
  // as well. Only overwrite the cache when the header is present so a 5xx
  // without the header doesn't wipe a previously-known good value.
  const headerValue = response.headers.get("x-oauth-scopes");
  if (!headerValue) return;
  const parsed = headerValue
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  grantedScopes = new Set(parsed);
}

// ─── Token type detection (P1) ─────────────────────────────────────────────────
//
// Slack token prefixes tell us a lot about what the token can do. Canvas
// writes and some admin endpoints require a user (xoxp-) token; bot (xoxb-)
// tokens reject those calls with `bot_scopes_not_found` / `not_allowed_token_type`.
// Detecting this up front lets us return a clearer error before we hit the API.

export type SlackTokenType = "user" | "bot" | "app" | "unknown";

export function detectTokenType(token: string | undefined): SlackTokenType {
  if (!token) return "unknown";
  if (token.startsWith("xoxp-")) return "user";
  if (token.startsWith("xoxb-")) return "bot";
  if (token.startsWith("xoxa-") || token.startsWith("xapp-")) return "app";
  return "unknown";
}

// ─── Concurrency cap + Retry-After (P6) ────────────────────────────────────────

/** Max in-flight Slack API calls at once. Keeps parallel tool calls from
 *  instantly tripping Slack's tier-2/3 rate limits. */
const MAX_CONCURRENT = 3;
/** Cap the honored Retry-After so we never hang a tool call indefinitely. */
const MAX_RETRY_AFTER_SECONDS = 30;
/** Per-request timeout (ms). Bounds a single Slack HTTP call so a half-open
 *  TCP connection or middlebox stall can't hang a tool invocation forever.
 *  Slack p99 for the endpoints we call is well under 10 s; 30 s is generous. */
const REQUEST_TIMEOUT_MS = 30_000;

let inFlight = 0;
const waitQueue: Array<() => void> = [];

/** Run `fn` through the global Slack-API concurrency semaphore. */
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waitQueue.push(resolve));
  }
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    const next = waitQueue.shift();
    if (next) next();
  }
}

/** Compose a per-request timeout signal with the caller's signal (if any)
 *  using AbortSignal.any. Returns the composite signal plus a flag the
 *  caller can check to tell a timeout-triggered abort from a user abort. */
function withRequestTimeout(signal: AbortSignal | undefined): {
  signal: AbortSignal;
  timeoutSignal: AbortSignal;
} {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  return { signal: combined, timeoutSignal };
}

/** Fetch with a single automatic retry on HTTP 429, honoring Retry-After.
 *  The request builder callback is re-invoked on retry so body streams don't
 *  get consumed twice.
 *
 *  Each attempt is bounded by REQUEST_TIMEOUT_MS via AbortSignal.timeout
 *  composed with the caller's signal. This is the primary defense against
 *  Slack API calls hanging on half-open TCP connections (issue #17). */
async function fetchWithRetry(
  buildRequest: () => { url: string; init: RequestInit },
  signal?: AbortSignal,
): Promise<Response> {
  const first = buildRequest();
  const firstBudget = withRequestTimeout(signal);
  let response = await fetch(first.url, { ...first.init, signal: firstBudget.signal });

  if (response.status !== 429) return response;

  const headerValue = response.headers.get("retry-after");
  const parsed = headerValue ? Number.parseFloat(headerValue) : NaN;
  // Leave at least 5 s of budget for the retry request itself so a slow
  // Retry-After + slow response don't consume the whole timeout envelope.
  const maxWait = Math.max(1, MAX_RETRY_AFTER_SECONDS - 5);
  const waitSeconds = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), maxWait) : 2;

  await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000 + 100));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const second = buildRequest();
  const secondBudget = withRequestTimeout(signal);
  response = await fetch(second.url, { ...second.init, signal: secondBudget.signal });
  return response;
}

// ─── Team ID resolution ─────────────────────────────────────────────────────────

let detectedTeamId = "";

/** Remember the workspace team ID detected from auth.test so Enterprise Grid
 *  API calls can include team_id even when SLACK_TEAM_ID is not configured.
 *  An explicit SLACK_TEAM_ID env var still wins, because it may point at a
 *  different workspace inside an Enterprise Grid org. */
export function setDetectedTeamId(teamId: string | undefined): void {
  detectedTeamId = typeof teamId === "string" ? teamId.trim() : "";
}

export function getTeamId(): string {
  return process.env[ENV_TEAM_ID]?.trim() || detectedTeamId;
}

// ─── assistant.search.context channel-types default (P5) ──────────────────────────────
//
// Slack's `assistant.search.context` defaults `channel_types` to public and
// private channels only. If we don't pass the param, DMs and multi-party IMs
// are silently excluded from results — which is almost never what a user
// searching their own workspace wants. Default to the full set so search,
// research, and channel-name lookups all see the same conversation surface.
export const DEFAULT_ASSISTANT_CHANNEL_TYPES = "public_channel,private_channel,mpim,im";

// ─── Limit helper ───────────────────────────────────────────────────────────────

export function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

// ─── Timestamp helpers ──────────────────────────────────────────────────────────

export function tsToLabel(ts: string | undefined): string {
  if (!ts) return "unknown-time";
  const millis = Number.parseFloat(ts) * 1000;
  if (!Number.isFinite(millis)) return ts;
  return new Date(millis).toISOString();
}

export function relativeTime(ts: string | undefined): string {
  if (!ts) return "";
  const millis = Number.parseFloat(ts) * 1000;
  if (!Number.isFinite(millis)) return ts;
  const diff = Date.now() - millis;
  if (diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(millis).toLocaleDateString();
}

// ─── Slack API callers ──────────────────────────────────────────────────────────

/** POST with application/x-www-form-urlencoded body. */
export async function slackApi<T>(
  endpoint: string,
  token: string,
  params: FormParams,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  const teamId = getTeamId();
  const paramsWithTeam = teamId ? { ...params, team_id: params.team_id || teamId } : params;

  return withSlot(async () => {
    try {
      const response = await fetchWithRetry(() => {
        const body = new URLSearchParams();
        for (const [key, value] of Object.entries(paramsWithTeam)) {
          if (value !== undefined && value !== "") body.set(key, String(value));
        }
        return {
          url: `${SLACK_API_BASE}/${endpoint}`,
          init: {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
          },
        };
      }, signal);

      const json = await safeJson(response);
      captureAuthHeaders(response);
      return toApiResult<T>(response, json);
    } catch (error) {
      return classifyFetchError<T>(error, signal);
    }
  });
}

/** POST with application/json body. */
export async function slackApiJson<T>(
  endpoint: string,
  token: string,
  params: JsonCompatibleParams,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  const teamId = getTeamId();
  const paramsWithTeam = teamId ? { ...params, team_id: params.team_id || teamId } : params;

  return withSlot(async () => {
    try {
      const response = await fetchWithRetry(() => {
        return {
          url: `${SLACK_API_BASE}/${endpoint}`,
          init: {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(paramsWithTeam),
          },
        };
      }, signal);

      const json = await safeJson(response);
      captureAuthHeaders(response);
      return toApiResult<T>(response, json);
    } catch (error) {
      return classifyFetchError<T>(error, signal);
    }
  });
}

/** Turn a thrown fetch error into a typed ApiResult. Re-throws caller-triggered
 *  aborts so user cancel semantics are preserved; maps timeout-triggered aborts
 *  (no caller abort) to `request_timeout`, and any other fetch failure (DNS,
 *  ECONNRESET, TLS, etc.) to `network_error`. The withSlot `finally` handles
 *  releasing the concurrency slot regardless. */
function classifyFetchError<T>(error: unknown, callerSignal?: AbortSignal): ApiResult<T> {
  // Caller cancelled → propagate. Don't swallow user aborts into an ApiResult.
  if (callerSignal?.aborted) throw error;

  const name = (error as { name?: string } | null)?.name;
  if (name === "AbortError" || name === "TimeoutError") {
    return { ok: false, error: "request_timeout" };
  }
  return { ok: false, error: "network_error" };
}

/** Slack sometimes returns non-JSON bodies on 4xx/5xx. Parse defensively. */
async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function toApiResult<T>(response: Response, json: unknown): ApiResult<T> {
  const envelope = isSlackApiEnvelope(json) ? json : {};

  // Slack sometimes surfaces rate limits as HTTP 429 (with no JSON body) and
  // sometimes as an ok:false envelope with error="ratelimited". Normalize both.
  if (response.status === 429 || envelope.error === "ratelimited") {
    return { ok: false, error: "rate_limited" };
  }

  if (!response.ok) {
    return { ok: false, error: `http_${response.status}` };
  }

  if (!envelope.ok) {
    return {
      ok: false,
      error: envelope.error || "unknown_error",
      needed: envelope.needed,
      provided: envelope.provided,
    };
  }

  return { ok: true, data: json as T };
}

function isSlackApiEnvelope(value: unknown): value is SlackApiEnvelope {
  return typeof value === "object" && value !== null;
}

// ─── User resolution cache ──────────────────────────────────────────────────────

const userCache = new Map<string, string>();

export function getUserCache(): Map<string, string> {
  return userCache;
}

/** Synchronous best-effort lookup. Returns the display name if cached,
 *  otherwise the original ID. Safe to call from render paths. */
export function resolveUserNameFromCache(userId: string): string {
  if (!userId) return "";
  return userCache.get(userId) || userId;
}

/** Rewrite `<@UID>` and `<@UID|label>` tokens in a message body using the
 *  already-pre-warmed user cache. Zero extra API calls. Unresolved IDs fall
 *  back to their label (if present) or to the original ID. */
export function resolveUserMentionsInText(text: string): string {
  if (!text) return "";
  return text.replace(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, label) => {
    const name = userCache.get(id);
    if (name) return `@${name}`;
    if (label) return `@${label}`;
    return `@${id}`;
  });
}

// ─── Channel resolution cache (P6 — VP-demo polish) ────────────────────────────

const channelCache = new Map<string, string>(); // id → name (no leading #)

export function getChannelCache(): Map<string, string> {
  return channelCache;
}

/** Synchronous best-effort lookup for a channel name by ID. Used from render
 *  paths to turn `C0123456789` into `#project-support`. */
export function resolveChannelNameFromCache(channelId: string): string {
  if (!channelId) return "";
  return channelCache.get(channelId) || channelId;
}

/** Harvest `{channel_id, channel_name}` pairs from search / research matches
 *  into the shared channel cache.
 *
 *  Every call to `assistant.search.context` and `search.messages` returns
 *  these fields in each hit; we previously discarded them after rendering,
 *  which meant a follow-up `slack action:'history'` on an ID we just surfaced
 *  would fail verification via `conversations.info` (e.g. on enterprise grid
 *  cross-workspace channels) and fall into the HITL dialog with no way out.
 *
 *  Populating the cache from the response that produced the ID fixes the
 *  dialog both structurally (`resolveChannel` can short-circuit on a
 *  cache-by-ID hit) and cosmetically (the candidate label renders as
 *  `#alpha-dev (C0AAA00001)` instead of the raw ID).
 *
 *  Safe to call on empty/undefined arrays; a no-op when names are missing. */
export function warmChannelCacheFromMatches(
  matches:
    | ReadonlyArray<{
        channel_id?: string;
        channel_name?: string;
        channel?: { id?: string; name?: string };
      }>
    | undefined,
): void {
  if (!matches || matches.length === 0) return;
  for (const match of matches) {
    const id = match.channel_id || match.channel?.id;
    const name = match.channel_name || match.channel?.name;
    if (id && name && name !== id) {
      channelCache.set(id, name);
    }
  }
}

/** Harvest `{author_user_id, author_name/username}` pairs from search /
 *  research matches into the shared user cache.
 *
 *  Mirror of `warmChannelCacheFromMatches`, built for the same failure mode
 *  one level over: `slack_resolve type=user` (and `slack_user action:'list'`)
 *  call `users.list`, which fails with `team_access_not_granted` on enterprise
 *  grid, leaves zero candidates, and the agent is stuck spelling the name
 *  blind. Slackbot, by contrast, side-steps by searching messages/files and
 *  mining author names from the hits.
 *
 *  `assistant.search.context` (and `search.messages`) already carries
 *  `{author_user_id, username, author_name}` in every hit. Populating the
 *  cache from those hits lets `findUsersInCache` return useful candidates
 *  even when the directory is gated.
 *
 *  Safe to call on empty/undefined arrays; a no-op when names are missing. */
export function warmUserCacheFromMatches(
  matches:
    | ReadonlyArray<{
        author_user_id?: string;
        user?: string;
        username?: string;
        author_name?: string;
      }>
    | undefined,
): void {
  if (!matches || matches.length === 0) return;
  for (const match of matches) {
    const id = match.author_user_id || match.user;
    const name = match.author_name || match.username;
    if (id && name && name !== id) {
      // Prefer the first good name we see; don't clobber a cached
      // display_name with a later, less-rich author_name from another hit.
      if (!userCache.has(id) || userCache.get(id) === id) {
        userCache.set(id, name);
      }
    }
  }
}

/** Best-effort async resolve of a channel ID to its name. Uses
 *  `conversations.info` first; on missing-scope falls back to
 *  `assistant.search.context` (which returns channel_name in hits).
 *  Silently caches the ID as its own name on failure so we don't
 *  thrash the API. */
export async function resolveChannelName(
  token: string,
  channelId: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!channelId) return "";
  const cached = channelCache.get(channelId);
  if (cached) return cached;

  // Fast path: conversations.info
  const info = await slackApi<ConversationsInfoResponse>(
    "conversations.info",
    token,
    { channel: channelId },
    signal,
  );
  if (info.ok && info.data.channel?.name) {
    channelCache.set(channelId, info.data.channel.name);
    return info.data.channel.name;
  }

  // Fallback: search. Include DMs + MPIMs so ID-to-name resolution works
  // for conversations that wouldn't appear under the default public/private
  // filter.
  const searchParams: Record<string, string | number> = {
    query: `in:${channelId}`,
    count: 1,
    channel_types: DEFAULT_ASSISTANT_CHANNEL_TYPES,
  };
  const teamId = getTeamId();
  if (teamId) searchParams.team_id = teamId;

  const search = await slackApiJson<AssistantSearchContextResponse>(
    "assistant.search.context",
    token,
    searchParams,
    signal,
  );
  const hit = search.ok ? search.data.results?.messages?.[0] : undefined;
  const name = hit?.channel_name || hit?.channel?.name;
  if (name) {
    channelCache.set(channelId, name);
    return name;
  }

  // Cache the ID as its own "name" to avoid repeat lookups this session.
  channelCache.set(channelId, channelId);
  return channelId;
}

export async function resolveUserName(
  token: string,
  userId: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!userId) return "unknown-user";
  const cached = userCache.get(userId);
  if (cached) return cached;

  const result = await slackApi<UsersInfoResponse>("users.info", token, { user: userId }, signal);
  if (result.ok) {
    const name = getBestUserName(result.data.user) || userId;
    userCache.set(userId, name);
    return name;
  }

  userCache.set(userId, userId);
  return userId;
}

export async function resolveUserNames(
  token: string,
  userIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const results = new Map<string, string>();

  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    const names = await Promise.all(batch.map((id) => resolveUserName(token, id, signal)));
    batch.forEach((id, idx) => results.set(id, names[idx]));
  }

  return results;
}

/** Warm the shared user cache for every ID in `userIds` that isn't already
 *  cached. Fire-and-forget style: callers don't need the return map; the
 *  render path reads directly from the cache afterwards.
 *
 *  This is the "always resolve" entry point used by the tool layer so that
 *  raw `<@UID>` tokens and author IDs never reach the renderer. */
export async function warmUserCacheForIds(
  token: string,
  userIds: string[],
  signal?: AbortSignal,
): Promise<void> {
  if (!userIds.length) return;
  const cache = userCache;
  const missing = [...new Set(userIds.filter(Boolean))].filter((id) => !cache.has(id));
  if (missing.length === 0) return;
  await resolveUserNames(token, missing, signal);
}

/** Pre-warm the user cache with the first page of workspace users. */
export async function prewarmUserCache(token: string, signal?: AbortSignal): Promise<number> {
  const result = await slackApi<UsersListResponse>("users.list", token, { limit: 200 }, signal);
  if (!result.ok) return 0;

  const members = Array.isArray(result.data.members) ? result.data.members : [];
  for (const member of members) {
    const name = getBestUserName(member);
    if (member.id && name) {
      userCache.set(member.id, name);
    }
  }
  return userCache.size;
}

/** Pre-warm the channel cache with the first page of channels the user is a
 *  member of. Best-effort: needs `channels:read` / `groups:read`. Without
 *  those scopes this is a no-op and the render path falls back to raw IDs,
 *  which is still correct, just less pretty.
 *
 *  Called from session_start (fire-and-forget) so that the very first
 *  `slack` tool invocation's renderCall header can already show
 *  `#alpha-dev` instead of `#C0BBB00002`. */
export async function prewarmChannelCache(token: string, signal?: AbortSignal): Promise<number> {
  const result = await slackApi<ConversationsListResponse>(
    "conversations.list",
    token,
    {
      limit: 200,
      exclude_archived: true,
      types: "public_channel,private_channel",
    },
    signal,
  );
  if (!result.ok) return 0;

  const channels = Array.isArray(result.data.channels) ? result.data.channels : [];
  for (const channel of channels) {
    if (channel.id && channel.name) {
      channelCache.set(channel.id, channel.name);
    }
  }
  return channelCache.size;
}

function getBestUserName(user?: {
  name?: string;
  real_name?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
  };
}): string | undefined {
  if (!user) return undefined;
  return user.profile?.display_name || user.profile?.real_name || user.real_name || user.name;
}

// ─── Error helpers ──────────────────────────────────────────────────────────────

// ─── chat.postMessage + conversations.open (slack_send) ───────────────────────────
//
// Typed helpers for the two endpoints slack_send touches. chat.postMessage
// goes through the JSON caller because Slack recommends JSON bodies for
// non-trivial `text` (preserves newlines and unicode without URL-encoding
// gotchas). conversations.open is form-encoded to match Slack's example.

export async function chatPostMessage(
  token: string,
  body: JsonCompatibleParams,
  signal?: AbortSignal,
): Promise<ApiResult<ChatPostMessageResponse>> {
  return slackApiJson<ChatPostMessageResponse>("chat.postMessage", token, body, signal);
}

export async function conversationsOpenDM(
  token: string,
  userIds: string[],
  signal?: AbortSignal,
): Promise<ApiResult<ConversationsOpenResponse>> {
  return slackApi<ConversationsOpenResponse>(
    "conversations.open",
    token,
    { users: userIds.join(","), return_im: true },
    signal,
  );
}

export function summarizeSlackError(error: string, needed?: string, provided?: string): string {
  switch (error) {
    case "missing_scope":
      return (
        `Slack token is missing required scope. Needed: ${needed || "unknown"}. ` +
        `Provided: ${provided || "unknown"}. Re-run /login sf-slack to re-consent with the needed scopes.`
      );
    case "not_authed":
    case "invalid_auth":
    case "token_revoked":
      return "Slack auth is invalid or missing. Run /login sf-slack, use macOS Keychain, or set SLACK_USER_TOKEN.";
    case "token_expired":
      return "Slack token expired. Run /login sf-slack, or try /sf-slack refresh to re-auth.";
    case "bot_scopes_not_found":
    case "not_allowed_token_type":
      return (
        "Slack rejected this action because the token type is wrong. " +
        "This workspace needs a user token (xoxp-) for canvas writes and some admin calls, but the configured token appears to be a bot token (xoxb-) or app token. " +
        "Re-run /login sf-slack with a user token."
      );
    case "channel_not_found":
      return "Slack channel not found or the token cannot access it.";
    case "not_in_channel":
      return "Slack rejected the send: the token is not a member of the target channel. Join the channel first, or use a channel where the user is a member.";
    case "is_archived":
      return "Slack rejected the send: the target channel is archived.";
    case "msg_too_long":
      return "Slack rejected the send: message body exceeds the 40,000-character limit. Shorten the text and try again.";
    case "no_text":
      return "Slack rejected the send: message body is empty.";
    case "cannot_dm_bot":
      return "Slack rejected the send: cannot DM a bot user. Pick a human recipient.";
    case "missing_argument":
      return "Slack API reported a missing required argument. On Enterprise Grid, run /sf-slack refresh or set SLACK_TEAM_ID so calls can include team_id.";
    case "thread_not_found":
      return "Slack thread not found. Ensure the ts is a valid parent message timestamp.";
    case "rate_limited":
    case "http_429":
      return "Slack is rate-limiting this workspace — the call retried once and was still throttled. Wait a few seconds and try again.";
    case "team_access_not_granted":
      return (
        "Slack blocked this directory call with team_access_not_granted — typical on Enterprise Grid when the target lives in another workspace. " +
        "For user/channel lookups, slack_resolve now falls back to assistant.search.context automatically. " +
        "For direct reads, ask for a specific Slack ID or search messages first (slack action:'search' / slack_research) and pick the author/channel from a hit."
      );
    case "request_timeout":
      return (
        "Slack API call timed out after 30s. This is usually a half-open TCP connection or a network hop stalling mid-response. " +
        "Retry the command. If it keeps timing out, check VPN/proxy settings or try again in a minute."
      );
    case "network_error":
      return "Slack API call failed due to a network error (DNS, connection reset, or TLS). Retry the command; check connectivity if it persists.";
    default:
      return `Slack API error: ${error}`;
  }
}

export function errorResult(error: string, needed?: string, provided?: string) {
  return {
    content: [{ type: "text" as const, text: summarizeSlackError(error, needed, provided) }],
    details: { ok: false, reason: error, needed, provided },
  };
}
