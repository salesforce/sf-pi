/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Human-in-the-loop recipient confirmation for sf-slack.
 *
 * Design principle:
 *   When sf-slack cannot confidently identify a channel or user, it must
 *   push the choice back to the human rather than silently proceeding with
 *   a borderline match or a syntactically-valid-but-unverified ID. This is
 *   the one shared primitive every workflow (send, history, thread, file
 *   lookup, etc.) uses so the UX is consistent.
 *
 * Contract:
 *   - Confidence >= AUTO_CONFIRM_THRESHOLD (0.85) + a concrete best match:
 *     return it directly, no dialog.
 *   - Interactive mode, below threshold:
 *       1. Show `ctx.ui.select` with the ranked candidates
 *       2. Always include "Type exact name/ID instead" and "Cancel" options
 *       3. If the user types, recurse with the new ref (no depth limit \u2014
 *          user drives the loop; Esc exits at any level)
 *   - Headless mode: fail loudly with the candidate list in the error so
 *     the user can re-invoke with an exact ref. Never auto-pick below
 *     threshold in headless contexts.
 *
 * The helper is a pure orchestrator over `resolve.ts`'s fuzzy resolvers
 * and `ctx.ui.select` / `ctx.ui.input`. It performs no network calls of
 * its own; it composes `resolveChannel()` / `resolveUser()` with the
 * interactive dialog helpers.
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ResolveResult, ResolvedChannel, ResolvedUser } from "./types.ts";
import { isSlackChannelId, isSlackUserId, resolveChannel, resolveUser } from "./resolve.ts";

/** Confidence >= this auto-confirms. Below this forces an interactive pick.
 *  Unified across reads and writes per the sprint design: safety > convenience. */
export const AUTO_CONFIRM_THRESHOLD = 0.85;

const TYPE_EXACT_LABEL = "\u2192 Type exact name/ID instead";
const CANCEL_LABEL = "Cancel";
const USE_AS_IS_PREFIX = "\u2192 Use ";

/** A single confirmed recipient (channel or user). The shape is a superset
 *  of the resolver return so callers don't need a separate type. */
export type ConfirmedRecipient =
  | { type: "channel"; channel: ResolvedChannel }
  | { type: "user"; user: ResolvedUser };

export type ConfirmResult =
  | { ok: true; recipient: ConfirmedRecipient }
  | {
      ok: false;
      reason: "cancelled" | "ambiguous_headless" | "not_found" | "headless_unverified";
      message: string;
      candidates: (ResolvedChannel | ResolvedUser)[];
    };

export interface ConfirmRecipientOptions {
  /** Title shown on the select dialog. Defaults to a generic prompt. */
  title?: string;
  /** Maximum candidates to surface in the select (the resolver still keeps
   *  more internally, but the dialog gets noisy above ~8). */
  limit?: number;
  /** Override the auto-confirm threshold. Tools that want "below-threshold
   *  is still fine, just warn" can pass a lower value; almost nobody should. */
  autoConfirmThreshold?: number;
}

export async function requireConfirmedChannel(
  ctx: ExtensionContext,
  token: string,
  ref: string,
  signal?: AbortSignal,
  options: ConfirmRecipientOptions = {},
): Promise<ConfirmResult> {
  return requireConfirmed(ctx, token, "channel", ref, signal, options);
}

export async function requireConfirmedUser(
  ctx: ExtensionContext,
  token: string,
  ref: string,
  signal?: AbortSignal,
  options: ConfirmRecipientOptions = {},
): Promise<ConfirmResult> {
  return requireConfirmed(ctx, token, "user", ref, signal, options);
}

