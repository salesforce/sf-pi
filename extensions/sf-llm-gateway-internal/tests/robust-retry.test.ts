/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for streamAnthropicWithRobustRetry — the transparent retry wrapper
 * that swallows Anthropic mid-stream `event: error` envelopes and retries
 * the upstream call when the failure arrives before any user-visible
 * content has been emitted.
 *
 * Each test drives the wrapper with a queue of synthetic inner streams so
 * we can exercise retry budgets, backoff, user-visible cutoffs, and abort
 * behavior without touching the network.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
  createAssistantMessageEventStream,
} from "@mariozechner/pi-ai";
import { streamAnthropicWithRobustRetry } from "../lib/transport.ts";
import {
  clearRetryEventListener,
  setRetryEventListener,
  type RetryEvent,
} from "../lib/retry-telemetry.ts";

afterEach(() => {
  clearRetryEventListener();
});

const MODEL: Model<"anthropic-messages"> = {
  id: "claude-opus-4-7",
  provider: "sf-llm-gateway-internal-anthropic",
  api: "anthropic-messages",
  name: "Opus 4.7 (test)",
  baseUrl: "https://gateway.test/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 64_000,
};

type AssistantPartial = Extract<AssistantMessageEvent, { type: "start" }>["partial"];

/** Build an empty partial message for use in synthetic events. */
function partial(): AssistantPartial {
  return {
    role: "assistant",
    content: [],
    api: MODEL.api,
    provider: MODEL.provider,
    model: MODEL.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

function startEvent(): AssistantMessageEvent {
  return { type: "start", partial: partial() };
}

function thinkingStartEvent(): AssistantMessageEvent {
  return { type: "thinking_start", contentIndex: 0, partial: partial() };
}

function textDeltaEvent(delta: string): AssistantMessageEvent {
  return {
    type: "text_delta",
    contentIndex: 0,
    delta,
    partial: partial(),
  };
}

function doneEvent(): AssistantMessageEvent {
  const message = partial();
  return { type: "done", reason: "stop", message };
}

function errorEvent(errorMessage: string): AssistantMessageEvent {
  const errored: AssistantPartial = { ...partial(), stopReason: "error", errorMessage };
  return { type: "error", reason: "error", error: errored };
}

/** Push a batch of events onto a synthetic stream, then end it. */
function makeInnerStream(events: AssistantMessageEvent[]): AssistantMessageEventStream {
  const s = createAssistantMessageEventStream();
  // Use a microtask so consumers that call `for await` set up their iterator
  // before events arrive (matches the real Anthropic SDK stream timing).
  queueMicrotask(() => {
    for (const e of events) s.push(e);
    s.end();
  });
  return s;
}

/** Drain a stream into an array of events. */
async function drain(stream: AssistantMessageEventStream): Promise<AssistantMessageEvent[]> {
  const out: AssistantMessageEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

/** Build a createInner() factory that yields the next synthetic stream in a queue. */
function queueFactory(queue: AssistantMessageEvent[][]): {
  createInner: () => AssistantMessageEventStream;
  calls: () => number;
} {
  let callCount = 0;
  return {
    createInner: () => {
      const events = queue[callCount++];
      if (!events) {
        throw new Error(`No more synthetic inner streams queued (attempt #${callCount}).`);
      }
      return makeInnerStream(events);
    },
    calls: () => callCount,
  };
}

const ANTHROPIC_500_ENVELOPE = JSON.stringify({
  type: "error",
  error: { type: "api_error", message: "Internal server error" },
  request_id: "req_test_1",
});

describe("streamAnthropicWithRobustRetry", () => {
  it("passes a successful stream straight through (no retry needed)", async () => {
    const { createInner, calls } = queueFactory([
      [startEvent(), textDeltaEvent("hello"), doneEvent()],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, undefined, {
      sleep: async () => {},
    });
    const events = await drain(stream);

    expect(events.map((e) => e.type)).toEqual(["start", "text_delta", "done"]);
    expect(calls()).toBe(1);
  });

  it("retries a mid-stream api_error that arrives before any user-visible content", async () => {
    // First attempt: start → thinking_start → error (retryable).
    // Second attempt: success.
    const { createInner, calls } = queueFactory([
      [startEvent(), thinkingStartEvent(), errorEvent(ANTHROPIC_500_ENVELOPE)],
      [startEvent(), textDeltaEvent("recovered"), doneEvent()],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, undefined, {
      sleep: async () => {},
    });
    const events = await drain(stream);

    // The transient error is swallowed — downstream never sees it.
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(events.map((e) => e.type)).toEqual(["start", "text_delta", "done"]);
    expect(calls()).toBe(2);
  });

  it("retries multiple times within the budget (3 attempts total by default shape)", async () => {
    const { createInner, calls } = queueFactory([
      [startEvent(), errorEvent(ANTHROPIC_500_ENVELOPE)],
      [startEvent(), errorEvent(ANTHROPIC_500_ENVELOPE)],
      [startEvent(), textDeltaEvent("ok"), doneEvent()],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, undefined, {
      maxRetries: 3,
      retryDelaysMs: [0, 0, 0],
      sleep: async () => {},
    });
    const events = await drain(stream);

    expect(events.map((e) => e.type)).toEqual(["start", "text_delta", "done"]);
    expect(calls()).toBe(3);
  });

  it("does NOT retry once user-visible content has been emitted", async () => {
    // Downstream text has already been forwarded — we cannot transparently
    // retry without the TUI seeing a stuttered conversation. Forward the
    // sanitized error and stop.
    const { createInner, calls } = queueFactory([
      [startEvent(), textDeltaEvent("partial"), errorEvent(ANTHROPIC_500_ENVELOPE)],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, undefined, {
      sleep: async () => {},
    });
    const events = await drain(stream);

    // Error reached downstream, exactly once, and the retry was NOT taken.
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    expect(calls()).toBe(1);
  });

  it("sanitizes the final forwarded error (no raw JSON envelope leaks through)", async () => {
    const { createInner } = queueFactory([
      // Non-retryable error (400 invalid_request) so the very first attempt
      // forwards directly.
      [
        startEvent(),
        errorEvent(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "bad request" },
            request_id: "req_test_invalid",
          }),
        ),
      ],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, undefined, {
      sleep: async () => {},
    });
    const events = await drain(stream);

    const errorEvt = events.find(
      (e): e is Extract<AssistantMessageEvent, { type: "error" }> => e.type === "error",
    );
    expect(errorEvt).toBeDefined();
    const msg = errorEvt?.error.errorMessage ?? "";
    // Rendered as a human-readable summary, not a raw JSON envelope.
    expect(msg).toContain("invalid_request_error");
    expect(msg).toContain("req_test_invalid");
    expect(msg.trim().startsWith("{")).toBe(false);
  });

  it("does not retry a non-retryable error even when retry budget is available", async () => {
    const { createInner, calls } = queueFactory([
      [
        startEvent(),
        errorEvent(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "bad request" },
            request_id: "req_bad",
          }),
        ),
      ],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, undefined, {
      maxRetries: 3,
      retryDelaysMs: [0, 0, 0],
      sleep: async () => {},
    });
    const events = await drain(stream);

    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(calls()).toBe(1);
  });

  it("forwards the final sanitized error after exhausting the retry budget", async () => {
    const { createInner, calls } = queueFactory([
      [startEvent(), errorEvent(ANTHROPIC_500_ENVELOPE)],
      [startEvent(), errorEvent(ANTHROPIC_500_ENVELOPE)],
      [startEvent(), errorEvent(ANTHROPIC_500_ENVELOPE)],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, undefined, {
      maxRetries: 2, // 2 retries → 3 total attempts
      retryDelaysMs: [0, 0],
      sleep: async () => {},
    });
    const events = await drain(stream);

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    expect(calls()).toBe(3);
  });

  it("respects an abort signal by stopping retries immediately", async () => {
    const controller = new AbortController();
    const { createInner, calls } = queueFactory([
      [startEvent(), errorEvent(ANTHROPIC_500_ENVELOPE)],
      // Extra queued streams intentionally left unused; the abort must stop
      // us before we consume them.
      [startEvent(), textDeltaEvent("late"), doneEvent()],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, controller.signal, {
      maxRetries: 3,
      retryDelaysMs: [50, 50, 50],
      sleep: async (ms, signal) =>
        new Promise((resolve) => {
          const timer = setTimeout(resolve, ms);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        }),
    });

    // Abort before the first backoff completes.
    setTimeout(() => controller.abort(), 0);
    await drain(stream);

    expect(calls()).toBe(1);
  });

  it("does not leak buffered thinking events when a non-retryable error aborts the stream", async () => {
    // The wrapper buffers thinking_* events until the first user-visible
    // event. If the stream ends with a non-retryable error instead, the
    // buffered prelude must still be flushed so downstream sees a coherent
    // `start → thinking_start → error` sequence instead of a bare error.
    const { createInner } = queueFactory([
      [
        startEvent(),
        thinkingStartEvent(),
        errorEvent(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "nope" },
            request_id: "req_x",
          }),
        ),
      ],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, undefined, {
      sleep: async () => {},
    });
    const events = await drain(stream);

    expect(events.map((e) => e.type)).toEqual(["start", "thinking_start", "error"]);
  });

  it("passes thinking_* events through once any user-visible event has been emitted", async () => {
    // After the first text_delta, subsequent thinking blocks (for interleaved
    // thinking) must pass through without being re-buffered.
    const { createInner } = queueFactory([
      [
        startEvent(),
        thinkingStartEvent(),
        textDeltaEvent("answer"),
        thinkingStartEvent(), // a second thinking block after text
        doneEvent(),
      ],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, undefined, {
      sleep: async () => {},
    });
    const events = await drain(stream);

    expect(events.map((e) => e.type)).toEqual([
      "start",
      "thinking_start",
      "text_delta",
      "thinking_start",
      "done",
    ]);
  });

  // -----------------------------------------------------------------------
  // Retry telemetry integration (addresses issue #39 suggestion #2)
  //
  // The retry wrapper must surface what it did through the telemetry bus so
  // the UI can tell the user "upstream hiccuped, we retried, here's how it
  // ended". Before this, the robust retry was fully silent.
  // -----------------------------------------------------------------------

  it("emits retry_attempt + retry_recovered when a retry succeeds", async () => {
    const received: RetryEvent[] = [];
    setRetryEventListener((event) => received.push(event));

    const { createInner } = queueFactory([
      [startEvent(), thinkingStartEvent(), errorEvent(ANTHROPIC_500_ENVELOPE)],
      [startEvent(), textDeltaEvent("recovered"), doneEvent()],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, undefined, {
      sleep: async () => {},
    });
    await drain(stream);

    // Exactly one retry_attempt (for the second call), then retry_recovered.
    expect(received.map((e) => e.type)).toEqual(["retry_attempt", "retry_recovered"]);

    const attemptEvent = received[0];
    if (attemptEvent.type === "retry_attempt") {
      expect(attemptEvent.attempt).toBe(2);
      expect(attemptEvent.reason).toContain("api_error");
      expect(attemptEvent.modelId).toBe(MODEL.id);
    }
  });

  it("emits retry_exhausted when the budget is fully consumed", async () => {
    const received: RetryEvent[] = [];
    setRetryEventListener((event) => received.push(event));

    const { createInner } = queueFactory([
      [startEvent(), errorEvent(ANTHROPIC_500_ENVELOPE)],
      [startEvent(), errorEvent(ANTHROPIC_500_ENVELOPE)],
      [startEvent(), errorEvent(ANTHROPIC_500_ENVELOPE)],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, undefined, {
      maxRetries: 2,
      retryDelaysMs: [0, 0],
      sleep: async () => {},
    });
    await drain(stream);

    // Two retry_attempts (for the 2nd and 3rd calls), followed by a single
    // retry_exhausted. We deliberately do not emit retry_attempt for the
    // initial call since it is not a retry.
    expect(received.map((e) => e.type)).toEqual([
      "retry_attempt",
      "retry_attempt",
      "retry_exhausted",
    ]);
  });

  it("does not emit retry_exhausted for a first-attempt non-retryable error", async () => {
    const received: RetryEvent[] = [];
    setRetryEventListener((event) => received.push(event));

    const { createInner } = queueFactory([
      [
        startEvent(),
        errorEvent(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "bad" },
            request_id: "req_bad",
          }),
        ),
      ],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, undefined, {
      maxRetries: 3,
      retryDelaysMs: [0, 0, 0],
      sleep: async () => {},
    });
    await drain(stream);

    // No retry was ever attempted, so no telemetry should fire.
    expect(received).toHaveLength(0);
  });

  it("annotates forwarded errors with the retry-guidance footer (addresses issue #39 suggestion #3)", async () => {
    // Final error surfaced to the UI must include actionable next steps so
    // users don't have to look up the settings path or the status URL.
    const { createInner } = queueFactory([
      [
        startEvent(),
        errorEvent(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "bad" },
            request_id: "req_bad",
          }),
        ),
      ],
    ]);

    const stream = streamAnthropicWithRobustRetry(MODEL, createInner, undefined, {
      sleep: async () => {},
    });
    const events = await drain(stream);
    const errorEvt = events.find(
      (e): e is Extract<AssistantMessageEvent, { type: "error" }> => e.type === "error",
    );
    expect(errorEvt).toBeDefined();

    const msg = errorEvt?.error.errorMessage ?? "";
    // Sanitized human summary + guidance footer, without dumping raw JSON.
    expect(msg).toContain("invalid_request_error");
    expect(msg).toContain("~/.pi/agent/settings.json");
    expect(msg).toContain("status.anthropic.com");
  });
});
