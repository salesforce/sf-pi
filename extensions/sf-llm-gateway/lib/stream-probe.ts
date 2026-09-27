/* SPDX-License-Identifier: Apache-2.0 */
/** Explicit, bounded, content-free model-stream health probes for Gateway doctor. */
import {
  normalizeContext,
  uuidv7,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type ThinkingLevel,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { PROVIDER_NAME } from "./config.ts";

const DEFAULT_STREAM_PROBE_TIMEOUT_MS = 15_000;
const MAX_STREAM_PROBE_COUNT = 3;
const STREAM_PROBE_SYSTEM_PROMPT =
  "This is a bounded transport health check. Follow the user instruction exactly and keep the response minimal.";
const PLAIN_PROBE_PROMPT = "Reply with exactly OK.";
const TOOL_PROBE_PROMPT =
  "Call gateway_probe exactly once with value ok. Do not answer until the tool result is provided.";
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

export type GatewayProbeThinkingLevel = "off" | ThinkingLevel;

const THINKING_LEVELS = new Set<GatewayProbeThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const PROBE_TOOL = {
  name: "gateway_probe",
  description: "Return a fixed health-check acknowledgement.",
  parameters: Type.Object(
    {
      value: Type.String({ description: "Use the exact value ok." }),
    },
    { additionalProperties: false },
  ),
};

export interface GatewayStreamProbeRegistry {
  find(provider: string, modelId: string): Model<Api> | undefined;
  streamSimple(
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
}

export interface GatewayStreamProbeOptions {
  modelId: string;
  thinkingLevel: GatewayProbeThinkingLevel;
  count: number;
  exerciseToolRoundTrip: boolean;
  timeoutMs?: number;
}

export type GatewayStreamProbeAttemptStatus =
  "ok" | "unavailable" | "timeout" | "aborted" | "provider-error" | "protocol-error";

export interface GatewayStreamProbeAttempt {
  attempt: number;
  status: GatewayStreamProbeAttemptStatus;
  durationMs: number;
  timeToFirstContentMs?: number;
  terminalToCloseMs?: number;
  streamClosed: boolean;
  terminalEvent?: "done" | "error";
  requestCount: number;
  toolRoundTrip: boolean;
}

export interface GatewayStreamProbeReport {
  modelId: string;
  thinkingLevel: GatewayProbeThinkingLevel;
  count: number;
  exerciseToolRoundTrip: boolean;
  timeoutMs: number;
  attempts: GatewayStreamProbeAttempt[];
}

export interface GatewayStreamCanaryScenario {
  modelId: string;
  thinkingLevel: GatewayProbeThinkingLevel;
  exerciseToolRoundTrip: boolean;
}

export const GATEWAY_STREAM_CANARY_SCENARIOS: readonly GatewayStreamCanaryScenario[] = [
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
] as const;

export type GatewayDoctorStreamPlan =
  | { mode: "none" }
  | {
      mode: "single";
      modelId: string;
      thinkingLevel: GatewayProbeThinkingLevel;
      count: number;
      exerciseToolRoundTrip: boolean;
    }
  | { mode: "canaries"; count: number }
  | { mode: "invalid"; error: string };

export function parseGatewayDoctorStreamPlan(
  args: string[],
  currentThinkingLevel: GatewayProbeThinkingLevel,
): GatewayDoctorStreamPlan {
  if (args.length === 0) return { mode: "none" };

  const canaries = args[0] === "--stream-canaries";
  const single = args[0] === "--stream";
  if (!canaries && !single) {
    return { mode: "invalid", error: "Unknown doctor option." };
  }

  let index = 1;
  let modelId: string | undefined;
  if (single) {
    modelId = args[index++];
    if (!modelId || !MODEL_ID_PATTERN.test(modelId)) {
      return { mode: "invalid", error: "doctor --stream requires a valid model ID." };
    }
  }

  let count = canaries ? MAX_STREAM_PROBE_COUNT : 1;
  let thinkingLevel = currentThinkingLevel;
  let exerciseToolRoundTrip = false;

  while (index < args.length) {
    const token = args[index++];
    if (token === "--count") {
      const raw = args[index++];
      const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_STREAM_PROBE_COUNT) {
        return {
          mode: "invalid",
          error: `--count must be between 1 and ${MAX_STREAM_PROBE_COUNT}.`,
        };
      }
      count = parsed;
      continue;
    }
    if (token === "--thinking" && single) {
      const requested = args[index++] as GatewayProbeThinkingLevel | undefined;
      if (!requested || !THINKING_LEVELS.has(requested)) {
        return { mode: "invalid", error: "--thinking requires a supported Pi thinking level." };
      }
      thinkingLevel = requested;
      continue;
    }
    if (token === "--tool" && single) {
      exerciseToolRoundTrip = true;
      continue;
    }
    return { mode: "invalid", error: `Unknown doctor stream option: ${token ?? "missing"}.` };
  }

  if (canaries) return { mode: "canaries", count };
  if (!modelId) return { mode: "invalid", error: "doctor --stream requires a model ID." };
  return {
    mode: "single",
    modelId,
    thinkingLevel,
    count,
    exerciseToolRoundTrip,
  };
}

interface StreamLegObservation {
  status: "done" | "error" | "timeout" | "aborted" | "protocol-error";
  durationMs: number;
  timeToFirstContentMs?: number;
  terminalToCloseMs?: number;
  streamClosed: boolean;
  terminalEvent?: "done" | "error";
  message?: AssistantMessage;
  toolCall?: { id: string; name: string };
}

export async function runGatewayStreamProbe(
  registry: GatewayStreamProbeRegistry,
  options: GatewayStreamProbeOptions,
  parentSignal?: AbortSignal,
): Promise<GatewayStreamProbeReport> {
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const count = boundedCount(options.count);
  const model = registry.find(PROVIDER_NAME, options.modelId);
  const attempts: GatewayStreamProbeAttempt[] = [];

  for (let attempt = 1; attempt <= count; attempt += 1) {
    if (parentSignal?.aborted) {
      attempts.push(abortedAttempt(attempt));
      continue;
    }
    if (!model || model.provider !== PROVIDER_NAME) {
      attempts.push({
        attempt,
        status: "unavailable",
        durationMs: 0,
        streamClosed: false,
        requestCount: 0,
        toolRoundTrip: false,
      });
      continue;
    }

    attempts.push(
      options.exerciseToolRoundTrip
        ? await runToolRoundTrip(
            registry,
            model,
            options.thinkingLevel,
            attempt,
            timeoutMs,
            parentSignal,
          )
        : await runPlainProbe(
            registry,
            model,
            options.thinkingLevel,
            attempt,
            timeoutMs,
            parentSignal,
          ),
    );
  }

  return {
    modelId: options.modelId,
    thinkingLevel: options.thinkingLevel,
    count,
    exerciseToolRoundTrip: options.exerciseToolRoundTrip,
    timeoutMs,
    attempts,
  };
}

export async function runGatewayStreamCanaries(
  registry: GatewayStreamProbeRegistry,
  count: number,
  parentSignal?: AbortSignal,
): Promise<GatewayStreamProbeReport[]> {
  const reports: GatewayStreamProbeReport[] = [];
  for (const scenario of GATEWAY_STREAM_CANARY_SCENARIOS) {
    reports.push(
      await runGatewayStreamProbe(
        registry,
        {
          ...scenario,
          count,
          timeoutMs: DEFAULT_STREAM_PROBE_TIMEOUT_MS,
        },
        parentSignal,
      ),
    );
    if (parentSignal?.aborted) break;
  }
  return reports;
}

async function runPlainProbe(
  registry: GatewayStreamProbeRegistry,
  model: Model<Api>,
  thinkingLevel: GatewayProbeThinkingLevel,
  attempt: number,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<GatewayStreamProbeAttempt> {
  const observation = await runStreamLeg(
    registry,
    model,
    plainContext(),
    thinkingLevel,
    timeoutMs,
    parentSignal,
  );
  return attemptFromObservation(attempt, observation, 1, false, observation.status === "done");
}

async function runToolRoundTrip(
  registry: GatewayStreamProbeRegistry,
  model: Model<Api>,
  thinkingLevel: GatewayProbeThinkingLevel,
  attempt: number,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<GatewayStreamProbeAttempt> {
  const startedAt = performance.now();
  const first = await runStreamLeg(
    registry,
    model,
    toolContext(),
    thinkingLevel,
    timeoutMs,
    parentSignal,
  );
  if (
    first.status !== "done" ||
    first.message?.stopReason !== "toolUse" ||
    first.toolCall?.name !== PROBE_TOOL.name
  ) {
    return attemptFromObservation(attempt, first, 1, false, false, startedAt);
  }

  const second = await runStreamLeg(
    registry,
    model,
    toolResultContext(first.message, first.toolCall),
    thinkingLevel,
    timeoutMs,
    parentSignal,
  );
  const succeeded = second.status === "done" && second.message?.stopReason === "stop";
  return attemptFromObservation(attempt, second, 2, succeeded, succeeded, startedAt);
}

function plainContext(): TranscriptContext {
  return normalizeContext({
    systemPrompt: STREAM_PROBE_SYSTEM_PROMPT,
    messages: [userMessage(PLAIN_PROBE_PROMPT)],
    tools: [],
  });
}

function toolContext(): TranscriptContext {
  return normalizeContext({
    systemPrompt: STREAM_PROBE_SYSTEM_PROMPT,
    messages: [userMessage(TOOL_PROBE_PROMPT)],
    tools: [PROBE_TOOL],
  });
}

function toolResultContext(
  assistantMessage: AssistantMessage,
  toolCall: { id: string; name: string },
): TranscriptContext {
  return normalizeContext({
    systemPrompt: STREAM_PROBE_SYSTEM_PROMPT,
    messages: [
      userMessage(TOOL_PROBE_PROMPT),
      assistantMessage,
      {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: "ok" }],
        isError: false,
        timestamp: Date.now(),
      },
    ],
    tools: [PROBE_TOOL],
  });
}

function userMessage(text: string) {
  return {
    role: "user" as const,
    content: [{ type: "text" as const, text }],
    timestamp: Date.now(),
  };
}

async function runStreamLeg(
  registry: GatewayStreamProbeRegistry,
  model: Model<Api>,
  context: TranscriptContext,
  thinkingLevel: GatewayProbeThinkingLevel,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<StreamLegObservation> {
  if (parentSignal?.aborted) return emptyObservation("aborted");

  const controller = new AbortController();
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, controller.signal])
    : controller.signal;
  const startedAt = performance.now();
  let firstContentAt: number | undefined;
  let terminalAt: number | undefined;
  let terminalEvent: "done" | "error" | undefined;
  let message: AssistantMessage | undefined;
  let toolCall: { id: string; name: string } | undefined;
  let streamClosed = false;

  let stream: AssistantMessageEventStream;
  try {
    stream = registry.streamSimple(model, context, {
      ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel }),
      maxTokens: 64,
      cacheRetention: "none",
      sessionId: uuidv7(),
      signal,
    });
  } catch {
    return emptyObservation("error", performance.now() - startedAt);
  }

  const drain = (async (): Promise<"closed" | "error"> => {
    try {
      for await (const event of stream) {
        if (firstContentAt === undefined && isContentEvent(event)) {
          firstContentAt = performance.now();
        }
        if (event.type === "toolcall_end") {
          toolCall = { id: event.toolCall.id, name: event.toolCall.name };
        } else if (event.type === "done") {
          terminalAt = performance.now();
          terminalEvent = "done";
          message = event.message;
        } else if (event.type === "error") {
          terminalAt = performance.now();
          terminalEvent = "error";
          message = event.error;
        }
      }
      streamClosed = true;
      return "closed";
    } catch {
      return "error";
    }
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const outcome = await Promise.race([drain, timedOut]);
  if (timer) clearTimeout(timer);

  if (outcome === "timeout") {
    controller.abort();
    void drain.catch(() => undefined);
    return {
      status: parentSignal?.aborted ? "aborted" : "timeout",
      durationMs: roundedDuration(startedAt),
      timeToFirstContentMs: elapsed(startedAt, firstContentAt),
      streamClosed,
      terminalEvent,
      message,
      toolCall,
    };
  }

  const closedAt = performance.now();
  if (parentSignal?.aborted) {
    return {
      status: "aborted",
      durationMs: roundedDuration(startedAt, closedAt),
      timeToFirstContentMs: elapsed(startedAt, firstContentAt),
      terminalToCloseMs: elapsed(terminalAt, closedAt),
      streamClosed,
      terminalEvent,
      message,
      toolCall,
    };
  }
  if (outcome === "error" || terminalEvent === "error") {
    return {
      status: "error",
      durationMs: roundedDuration(startedAt, closedAt),
      timeToFirstContentMs: elapsed(startedAt, firstContentAt),
      terminalToCloseMs: elapsed(terminalAt, closedAt),
      streamClosed,
      terminalEvent,
      message,
      toolCall,
    };
  }
  return {
    status: terminalEvent === "done" ? "done" : "protocol-error",
    durationMs: roundedDuration(startedAt, closedAt),
    timeToFirstContentMs: elapsed(startedAt, firstContentAt),
    terminalToCloseMs: elapsed(terminalAt, closedAt),
    streamClosed,
    terminalEvent,
    message,
    toolCall,
  };
}

function attemptFromObservation(
  attempt: number,
  observation: StreamLegObservation,
  requestCount: number,
  toolRoundTrip: boolean,
  succeeded: boolean,
  overallStartedAt?: number,
): GatewayStreamProbeAttempt {
  return {
    attempt,
    status: succeeded ? "ok" : publicAttemptStatus(observation.status),
    durationMs:
      overallStartedAt === undefined ? observation.durationMs : roundedDuration(overallStartedAt),
    timeToFirstContentMs: observation.timeToFirstContentMs,
    terminalToCloseMs: observation.terminalToCloseMs,
    streamClosed: observation.streamClosed,
    terminalEvent: observation.terminalEvent,
    requestCount,
    toolRoundTrip,
  };
}

function publicAttemptStatus(
  status: StreamLegObservation["status"],
): GatewayStreamProbeAttemptStatus {
  switch (status) {
    case "timeout":
      return "timeout";
    case "aborted":
      return "aborted";
    case "protocol-error":
      return "protocol-error";
    case "done":
      return "protocol-error";
    case "error":
    default:
      return "provider-error";
  }
}

function emptyObservation(status: "aborted" | "error", durationMs = 0): StreamLegObservation {
  return {
    status,
    durationMs: Math.round(durationMs),
    streamClosed: false,
  };
}

function abortedAttempt(attempt: number): GatewayStreamProbeAttempt {
  return {
    attempt,
    status: "aborted",
    durationMs: 0,
    streamClosed: false,
    requestCount: 0,
    toolRoundTrip: false,
  };
}

function isContentEvent(event: AssistantMessageEvent): boolean {
  return (
    event.type === "text_start" ||
    event.type === "text_delta" ||
    event.type === "text_end" ||
    event.type === "thinking_start" ||
    event.type === "thinking_delta" ||
    event.type === "thinking_end" ||
    event.type === "toolcall_start" ||
    event.type === "toolcall_delta" ||
    event.type === "toolcall_end"
  );
}

function boundedCount(value: number): number {
  return Number.isInteger(value) ? Math.max(1, Math.min(MAX_STREAM_PROBE_COUNT, value)) : 1;
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_STREAM_PROBE_TIMEOUT_MS;
  return Math.max(10, Math.min(DEFAULT_STREAM_PROBE_TIMEOUT_MS, Math.round(value)));
}

function roundedDuration(startedAt: number, finishedAt = performance.now()): number {
  return Math.max(0, Math.round(finishedAt - startedAt));
}

function elapsed(
  startedAt: number | undefined,
  finishedAt: number | undefined,
): number | undefined {
  if (startedAt === undefined || finishedAt === undefined) return undefined;
  return Math.max(0, Math.round(finishedAt - startedAt));
}

export function formatGatewayStreamProbeReport(report: GatewayStreamProbeReport): string {
  const flow = report.exerciseToolRoundTrip ? "tool round trip" : "plain response";
  const lines = [
    `Model stream: ${report.modelId} · thinking ${report.thinkingLevel} · ${flow}`,
    `Bound: ${report.count} attempt(s), ${report.timeoutMs} ms per request`,
  ];
  for (const attempt of report.attempts) {
    const first =
      attempt.timeToFirstContentMs === undefined
        ? "first content unavailable"
        : `first content ${attempt.timeToFirstContentMs} ms`;
    const close =
      attempt.terminalToCloseMs === undefined
        ? "terminal→close unavailable"
        : `terminal→close ${attempt.terminalToCloseMs} ms`;
    lines.push(
      `- attempt ${attempt.attempt}: ${attempt.status.toUpperCase()} · ${attempt.durationMs} ms · ${first} · ${close} · ${attempt.requestCount} request(s)`,
    );
  }
  const passed = report.attempts.filter((attempt) => attempt.status === "ok").length;
  lines.push(`Result: ${passed}/${report.attempts.length} passed.`);
  lines.push(
    "Privacy: response content, credentials, URLs, and session IDs are not recorded or persisted.",
  );
  return lines.join("\n");
}

export function formatGatewayStreamCanaryReports(reports: GatewayStreamProbeReport[]): string {
  return [
    "Gateway exact-model stream canaries",
    "",
    ...reports.flatMap((report, index) => [
      ...(index > 0 ? [""] : []),
      formatGatewayStreamProbeReport(report),
    ]),
  ].join("\n");
}