async function requireConfirmed(
  ctx: ExtensionContext,
  token: string,
  type: "channel" | "user",
  initialRef: string,
  signal: AbortSignal | undefined,
  options: ConfirmRecipientOptions,
): Promise<ConfirmResult> {
  const threshold = options.autoConfirmThreshold ?? AUTO_CONFIRM_THRESHOLD;
  let ref = (initialRef || "").trim();
  if (!ref) {
    return {
      ok: false,
      reason: "not_found",
      message: `Missing ${type} reference.`,
      candidates: [],
    };
  }

  // Infinite loop: each iteration either returns a confirmed pick, pops a
  // new ref for the user to resolve, or exits with a typed outcome. The
  // only way to leave the loop without a pick is user cancellation or
  // a headless failure.
  for (;;) {
    const resolution = await resolveOnce(token, type, ref, signal, options.limit);

    // High-confidence match: auto-confirm.
    if (resolution.ok && resolution.best && resolution.confidence >= threshold) {
      return { ok: true, recipient: toConfirmed(type, resolution.best) };
    }

    // No UI: fail loudly. Headless callers opted in explicitly; they must
    // re-invoke with an exact ref.
    if (!ctx.hasUI) {
      if (resolution.ok && resolution.best) {
        return {
          ok: false,
          reason: "headless_unverified",
          message: buildHeadlessMessage(type, ref, resolution),
          candidates: resolution.candidates,
        };
      }
      return {
        ok: false,
        reason: "ambiguous_headless",
        message: buildHeadlessMessage(type, ref, resolution),
        candidates: resolution.candidates,
      };
    }

    // Interactive: build the select. Show candidates + "type exact" + "Cancel".
    //
    // When the input is itself a raw Slack ID (C09.../U09...) and no
    // candidate came back, we also offer a "Use ID as-is (unverified)"
    // escape hatch. This covers the grid case: `assistant.search.context`
    // can surface IDs from channels whose `conversations.info` is gated
    // by `team_access_not_granted` and whose name our cache doesn't have.
    // Before this option existed, the human's only paths were retype-the-
    // same-ID (same outcome) or cancel. Now they can accept the ID they
    // just handed us.
    const options_: string[] = [];
    const visible = resolution.candidates.slice(0, options.limit ?? 8);
    for (const candidate of visible) {
      options_.push(formatCandidate(candidate));
    }
    const rawIdFallback = buildRawIdFallback(type, ref, resolution);
    const useAsIsLabel = rawIdFallback
      ? `${USE_AS_IS_PREFIX}"${ref}" as-is (unverified)`
      : undefined;
    if (useAsIsLabel) options_.push(useAsIsLabel);
    options_.push(TYPE_EXACT_LABEL);
    options_.push(CANCEL_LABEL);

    const title =
      options.title ??
      (resolution.candidates.length > 0
        ? `Pick Slack ${type} for "${ref}" (best confidence ${resolution.confidence.toFixed(2)})`
        : `No Slack ${type} matched "${ref}" \u2014 type an exact ref or cancel`);

    const picked = await ctx.ui.select(title, options_, { signal });

    if (!picked || picked === CANCEL_LABEL) {
      return {
        ok: false,
        reason: "cancelled",
        message: `User cancelled ${type} resolution for "${ref}".`,
        candidates: resolution.candidates,
      };
    }

    if (useAsIsLabel && picked === useAsIsLabel && rawIdFallback) {
      return { ok: true, recipient: rawIdFallback };
    }

    if (picked === TYPE_EXACT_LABEL) {
      const typed = await ctx.ui.input(
        `Enter exact Slack ${type} name or ID`,
        type === "channel"
          ? "e.g. #project-support or C0123456789"
          : "e.g. @jane or U0123456789 or jane@example.com",
        { signal },
      );
      const trimmed = typed?.trim();
      if (!trimmed) {
        return {
          ok: false,
          reason: "cancelled",
          message: `User cancelled ${type} resolution.`,
          candidates: resolution.candidates,
        };
      }
      ref = trimmed;
      continue;
    }

    // User picked a candidate by its rendered label. Map back to the object.
    const pickedIndex = options_.indexOf(picked);
    if (pickedIndex >= 0 && pickedIndex < visible.length) {
      return { ok: true, recipient: toConfirmed(type, visible[pickedIndex]) };
    }

    // Shouldn't happen, but treat unexpected selection as cancellation.
    return {
      ok: false,
      reason: "cancelled",
      message: "Unrecognized selection.",
      candidates: resolution.candidates,
    };
  }
}

