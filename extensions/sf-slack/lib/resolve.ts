/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Entity resolution for sf-slack.
 *
 * This layer converts fuzzy human references into Slack primitives. The goal is
 * to keep Slack API quirks out of the LLM loop: tools can accept names like
 * "team lab" or "Jane Doe" and resolve them to channel/user IDs before making
 * raw Slack API calls.
 */
import {
  DEFAULT_LIST_LIMIT,
  type ApiErr,
  type AssistantSearchContextResponse,
  type ConversationsInfoResponse,
  type ConversationsListResponse,
  type ResolveResult,
  type ResolvedChannel,
  type ResolvedUser,
  type SlackConversation,
  type SlackSearchMatch,
  type SlackUser,
  type UsersInfoResponse,
  type UsersListResponse,
  type UsersLookupByEmailResponse,
} from "./types.ts";
import {
  slackApi,
  slackApiJson,
  clampLimit,
  getChannelCache,
  getTeamId,
  getUserCache,
  warmChannelCacheFromMatches,
  warmUserCacheFromMatches,
  DEFAULT_ASSISTANT_CHANNEL_TYPES,
} from "./api.ts";

const CHANNEL_ID_RE = /^[CGD][A-Z0-9]{8,}$/;
const USER_ID_RE = /^[UW][A-Z0-9]{8,}$/;
const LOW_CONFIDENCE_THRESHOLD = 0.6;
const AUTO_SELECT_THRESHOLD = 0.85;

interface ResolveOptions {
  limit?: number;
}

export function isSlackChannelId(value: string | undefined): boolean {
  return !!value && CHANNEL_ID_RE.test(value.trim());
}

export function isSlackUserId(value: string | undefined): boolean {
  return !!value && USER_ID_RE.test(value.trim());
}

export async function resolveChannel(
  token: string,
  ref: string,
  signal?: AbortSignal,
  options: ResolveOptions = {},
): Promise<ResolveResult<ResolvedChannel>> {
  const input = String(ref || "").trim();
  const limit = clampLimit(options.limit, 5, 10);
  const strategy: string[] = [];
  const warnings: string[] = [];
  const candidates = new Map<string, ResolvedChannel>();

  if (!input) {
    return emptyResolve("channel", input, ["missing_input"], ["No channel reference provided."]);
  }

  if (isSlackChannelId(input)) {
    // Fast path: a prior slack_research / slack search already populated
    // {id → name} into the shared cache. Return a 1.0-confidence candidate
    // without hitting the network. This is the grid-friendly path:
    // `assistant.search.context` can cross workspace boundaries and name
    // channels whose conversations.info is gated by team_access_not_granted.
    const cachedName = getChannelCache().get(input);
    if (cachedName && cachedName !== input) {
      strategy.push("cache_by_id");
      addChannelCandidate(candidates, {
        id: input,
        name: cachedName,
        confidence: 1,
        source: "cache_by_id",
      });
      return finalizeResolve("channel", input, candidates, strategy, warnings, limit);
    }

    strategy.push("channel_id");
    const resolved = await resolveChannelById(token, input, signal);
    if (resolved) {
      addChannelCandidate(candidates, resolved);
      return finalizeResolve("channel", input, candidates, strategy, warnings, limit);
    }
    warnings.push(
      `Channel ID "${input}" is syntactically valid but could not be verified via conversations.info. ` +
        "The token may lack channels:read or the ID may not exist in this workspace.",
    );
    // Fall through to cache / conversations.list / search lookups in case
    // the ID happens to appear under a different access path.
  }

  strategy.push("cache_lookup");
  const cachedCandidates = findChannelsInCache(input);
  for (const candidate of cachedCandidates) addChannelCandidate(candidates, candidate);

  strategy.push("conversations.list");
  const listed = await listChannelCandidates(token, input, signal);
  for (const candidate of listed) addChannelCandidate(candidates, candidate);

  if (candidates.size === 0 || bestConfidence(candidates) < AUTO_SELECT_THRESHOLD) {
    strategy.push("assistant.search.context");
    const searched = await searchChannelCandidates(token, input, signal);
    for (const candidate of searched) addChannelCandidate(candidates, candidate);
  }

  if (candidates.size === 0) {
    warnings.push(
      "No channel candidates found. Try a broader name or use an exact Slack channel ID.",
    );
  }

  return finalizeResolve("channel", input, candidates, strategy, warnings, limit);
}

