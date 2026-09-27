/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for explicit, content-free Gateway model-stream probes. */
import { describe, expect, it, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
  GATEWAY_STREAM_CANARY_SCENARIOS,
  formatGatewayStreamProbeReport,
  parseGatewayDoctorStreamPlan,
  runGatewayStreamProbe,
  type GatewayStreamProbeRegistry,
} from "../lib/stream-probe.ts";

const PRIVATE_RESPONSE_TEXT = "private response content must never enter the report";

function model(id: string, api: Api): Model<Api> {
  return {
    id,
    provider: "sf-llm-gateway",
    api,
    name: id,
    baseUrl: "https://gateway.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  };
}

function assistant(
  selected: Model<Api>,
  stopReason: AssistantMessage["stopReason"],
  content: AssistantMessage["content"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: selected.api,
    provider: selected.provider,
    model: selected.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function plainStream(selected: Model<Api>): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const pending = assistant(selected, "pending", []);
  const done = assistant(selected, "stop", [{ type: "text", text: PRIVATE_RESPONSE_TEXT }]);
  queueMicrotask(() => {
    stream.push({ type: "start", partial: pending });
    stream.push({ type: "text_start", contentIndex: 0, partial: pending });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: PRIVATE_RESPONSE_TEXT,
      partial: done,
    });
    stream.push({
      type: "text_end",
      contentIndex: 0,
      content: PRIVATE_RESPONSE_TEXT,
      partial: done,
    });
    stream.push({ type: "done", reason: "stop", message: done });
    stream.end();
  });
  return stream;
}

function toolCallStream(selected: Model<Api>): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const toolCall = {
    type: "toolCall" as const,
    id: "probe-call",
    name: "gateway_probe",
    arguments: { value: "ok" },
  };
  const pending = assistant(selected, "pending", []);
  const done = assistant(selected, "toolUse", [toolCall]);
  queueMicrotask(() => {
    stream.push({ type: "start", partial: pending });
    stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
    stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: done });
    stream.push({ type: "done", reason: "toolUse", message: done });
    stream.end();
  });
  return stream;
}

function registryFor(
  selected: Model<Api>,
  streams: AssistantMessageEventStream[],
): GatewayStreamProbeRegistry & { calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn<GatewayStreamProbeRegistry["streamSimple"]>(() => {
    const next = streams.shift();
    if (!next) throw new Error("missing probe stream");
    return next;
  });
  return {
    find: vi.fn((_provider, id) => (id === selected.id ? selected : undefined)),
    streamSimple: calls,
    calls,
  };
}

describe("Gateway doctor stream-plan parsing", () => {
  it("keeps ordinary doctor connectivity-only", () => {
    expect(parseGatewayDoctorStreamPlan([], "medium")).toEqual({ mode: "none" });
  });

  it("parses one bounded model probe", () => {
    expect(
      parseGatewayDoctorStreamPlan(
        ["--stream", "gpt-6-sol", "--thinking", "xhigh", "--count", "2", "--tool"],
        "medium",
      ),
    ).toEqual({
      mode: "single",
      modelId: "gpt-6-sol",
      thinkingLevel: "xhigh",
      count: 2,
      exerciseToolRoundTrip: true,
    });
  });

  it("parses the explicit live canary matrix with a bounded repeat count", () => {
    expect(parseGatewayDoctorStreamPlan(["--stream-canaries", "--count", "3"], "medium")).toEqual({
      mode: "canaries",
      count: 3,
    });
  });

  it("rejects missing models, unknown flags, and excessive repeat counts", () => {
    expect(parseGatewayDoctorStreamPlan(["--stream"], "medium").mode).toBe("invalid");
    expect(
      parseGatewayDoctorStreamPlan(["--stream", "gpt-6-sol", "--count", "4"], "medium").mode,
    ).toBe("invalid");
    expect(parseGatewayDoctorStreamPlan(["--stream", "gpt-6-sol", "--raw"], "medium").mode).toBe(
      "invalid",
    );
  });
});