async function resolveOnce(
  token: string,
  type: "channel" | "user",
  ref: string,
  signal: AbortSignal | undefined,
  limit: number | undefined,
): Promise<ResolveResult<ResolvedChannel | ResolvedUser>> {
  // Raw IDs that happen to parse syntactically still go through the resolver
  // \u2014 this is the important change. Previously code paths short-circuited
  // on isSlackChannelId / isSlackUserId and skipped verification. The
  // resolver's by-ID branch hits conversations.info / users.info; if those
  // fail, we surface candidates / empty and let the human decide.
  const opts = { limit: limit ?? 10 };
  if (type === "channel") {
    return resolveChannel(token, ref, signal, opts);
  }
  return resolveUser(token, ref, signal, opts);
}

function toConfirmed(
  type: "channel" | "user",
  candidate: ResolvedChannel | ResolvedUser,
): ConfirmedRecipient {
  if (type === "channel") {
    return { type: "channel", channel: candidate as ResolvedChannel };
  }
  return { type: "user", user: candidate as ResolvedUser };
}

/** When `ref` is a raw Slack ID and no candidate came back, synthesize a
 *  minimal ConfirmedRecipient the user can opt into via the dialog. Returns
 *  `undefined` when the input isn't a raw ID — the normal fuzzy flow is the
 *  right UX in that case.
 *
 *  Safety: this path is only offered when resolution returned zero
 *  candidates. If Slack gave us a best guess (even a weak one), the user
 *  should pick from the ranked list rather than bypass it. */
function buildRawIdFallback(
  type: "channel" | "user",
  ref: string,
  resolution: ResolveResult<ResolvedChannel | ResolvedUser>,
): ConfirmedRecipient | undefined {
  if (resolution.candidates.length > 0) return undefined;
  if (type === "channel" && isSlackChannelId(ref)) {
    return {
      type: "channel",
      channel: {
        id: ref.trim(),
        name: ref.trim(),
        confidence: 0,
        source: "user_unverified",
      },
    };
  }
  if (type === "user" && isSlackUserId(ref)) {
    return {
      type: "user",
      user: {
        id: ref.trim(),
        handle: ref.trim(),
        displayName: ref.trim(),
        realName: ref.trim(),
        email: "",
        confidence: 0,
        source: "user_unverified",
      },
    };
  }
  return undefined;
}

function formatCandidate(candidate: ResolvedChannel | ResolvedUser): string {
  if ("name" in candidate) {
    return `#${candidate.name}   (${candidate.id}, ${confidencePercent(candidate.confidence)}%)`;
  }
  const label =
    (candidate as ResolvedUser).displayName ||
    (candidate as ResolvedUser).realName ||
    (candidate as ResolvedUser).handle ||
    candidate.id;
  return `${label}   (${candidate.id}, ${confidencePercent(candidate.confidence)}%)`;
}

function confidencePercent(confidence: number): number {
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

function buildHeadlessMessage(
  type: "channel" | "user",
  ref: string,
  resolution: ResolveResult<ResolvedChannel | ResolvedUser>,
): string {
  const header = resolution.ok
    ? `Slack ${type} "${ref}" resolved below the ${AUTO_CONFIRM_THRESHOLD} confidence threshold ` +
      `(best ${resolution.confidence.toFixed(2)}). Re-invoke with an exact name or ID.`
    : `Slack ${type} "${ref}" could not be resolved. Re-invoke with an exact name or ID.`;

  if (resolution.candidates.length === 0) {
    return header;
  }

  const lines: string[] = [header, "Candidates:"];
  for (const candidate of resolution.candidates.slice(0, 10)) {
    lines.push(`  ${formatCandidate(candidate)}`);
  }
  return lines.join("\n");
}

// ─── Raw-ID pre-check helpers (used by callers that want fast-paths) ─────
// Callers that want to avoid the full resolve round-trip on raw IDs can use
// these to check syntactic validity, but they should still call
// requireConfirmed* to verify the ID actually exists.

export function isRawChannelId(ref: string): boolean {
  return isSlackChannelId(ref);
}

export function isRawUserId(ref: string): boolean {
  return isSlackUserId(ref);
}