export async function resolveUser(
  token: string,
  ref: string,
  signal?: AbortSignal,
  options: ResolveOptions = {},
): Promise<ResolveResult<ResolvedUser>> {
  const input = String(ref || "").trim();
  const limit = clampLimit(options.limit, 5, 10);
  const strategy: string[] = [];
  const warnings: string[] = [];
  const candidates = new Map<string, ResolvedUser>();

  if (!input) {
    return emptyResolve("user", input, ["missing_input"], ["No user reference provided."]);
  }

  if (input.toLowerCase() === "me") {
    strategy.push("self_alias");
    addUserCandidate(candidates, {
      id: "me",
      handle: "me",
      displayName: "me",
      realName: "me",
      email: "",
      confidence: 1,
      source: "self_alias",
    });
    return finalizeResolve("user", input, candidates, strategy, warnings, limit);
  }

  if (isSlackUserId(input)) {
    strategy.push("user_id");
    const resolved = await resolveUserById(token, input, signal);
    if (resolved) addUserCandidate(candidates, resolved);
    return finalizeResolve("user", input, candidates, strategy, warnings, limit);
  }

  if (input.includes("@") && input.includes(".")) {
    strategy.push("users.lookupByEmail");
    const byEmail = await resolveUserByEmail(token, input, signal);
    if (byEmail) addUserCandidate(candidates, byEmail);
  }

  strategy.push("cache_lookup");
  for (const candidate of findUsersInCache(input)) addUserCandidate(candidates, candidate);

  if (candidates.size === 0 || bestConfidence(candidates) < AUTO_SELECT_THRESHOLD) {
    strategy.push("users.list");
    const listed = await listUserCandidates(token, input, signal);
    for (const candidate of listed) addUserCandidate(candidates, candidate);
  }

  // Grid-safe fallback: when `users.list` returns `team_access_not_granted`
  // or simply no fuzzy hits, mine author names out of message search. This
  // is the same pattern Slackbot uses when a human asks for someone it
  // can't find in its directory, and it's the mirror of the channel
  // `assistant.search.context` fallback above. Without this, enterprise
  // grid users hit a dead end on every misspelled name (e.g. "McCula" for
  // "Mikula").
  if (candidates.size === 0 || bestConfidence(candidates) < AUTO_SELECT_THRESHOLD) {
    strategy.push("assistant.search.context");
    const searched = await searchUserCandidates(token, input, signal);
    for (const candidate of searched) addUserCandidate(candidates, candidate);
  }

  if (candidates.size === 0) {
    warnings.push("No user candidates found. Try a Slack user ID, email, handle, or display name.");
  }

  return finalizeResolve("user", input, candidates, strategy, warnings, limit);
}

export function formatResolveResult<T extends ResolvedChannel | ResolvedUser>(
  result: ResolveResult<T>,
): string {
  const lines: string[] = [];
  lines.push(`Resolve ${result.type}: ${result.input}`);
  lines.push(`Status: ${result.ok ? "ok" : "not resolved"}`);
  lines.push(`Confidence: ${result.confidence.toFixed(2)}`);
  if (result.strategy.length) lines.push(`Strategy: ${result.strategy.join(" → ")}`);
  for (const warning of result.warnings) lines.push(`Warning: ${warning}`);

  if (result.best) {
    lines.push("");
    lines.push("Best match:");
    lines.push(formatCandidate(result.best, 1));
  }

  if (result.candidates.length > 1) {
    lines.push("");
    lines.push("Alternates:");
    for (let i = 1; i < result.candidates.length; i++) {
      lines.push(formatCandidate(result.candidates[i], i + 1));
    }
  }

  return lines.join("\n");
}

