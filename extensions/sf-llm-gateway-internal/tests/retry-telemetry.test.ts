/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for lib/retry-telemetry — the small event bus the robust retry uses
 * to surface inner-retry state to the UI, and the guidance footer appended
 * to final error messages.
 *
 * These tests cover:
 *   - Listener install / emit / clear lifecycle
 *   - Notification string formatting for each event type
 *   - Broken listeners must NOT take down the stream
 *   - Guidance footer includes the settings path and Anthropic status URL
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  clearRetryEventListener,
  emitRetryEvent,
  formatRetryEventNotification,
  formatRetryGuidanceFooter,
  setRetryEventListener,
  type RetryEvent,
} from "../lib/retry-telemetry.ts";

afterEach(() => {
  clearRetryEventListener();
});

describe("retry-telemetry listener lifecycle", () => {
  it("delivers emitted events to the installed listener", () => {
    const received: RetryEvent[] = [];
    setRetryEventListener((event) => received.push(event));

    emitRetryEvent({
      type: "retry_attempt",
      attempt: 2,
      maxAttempts: 4,
      delayMs: 1500,
      reason: "Anthropic api_error: Internal server error (request_id: req_abc)",
      modelId: "claude-opus-4-7",
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("retry_attempt");
  });

  it("stops delivering events after clearRetryEventListener", () => {
    const received: RetryEvent[] = [];
    setRetryEventListener((event) => received.push(event));
    clearRetryEventListener();

    emitRetryEvent({
      type: "retry_exhausted",
      attempts: 3,
      reason: "upstream",
    });

    expect(received).toHaveLength(0);
  });

  it("only the most recently installed listener receives events", () => {
    const a: RetryEvent[] = [];
    const b: RetryEvent[] = [];
    setRetryEventListener((e) => a.push(e));
    setRetryEventListener((e) => b.push(e));

    emitRetryEvent({ type: "retry_recovered", attempts: 2 });

    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });

  it("swallows listener errors so a broken UI callback does not crash the stream", () => {
    setRetryEventListener(() => {
      throw new Error("boom");
    });

    // Must not throw.
    expect(() => emitRetryEvent({ type: "retry_recovered", attempts: 2 })).not.toThrow();
  });

  it("is a no-op when no listener is installed (tests / headless)", () => {
    expect(() => emitRetryEvent({ type: "retry_recovered", attempts: 2 })).not.toThrow();
  });
});

describe("formatRetryEventNotification", () => {
  it("renders retry_attempt with attempt counter and delay in seconds", () => {
    const msg = formatRetryEventNotification({
      type: "retry_attempt",
      attempt: 2,
      maxAttempts: 4, // total = 4, of which 3 are retries (maxAttempts - 1)
      delayMs: 1500,
      reason: "Anthropic api_error: Internal server error (request_id: req_1)",
    });

    expect(msg).toContain("retrying (2/3)");
    expect(msg).toContain("in 1.5s");
    // Original sanitized reason is included so users can correlate request IDs.
    expect(msg).toContain("request_id: req_1");
  });

  it("renders retry_exhausted with attempt count and guidance footer", () => {
    const msg = formatRetryEventNotification({
      type: "retry_exhausted",
      attempts: 4,
      reason: "Anthropic api_error: Internal server error",
    });

    expect(msg).toContain("after 4 attempts");
    // Guidance footer inlined.
    expect(msg).toContain("~/.pi/agent/settings.json");
    expect(msg).toContain("status.anthropic.com");
  });

  it("pluralizes 'attempt' correctly in retry_exhausted", () => {
    const single = formatRetryEventNotification({
      type: "retry_exhausted",
      attempts: 1,
      reason: "x",
    });
    expect(single).toContain("after 1 attempt.");
  });

  it("renders retry_recovered with no footer (success case, no action needed)", () => {
    const msg = formatRetryEventNotification({
      type: "retry_recovered",
      attempts: 2,
    });

    expect(msg).toContain("recovered after 2 attempts");
    expect(msg).not.toContain("status.anthropic.com");
  });
});

describe("formatRetryGuidanceFooter", () => {
  it("includes the settings path and the Anthropic status URL verbatim", () => {
    const footer = formatRetryGuidanceFooter();
    expect(footer).toContain("retry.maxRetries");
    expect(footer).toContain("~/.pi/agent/settings.json");
    expect(footer).toContain("/compact");
    expect(footer).toContain("https://status.anthropic.com");
  });

  it("is a single line so it fits in a transcript row", () => {
    const footer = formatRetryGuidanceFooter();
    expect(footer.split("\n")).toHaveLength(1);
  });
});
