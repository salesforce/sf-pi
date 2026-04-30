/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Provider telemetry for the SF LLM Gateway.
 *
 * Captures the HTTP status + headers emitted by Pi's `after_provider_response`
 * event for gateway requests and exposes a short-lived signal that the footer
 * status builder can render as a throttle / upstream warning badge.
 *
 * Rules:
 * - Pure functions + a single in-memory slot; no I/O.
 * - Healthy (2xx) responses clear any active warning immediately.
 * - Warnings (>=429) expire after `SIGNAL_TTL_MS` so stale badges don't linger.
 * - Header availability is best-effort per Pi docs; all parsers are null-safe
 *   and degrade gracefully when a header is missing.
 */

export const SIGNAL_TTL_MS = 60_000;

export type ProviderSignalKind = "healthy" | "throttled" | "upstream";

/** Snapshot of the last provider response relevant to the gateway footer. */
export interface ProviderSignal {
  kind: ProviderSignalKind;
  status: number;
  /** Parsed `retry-after` value in seconds, when present. */
  retryAfterSec?: number;
  /** Remaining requests in the active rate-limit window. */
  remainingRequests?: number;
  /** Remaining tokens in the active rate-limit window. */
  remainingTokens?: number;
  /** ISO timestamp when the rate-limit window resets, when derivable. */
  resetAt?: string;
  /** Recorded model id, when the event provided it. */
  modelId?: string;
  /** Wall-clock timestamp when the signal was recorded. */
  at: number;
}

let currentSignal: ProviderSignal | null = null;

/**
 * Record a provider response. Returns the resulting signal, or `null` when the
 * response is 2xx/3xx and no warning is needed.
 *
 * - 2xx/3xx clears any previous warning (healthy signal is not stored — the
 *   footer only cares about warnings).
 * - 4xx/5xx is stored as a warning signal whose badge the footer renders
 *   until `SIGNAL_TTL_MS` has elapsed or a healthy response arrives.
 */
export function recordProviderResponse(
  status: number,
  headers: Record<string, string> | undefined,
  modelId: string | undefined,
  now: number = Date.now(),
): ProviderSignal | null {
  if (!Number.isFinite(status)) {
    return currentSignal;
  }

  // Healthy response — clear any warning and report nothing.
  if (status >= 200 && status < 400) {
    currentSignal = null;
    return null;
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const kind: ProviderSignalKind = status === 429 ? "throttled" : "upstream";
  const retryAfterSec = parseRetryAfter(normalizedHeaders["retry-after"], now);
  const remainingRequests = parseInteger(normalizedHeaders["x-ratelimit-remaining-requests"]);
  const remainingTokens = parseInteger(normalizedHeaders["x-ratelimit-remaining-tokens"]);
  const resetAt = resolveResetAt(normalizedHeaders, now);

  currentSignal = {
    kind,
    status,
    retryAfterSec,
    remainingRequests,
    remainingTokens,
    resetAt,
    modelId,
    at: now,
  };
  return currentSignal;
}

/**
 * Return the active provider signal, or `null` when no warning is live or the
 * stored warning is older than `SIGNAL_TTL_MS`.
 */
export function getActiveProviderSignal(now: number = Date.now()): ProviderSignal | null {
  if (!currentSignal) {
    return null;
  }
  if (now - currentSignal.at > SIGNAL_TTL_MS) {
    currentSignal = null;
    return null;
  }
  return currentSignal;
}

/** Drop the stored signal (used on session shutdown). */
export function clearProviderSignal(): void {
  currentSignal = null;
}

/**
 * Render a compact one-line badge for a live provider warning signal.
 *
 * Kept intentionally short so it fits next to the monthly usage pill on the
 * devbar bottom-bar without displacing other segments. Returns an empty
 * string when no warning is live.
 */
export function formatProviderSignalBadge(signal: ProviderSignal | null): string {
  if (!signal) return "";

  if (signal.kind === "throttled") {
    const retryPart =
      typeof signal.retryAfterSec === "number" ? ` · retry ${signal.retryAfterSec}s` : "";
    return `⚠ ${signal.status}${retryPart}`;
  }

  if (signal.kind === "upstream") {
    return `⚠ upstream ${signal.status}`;
  }

  return "";
}

// -------------------------------------------------------------------------------------------------
// Header parsing helpers (pure, exported for tests)
// -------------------------------------------------------------------------------------------------

/**
 * Lowercase header keys. Pi promises a `Record<string, string>` but provider
 * transports differ, so we defensively re-normalize rather than trust case.
 */
export function normalizeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key !== "string" || typeof value !== "string") continue;
    result[key.toLowerCase()] = value;
  }
  return result;
}

/**
 * Parse an HTTP `retry-after` header value into seconds.
 *
 * Accepts either a delay-seconds integer or an HTTP-date string. Returns
 * `undefined` when the header is missing or unparseable.
 */
export function parseRetryAfter(
  value: string | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // Form 1: "12" (delay-seconds)
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
  }

  // Form 2: HTTP-date
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  const delta = Math.round((parsed - now) / 1000);
  return delta >= 0 ? delta : 0;
}

/**
 * Best-effort parser for an integer header. Returns `undefined` when the
 * value is absent or not a finite, non-negative integer.
 */
export function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return undefined;
  return n;
}

/**
 * Resolve the rate-limit reset time from common header shapes.
 *
 * Priority:
 *   1. `x-ratelimit-reset-requests` or `x-ratelimit-reset-tokens` — already ISO/HTTP-date
 *   2. `retry-after` — add seconds to `now`
 */
export function resolveResetAt(
  headers: Record<string, string>,
  now: number = Date.now(),
): string | undefined {
  const candidate =
    headers["x-ratelimit-reset-requests"] ??
    headers["x-ratelimit-reset-tokens"] ??
    headers["x-ratelimit-reset"];
  if (candidate) {
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  const retryAfterSec = parseRetryAfter(headers["retry-after"], now);
  if (retryAfterSec !== undefined) {
    return new Date(now + retryAfterSec * 1000).toISOString();
  }
  return undefined;
}