function formatCandidate(candidate: ResolvedChannel | ResolvedUser, index: number): string {
  if ("name" in candidate) {
    return `${index}. #${candidate.name} (${candidate.id}) — confidence ${candidate.confidence.toFixed(2)} via ${candidate.source}`;
  }
  const handle = candidate.handle ? ` @${candidate.handle}` : "";
  return `${index}. ${candidate.displayName || candidate.realName || candidate.id}${handle} (${candidate.id}) — confidence ${candidate.confidence.toFixed(2)} via ${candidate.source}`;
}

/** Verify a raw channel ID via conversations.info.
 *
 *  Returns `undefined` when the ID cannot be verified. Previously this
 *  helper fabricated a 0.75-confidence candidate for unverified IDs,
 *  which was enough to pass the permissive internal 0.60 threshold in
 *  slack / slack_channel / slack_file — letting bogus IDs like
 *  C09ZZZZZZZZ survive resolution. The HITL migration removes those
 *  permissive paths, and we now only return a candidate when Slack
 *  itself confirms the ID. Callers that want to expose the raw ID in
 *  an error message still see it via the `input` field of
 *  `ResolveResult`. */
async function resolveChannelById(
  token: string,
  channelId: string,
  signal?: AbortSignal,
): Promise<ResolvedChannel | undefined> {
  const info = await slackApi<ConversationsInfoResponse>(
    "conversations.info",
    token,
    { channel: channelId, include_num_members: true },
    signal,
  );
  if (info.ok && info.data.channel?.name) {
    const channel = toResolvedChannel(info.data.channel, 1, "conversations.info");
    getChannelCache().set(channel.id, channel.name);
    return channel;
  }
  // conversations.info failed (team_access_not_granted, channel_not_found,
  // missing_scope, etc). Don't fabricate a candidate.
  return undefined;
}

