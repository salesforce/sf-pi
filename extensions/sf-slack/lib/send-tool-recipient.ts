/* SPDX-License-Identifier: Apache-2.0 */
/**
 * slack_send recipient routing.
 *
 * Resolves the `to` reference into a Slack channel/DM ID + a structured
 * review payload that the confirmation dialog renders inline. Owns the
 * existing-DM fallback used when the token lacks `im:write` (we still
 * surface a usable result by discovering an already-open DM via search).
 *
 * Sibling of `./send-tool.ts`. Public surface is `routeRecipient` plus a
 * single helper (`buildExistingDmSearchQueries`) exported for tests.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type ApiErr,
  type AssistantSearchContextResponse,
  type ConversationsOpenResponse,
  type ResolveResult,
  type ResolvedChannel,
  type ResolvedUser,
  type SlackSearchMatch,
} from "./types.ts";
import { conversationsOpenDM, errorResult, hasScope, slackApiJson } from "./api.ts";
import { isSlackChannelId, isSlackUserId, resolveChannel, resolveUser } from "./resolve.ts";

/** Below this confidence we always route to the human-in-the-loop confirm dialog. */
const RECIPIENT_AUTO_CONFIRM_THRESHOLD = 0.85;

export interface RoutedRecipient {
  channelId: string;
  channelLabel?: string;
  recipientReview?: RecipientReview;
}

export interface RecipientReview {
  input: string;
  selected: string;
  confidence?: number;
  source?: string;
  alternates?: string[];
  warning?: string;
}

export interface RouteFailure {
  result: {
    content: { type: "text"; text: string }[];
    details: Record<string, unknown>;
  };
}

export async function routeRecipient(
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
