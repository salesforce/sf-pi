/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the gateway's after_provider_response telemetry store.
 *
 * Covers:
 * - Header normalization (mixed case, non-string values)
 * - Retry-After parsing (seconds form + HTTP-date form)
 * - Integer header parsing with malformed values
 * - Reset-at resolution priority
 * - Signal lifecycle (record → get → TTL expiry → clear)
 * - Success responses clear warnings; warnings survive until healthy or TTL
 *
 * Source-level assertion that manifest.json includes after_provider_response
 * lives alongside other wiring tests so shutdown-reason.test.ts stays focused.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SIGNAL_TTL_MS,
  clearProviderSignal,
  formatProviderSignalBadge,
  getActiveProviderSignal,
  normalizeHeaders,
  parseInteger,
  parseRetryAfter,
  recordProviderResponse,
  resolveResetAt,
} from "../lib/provider-telemetry.ts";

// status.ts re-exports the badge formatter. We import directly from the
// telemetry module to keep the test surface focused on a single file.
import { formatProviderSignalBadge as statusBadge } from "../lib/status.ts";

beforeEach(() => {
  clearProviderSignal();
});

afterEach(() => {
  clearProviderSignal();
});

// -------------------------------------------------------------------------------------------------
// Header parsers
// -------------------------------------------------------------------------------------------------

describe("normalizeHeaders", () => {
  it("lowercases keys and drops non-string values", () => {
    const normalized = normalizeHeaders({
      "Retry-After": "12",
      "X-RateLimit-Remaining-Requests": "3",
      // @ts-expect-error — verifying defensive behavior against malformed input
      "bad-number": 7,
    });
    expect(normalized["retry-after"]).toBe("12");
    expect(normalized["x-ratelimit-remaining-requests"]).toBe("3");
    expect(normalized["bad-number"]).toBeUndefined();
  });

  it("returns an empty object when headers are undefined", () => {
    expect(normalizeHeaders(undefined)).toEqual({});
  });
});

describe("parseRetryAfter", () => {
  it("parses delay-seconds integer", () => {
    expect(parseRetryAfter("12")).toBe(12);
  });

  it("parses zero seconds", () => {
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("parses an HTTP-date into positive delta seconds", () => {
    const now = new Date("2026-04-22T12:00:00Z").getTime();
    const date = "Wed, 22 Apr 2026 12:00:30 GMT";
    expect(parseRetryAfter(date, now)).toBe(30);
  });

  it("clamps past dates to zero", () => {
    const now = new Date("2026-04-22T12:00:30Z").getTime();
    const date = "Wed, 22 Apr 2026 12:00:00 GMT";
    expect(parseRetryAfter(date, now)).toBe(0);
  });

  it("returns undefined for empty or unparseable input", () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("   ")).toBeUndefined();
    expect(parseRetryAfter("not-a-date")).toBeUndefined();
  });
});

describe("parseInteger", () => {
  it("parses clean non-negative integers", () => {
    expect(parseInteger("0")).toBe(0);
    expect(parseInteger("42")).toBe(42);
  });

  it("rejects malformed values", () => {
    expect(parseInteger(undefined)).toBeUndefined();
    expect(parseInteger("")).toBeUndefined();
    expect(parseInteger("abc")).toBeUndefined();
    expect(parseInteger("-1")).toBeUndefined();
    expect(parseInteger("1.5")).toBeUndefined();
  });
});

describe("resolveResetAt", () => {
  it("prefers x-ratelimit-reset-requests when parseable", () => {
    const headers = {
      "x-ratelimit-reset-requests": "2026-04-22T12:01:00Z",
      "retry-after": "999",
    };
    expect(resolveResetAt(headers)).toBe("2026-04-22T12:01:00.000Z");
  });

  it("falls back to retry-after seconds when other resets are absent", () => {
    const now = new Date("2026-04-22T12:00:00Z").getTime();
    const headers = { "retry-after": "45" };
    expect(resolveResetAt(headers, now)).toBe("2026-04-22T12:00:45.000Z");
  });

  it("returns undefined when no reset signal is present", () => {
    expect(resolveResetAt({})).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// Signal store lifecycle
// -------------------------------------------------------------------------------------------------

describe("recordProviderResponse", () => {
  it("records a throttle signal with retry + rate-limit context", () => {
    const now = new Date("2026-04-22T12:00:00Z").getTime();
    const signal = recordProviderResponse(
      429,
      {
        "Retry-After": "12",
        "X-RateLimit-Remaining-Requests": "3",
        "X-RateLimit-Remaining-Tokens": "1500",
      },
      "claude-opus-4-7",
      now,
    );
    expect(signal).toBeTruthy();
    expect(signal!.kind).toBe("throttled");
    expect(signal!.status).toBe(429);
    expect(signal!.retryAfterSec).toBe(12);
    expect(signal!.remainingRequests).toBe(3);
    expect(signal!.remainingTokens).toBe(1500);
    expect(signal!.resetAt).toBe("2026-04-22T12:00:12.000Z");
    expect(signal!.modelId).toBe("claude-opus-4-7");
  });

  it("classifies 5xx as upstream even without retry-after", () => {
    const signal = recordProviderResponse(503, { "content-type": "application/json" }, undefined);
    expect(signal!.kind).toBe("upstream");
    expect(signal!.status).toBe(503);
    expect(signal!.retryAfterSec).toBeUndefined();
  });

  it("clears any previous warning on healthy response", () => {
    recordProviderResponse(429, { "retry-after": "30" }, "claude-opus-4-7");
    expect(getActiveProviderSignal()).toBeTruthy();

    const result = recordProviderResponse(200, {}, "claude-opus-4-7");
    expect(result).toBeNull();
    expect(getActiveProviderSignal()).toBeNull();
  });

  it("expires stored signals after the TTL elapses", () => {
    const start = new Date("2026-04-22T12:00:00Z").getTime();
    recordProviderResponse(429, { "retry-after": "30" }, "claude-opus-4-7", start);
    expect(getActiveProviderSignal(start + 1_000)).toBeTruthy();
    expect(getActiveProviderSignal(start + SIGNAL_TTL_MS + 1)).toBeNull();
  });

  it("ignores non-finite status values", () => {
    const result = recordProviderResponse(Number.NaN, {}, "claude-opus-4-7");
    expect(result).toBeNull();
  });
});

describe("formatProviderSignalBadge", () => {
  it("returns empty string for no signal", () => {
    expect(formatProviderSignalBadge(null)).toBe("");
  });

  it("formats throttled signals with retry", () => {
    expect(
      formatProviderSignalBadge({
        kind: "throttled",
        status: 429,
        retryAfterSec: 12,
        at: Date.now(),
      }),
    ).toBe("⚠ 429 · retry 12s");
  });

  it("formats throttled signals without retry", () => {
    expect(
      formatProviderSignalBadge({
        kind: "throttled",
        status: 429,
        at: Date.now(),
      }),
    ).toBe("⚠ 429");
  });

  it("formats upstream signals", () => {
    expect(
      formatProviderSignalBadge({
        kind: "upstream",
        status: 503,
        at: Date.now(),
      }),
    ).toBe("⚠ upstream 503");
  });

  it("is re-exported from lib/status.ts for convenience", () => {
    // Status module consumers should use the exported helper rather than
    // importing the telemetry file directly. The re-export check catches
    // accidental deletions in future status.ts refactors.
    expect(statusBadge).toBe(formatProviderSignalBadge);
  });
});