function findChannelsInCache(ref: string): ResolvedChannel[] {
  const candidates: ResolvedChannel[] = [];
  for (const [id, name] of getChannelCache()) {
    const confidence = scoreName(ref, name);
    if (confidence >= LOW_CONFIDENCE_THRESHOLD) {
      candidates.push({ id, name, confidence, source: "cache" });
    }
  }
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

async function listChannelCandidates(
  token: string,
  ref: string,
  signal?: AbortSignal,
): Promise<ResolvedChannel[]> {
  const result = await slackApi<ConversationsListResponse>(
    "conversations.list",
    token,
    {
      types: "public_channel,private_channel",
      limit: DEFAULT_LIST_LIMIT,
      exclude_archived: true,
    },
    signal,
  );
  if (!result.ok) return [];

  const channels = Array.isArray(result.data.channels) ? result.data.channels : [];
  return channels
    .map((channel) => {
      const name = channel.name || channel.name_normalized || "";
      const confidence = scoreName(ref, name);
      if (confidence < LOW_CONFIDENCE_THRESHOLD) return undefined;
      return toResolvedChannel(channel, confidence, "conversations.list");
    })
    .filter((value): value is ResolvedChannel => Boolean(value))
    .sort((a, b) => b.confidence - a.confidence);
}

async function searchChannelCandidates(
  token: string,
  ref: string,
  signal?: AbortSignal,
): Promise<ResolvedChannel[]> {
  const candidates = new Map<string, ResolvedChannel>();
  for (const query of buildChannelDiscoveryQueries(ref)) {
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
    // Populate the shared ID→name cache from every hit, not just the ones
    // that fuzzy-match `ref`. A future slack action:'history' on any of
    // these IDs will now short-circuit on cache_by_id instead of prompting.
    warmChannelCacheFromMatches(matches);
    for (const match of matches) {
      const channel = channelFromSearchMatch(ref, match);
      if (channel) addChannelCandidate(candidates, channel);
    }
  }
  return Array.from(candidates.values()).sort((a, b) => b.confidence - a.confidence);
}

function channelFromSearchMatch(ref: string, match: SlackSearchMatch): ResolvedChannel | undefined {
  const id = match.channel_id || match.channel?.id;
  const name = match.channel_name || match.channel?.name;
  if (!id || !name) return undefined;
  const confidence = Math.max(0.55, scoreName(ref, name) * 0.95);
  if (confidence < LOW_CONFIDENCE_THRESHOLD) return undefined;
  return { id, name, confidence, source: "assistant.search.context" };
}

/** Mirror of `searchChannelCandidates` for users. Runs the ref through
 *  `assistant.search.context` (same grid-friendly API), harvests
 *  `{author_user_id, author_name/username}` out of every hit into the
 *  shared user cache, and returns fuzzy candidates scored against the
 *  input. This is the fallback we use when `users.list` returns
 *  `team_access_not_granted` or zero useful hits.
 *
 *  Confidence is capped below 0.85 (auto-select threshold) because the
 *  author names from search come straight from message metadata and are
 *  not a directory-confirmed canonical profile. The HITL dialog is still
 *  the right UX for ambiguous matches, but now the user actually has
 *  candidates to pick from instead of a dead end. */
async function searchUserCandidates(
  token: string,
  ref: string,
  signal?: AbortSignal,
): Promise<ResolvedUser[]> {
  const candidates = new Map<string, ResolvedUser>();
  for (const query of buildUserDiscoveryQueries(ref)) {
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
    // Harvest every {id → name} into the shared cache so a follow-up
    // resolveUser or render path short-circuits via cache.
    warmUserCacheFromMatches(matches);
    for (const match of matches) {
      const user = userFromSearchMatch(ref, match);
      if (user) addUserCandidate(candidates, user);
    }
  }
  return Array.from(candidates.values()).sort((a, b) => b.confidence - a.confidence);
}

function userFromSearchMatch(ref: string, match: SlackSearchMatch): ResolvedUser | undefined {
  const id = match.author_user_id || match.user;
  const name = match.author_name || match.username;
  if (!id || !name) return undefined;
  const score = scoreName(ref, name);
  if (score < LOW_CONFIDENCE_THRESHOLD) return undefined;
  // Cap at 0.80 so the HITL dialog still opens. Directory-confirmed sources
  // (users.info, users.lookupByEmail) remain the only paths to 0.85+.
  const confidence = Math.min(0.8, score * 0.9);
  return {
    id,
    handle: displayNameToHandleGuess(name),
    displayName: name,
    realName: name,
    email: "",
    confidence,
    source: "assistant.search.context",
  };
}

async function resolveUserById(
  token: string,
  userId: string,
  signal?: AbortSignal,
): Promise<ResolvedUser | undefined> {
  const result = await slackApi<UsersInfoResponse>("users.info", token, { user: userId }, signal);
  if (!result.ok || !result.data.user) return undefined;
  const resolved = toResolvedUser(result.data.user, 1, "users.info");
  cacheResolvedUser(resolved);
  return resolved;
}

async function resolveUserByEmail(
  token: string,
  email: string,
  signal?: AbortSignal,
): Promise<ResolvedUser | undefined> {
  const result = await slackApi<UsersLookupByEmailResponse>(
    "users.lookupByEmail",
    token,
    { email },
    signal,
  );
  if (!result.ok || !result.data.user) return undefined;
  const resolved = toResolvedUser(result.data.user, 1, "users.lookupByEmail");
  cacheResolvedUser(resolved);
  return resolved;
}

function findUsersInCache(ref: string): ResolvedUser[] {
  const candidates: ResolvedUser[] = [];
  for (const [id, displayName] of getUserCache()) {
    const confidence = scoreName(ref, displayName);
    if (confidence >= LOW_CONFIDENCE_THRESHOLD) {
      candidates.push({
        id,
        handle: displayNameToHandleGuess(displayName),
        displayName,
        realName: displayName,
        email: "",
        confidence: Math.min(confidence, 0.8),
        source: "cache",
      });
    }
  }
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

async function listUserCandidates(
  token: string,
  ref: string,
  signal?: AbortSignal,
): Promise<ResolvedUser[]> {
  const result = await slackApi<UsersListResponse>("users.list", token, { limit: 200 }, signal);
  if (!result.ok) return [];

  const members = Array.isArray(result.data.members) ? result.data.members : [];
  return members
    .filter((member) => !member.is_bot && !member.deleted && member.id !== "USLACKBOT")
    .map((member) => {
      const confidence = scoreUser(ref, member);
      if (confidence < LOW_CONFIDENCE_THRESHOLD) return undefined;
      const resolved = toResolvedUser(member, confidence, "users.list");
      cacheResolvedUser(resolved);
      return resolved;
    })
    .filter((value): value is ResolvedUser => Boolean(value))
    .sort((a, b) => b.confidence - a.confidence);
}

function toResolvedChannel(
  channel: SlackConversation,
  confidence: number,
  source: string,
): ResolvedChannel {
  const id = channel.id || "unknown";
  const name = channel.name || channel.name_normalized || id;
  if (id !== "unknown" && name !== id) getChannelCache().set(id, name);
  return {
    id,
    name,
    confidence,
    source,
    isPrivate: !!channel.is_private,
    isArchived: !!channel.is_archived,
  };
}

function toResolvedUser(user: SlackUser, confidence: number, source: string): ResolvedUser {
  const profile = user.profile || {};
  const displayName =
    profile.display_name || profile.real_name || user.real_name || user.name || "";
  return {
    id: user.id || "unknown",
    handle: user.name || displayNameToHandleGuess(displayName),
    displayName,
    realName: profile.real_name || user.real_name || displayName,
    email: profile.email || "",
    confidence,
    source,
  };
}

function cacheResolvedUser(user: ResolvedUser): void {
  if (user.id && user.id !== "unknown" && user.displayName) {
    getUserCache().set(user.id, user.displayName);
  }
}

function addChannelCandidate(map: Map<string, ResolvedChannel>, candidate: ResolvedChannel): void {
  const existing = map.get(candidate.id);
  if (!existing || candidate.confidence > existing.confidence) {
    map.set(candidate.id, candidate);
  }
}

function addUserCandidate(map: Map<string, ResolvedUser>, candidate: ResolvedUser): void {
  const key = candidate.id || candidate.handle || candidate.displayName;
  const existing = map.get(key);
  if (!existing || candidate.confidence > existing.confidence) {
    map.set(key, candidate);
  }
}

function finalizeResolve<T extends ResolvedChannel | ResolvedUser>(
  type: "channel" | "user",
  input: string,
  map: Map<string, T>,
  strategy: string[],
  warnings: string[],
  limit: number,
): ResolveResult<T> {
  const candidates = Array.from(map.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
  const best = candidates[0];
  const confidence = best?.confidence ?? 0;
  if (best && confidence < AUTO_SELECT_THRESHOLD) {
    warnings.push(
      "Best match is below auto-select confidence; review candidates before using it for high-impact actions.",
    );
  }
  return {
    ok: candidates.length > 0,
    input,
    type,
    best,
    candidates,
    confidence,
    strategy,
    warnings,
  };
}

function emptyResolve<T extends ResolvedChannel | ResolvedUser>(
  type: "channel" | "user",
  input: string,
  strategy: string[],
  warnings: string[],
): ResolveResult<T> {
  return {
    ok: false,
    input,
    type,
    candidates: [],
    confidence: 0,
    strategy,
    warnings,
  };
}

function bestConfidence<T extends { confidence: number }>(map: Map<string, T>): number {
  let best = 0;
  for (const candidate of map.values()) best = Math.max(best, candidate.confidence);
  return best;
}

export function buildChannelDiscoveryQueries(ref: string): string[] {
  const raw = ref.trim().replace(/^#/, "");
  if (!raw) return [];
  const tokens = tokenize(raw);
  const queries = [
    `in:#${raw}`,
    `in:${raw}`,
    raw,
    tokens.join(" "),
    tokens.slice(0, 3).join(" "),
    normalizeName(raw),
  ];
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 8);
}

/** Build free-text queries for mining author names out of message search.
 *  Unlike the channel variant, we don't use `in:#` here — we want messages
 *  matching the person's name/handle anywhere. We do send individual
 *  tokens because enterprise grid users frequently have name misspellings
 *  (e.g. "McCula" vs "Mikula") where the full string doesn't hit but a
 *  last-name token does. */
export function buildUserDiscoveryQueries(ref: string): string[] {
  const raw = ref.trim().replace(/^@/, "");
  if (!raw) return [];
  const tokens = tokenize(raw);
  const queries = [raw, tokens.join(" "), ...tokens, normalizeName(raw)];
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 6);
}

function scoreUser(ref: string, user: SlackUser): number {
  const profile = user.profile || {};
  const values = [
    user.name,
    profile.display_name,
    profile.real_name,
    user.real_name,
    profile.email,
    profile.title,
  ].filter(Boolean) as string[];
  return Math.max(0, ...values.map((value) => scoreName(ref, value)));
}

export function scoreName(target: string, candidate: string): number {
  const targetNorm = normalizeName(target);
  const candidateNorm = normalizeName(candidate);
  if (!targetNorm || !candidateNorm) return 0;
  if (targetNorm === candidateNorm) return 0.98;
  if (candidateNorm.includes(targetNorm) || targetNorm.includes(candidateNorm)) return 0.9;

  const targetTokens = tokenize(target);
  const candidateTokens = tokenize(candidate);
  const tokenScore = coverageScore(targetTokens, candidateTokens);
  const compactTokenScore = coverageScore([targetTokens.join("")].filter(Boolean), candidateTokens);
  const editScore = normalizedEditSimilarity(targetNorm, candidateNorm);
  return Math.min(0.88, editScore * 0.45 + Math.max(tokenScore, compactTokenScore) * 0.55);
}

export function normalizeName(value: string): string {
  return value
    .replace(/^[@#]/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function coverageScore(targetTokens: string[], candidateTokens: string[]): number {
  if (targetTokens.length === 0) return 0;
  const covered = targetTokens.filter((target) =>
    candidateTokens.some((candidate) => tokenMatches(target, candidate)),
  );
  return covered.length / targetTokens.length;
}

function tokenMatches(target: string, candidate: string): boolean {
  return target === candidate || candidate.includes(target) || target.includes(candidate);
}

function tokenize(value: string): string[] {
  const base = value
    .replace(/^[@#]/, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
  const expanded = new Set(base);
  for (const token of base) {
    for (const suffix of ["lab", "labs", "dev", "ai", "fde", "sf", "pi"]) {
      if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
        expanded.add(token.slice(0, -suffix.length));
        expanded.add(suffix);
      }
    }
  }
  return Array.from(expanded).filter((token) => token.length > 1);
}

function displayNameToHandleGuess(value: string): string {
  return normalizeName(value);
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

export const __internals = {
  AUTO_SELECT_THRESHOLD,
  LOW_CONFIDENCE_THRESHOLD,
  normalizeName,
  scoreName,
  buildChannelDiscoveryQueries,
  buildUserDiscoveryQueries,
};