describe("Gateway model-stream probe", () => {
  it("proves a plain response reaches a terminal event and stream closure without retaining content", async () => {
    const selected = model("gpt-6-sol", "openai-responses");
    const registry = registryFor(selected, [plainStream(selected)]);

    const report = await runGatewayStreamProbe(registry, {
      modelId: selected.id,
      thinkingLevel: "xhigh",
      count: 1,
      exerciseToolRoundTrip: false,
      timeoutMs: 100,
    });

    expect(report.attempts).toMatchObject([
      {
        status: "ok",
        streamClosed: true,
        terminalEvent: "done",
        requestCount: 1,
        toolRoundTrip: false,
      },
    ]);
    expect(JSON.stringify(report)).not.toContain(PRIVATE_RESPONSE_TEXT);
    expect(formatGatewayStreamProbeReport(report)).not.toContain(PRIVATE_RESPONSE_TEXT);
  });

  it("proves an exact-model tool call and tool-result round trip", async () => {
    const selected = model("claude-opus-5-5", "anthropic-messages");
    const registry = registryFor(selected, [toolCallStream(selected), plainStream(selected)]);

    const report = await runGatewayStreamProbe(registry, {
      modelId: selected.id,
      thinkingLevel: "xhigh",
      count: 1,
      exerciseToolRoundTrip: true,
      timeoutMs: 100,
    });

    expect(report.attempts).toMatchObject([
      {
        status: "ok",
        streamClosed: true,
        terminalEvent: "done",
        requestCount: 2,
        toolRoundTrip: true,
      },
    ]);
    expect(registry.calls).toHaveBeenCalledTimes(2);
    const secondContext = registry.calls.mock.calls[1]?.[1] as TranscriptContext;
    expect(secondContext.messages.some((message) => message.role === "toolResult")).toBe(true);
    expect(JSON.stringify(report)).not.toContain(PRIVATE_RESPONSE_TEXT);
  });

  it("bounds visible content when no terminal closure arrives", async () => {
    const selected = model("gpt-6-sol", "openai-responses");
    const stream = createAssistantMessageEventStream();
    const pending = assistant(selected, "pending", []);
    const visible = assistant(selected, "pending", [{ type: "text", text: PRIVATE_RESPONSE_TEXT }]);
    queueMicrotask(() => {
      stream.push({ type: "start", partial: pending });
      stream.push({ type: "text_start", contentIndex: 0, partial: pending });
      stream.push({
        type: "text_end",
        contentIndex: 0,
        content: PRIVATE_RESPONSE_TEXT,
        partial: visible,
      });
      // Intentionally omit a terminal event and stream.end().
    });
    const registry = registryFor(selected, [stream]);

    const report = await runGatewayStreamProbe(registry, {
      modelId: selected.id,
      thinkingLevel: "high",
      count: 1,
      exerciseToolRoundTrip: false,
      timeoutMs: 20,
    });

    expect(report.attempts).toMatchObject([
      {
        status: "timeout",
        streamClosed: false,
      },
    ]);
    expect(report.attempts[0]?.terminalEvent).toBeUndefined();
  });

  it("reports cancellation without exposing provider content", async () => {
    const selected = model("claude-opus-5-5", "anthropic-messages");
    const registry = registryFor(selected, [plainStream(selected)]);
    const controller = new AbortController();
    controller.abort();

    const report = await runGatewayStreamProbe(
      registry,
      {
        modelId: selected.id,
        thinkingLevel: "high",
        count: 1,
        exerciseToolRoundTrip: false,
        timeoutMs: 100,
      },
      controller.signal,
    );

    expect(report.attempts).toMatchObject([{ status: "aborted", requestCount: 0 }]);
    expect(JSON.stringify(report)).not.toContain(PRIVATE_RESPONSE_TEXT);
  });
});

describe("exact live canary catalog", () => {
  it("covers Opus 5.5 and GPT-6 Sol at high/xhigh across plain and tool flows", () => {
    expect(GATEWAY_STREAM_CANARY_SCENARIOS).toEqual([
      {
        modelId: "claude-opus-5-5",
        thinkingLevel: "high",
        exerciseToolRoundTrip: false,
      },
      {
        modelId: "claude-opus-5-5",
        thinkingLevel: "xhigh",
        exerciseToolRoundTrip: true,
      },
      {
        modelId: "gpt-6-sol",
        thinkingLevel: "high",
        exerciseToolRoundTrip: false,
      },
      {
        modelId: "gpt-6-sol",
        thinkingLevel: "xhigh",
        exerciseToolRoundTrip: true,
      },
    ]);
  });
});
