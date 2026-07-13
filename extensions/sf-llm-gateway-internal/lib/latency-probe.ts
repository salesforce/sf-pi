/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read-only gateway latency probes for `/sf-llm-gateway latency-probe`.
 *
 * The goal is to separate gateway/provider latency from pi's provider
 * transport. These probes intentionally call the gateway REST endpoints
 * directly with tiny max-output settings and report only timings + usage
 * counters — no prompt or credentials are rendered.
 */
import { API_KEY_ENV, getGatewayConfig } from "./config.ts";
import { toGatewayOpenAiBaseUrl, toGatewayRootBaseUrl } from "./gateway-url.ts";
import { fetchWithTimeout } from "./models.ts";
import { isAnthropicModelId } from "./models.ts";
import { isGpt5FamilyResponsesModelId, isOpus47OrNewerModelId } from "./transport.ts";

const METADATA_TIMEOUT_MS = 15_000;
const GENERATION_TIMEOUT_MS = 180_000;
const SMALL_FILLER_WORDS = 0;
const LARGE_FILLER_WORDS = 90_000;

// Exported for unit tests. Some GPT-5-family Responses routes reject
// max_output_tokens=1 before a latency measurement can be taken, so the
// "tiny" Responses probe uses the smallest verified accepted value.
export const RESPONSES_LATENCY_PROBE_MAX_OUTPUT_TOKENS = 16;

export interface GatewayLatencyProbeOptions {
  modelId: string;
  includeLarge: boolean;
  includeBedrock: boolean;
}

export interface GatewayLatencyProbeReport {
  ok: boolean;
  modelId: string;
  generatedAt: string;
  notes: string[];
  probes: GatewayLatencyProbeEntry[];
  error?: string;
}

export interface GatewayLatencyProbeEntry {
  label: string;
  ok: boolean;
  status?: number;
  durationMs?: number;
  headersMs?: number;
  firstChunkMs?: number;
  firstEventMs?: number;
  firstTextMs?: number;
  eventCount?: number;
  textChars?: number;
  usage?: Record<string, unknown>;
  error?: string;
}

export function parseLatencyProbeArgs(
  positional: string[],
  defaultModelId: string,
): GatewayLatencyProbeOptions {
  const flags = new Set(positional.filter((arg) => arg.startsWith("-")));
  const modelId = positional.find((arg) => !arg.startsWith("-")) ?? defaultModelId;
  return {
    modelId,
    includeLarge: flags.has("--large") || flags.has("-l"),
    includeBedrock: flags.has("--bedrock"),
  };
}

export async function fetchGatewayLatencyProbe(
  cwd: string,
  options: GatewayLatencyProbeOptions,
): Promise<GatewayLatencyProbeReport> {
  const config = getGatewayConfig(cwd);
  const notes: string[] = [];
  const probes: GatewayLatencyProbeEntry[] = [];

  if (!config.baseUrl) {
    return baseError(options.modelId, "Missing gateway base URL.");
  }
  if (!config.apiKey) {
    return baseError(options.modelId, `Missing ${API_KEY_ENV} or saved API key.`);
  }

  const rootUrl = toGatewayRootBaseUrl(config.baseUrl);
  const openAiBaseUrl = toGatewayOpenAiBaseUrl(config.baseUrl);
  const authHeaders = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  probes.push(
    await timedJsonProbe("GET /v1/models", `${openAiBaseUrl}/models`, authHeaders),
    await timedJsonProbe("GET /v1/model/info", `${openAiBaseUrl}/model/info`, authHeaders),
  );

  probes.push(
    await generationProbe({
      label: `${options.modelId} small generation`,
      rootUrl,
      openAiBaseUrl,
      modelId: options.modelId,
      authHeaders,
      fillerWords: SMALL_FILLER_WORDS,
    }),
  );

  if (options.includeLarge) {
    notes.push(
      `--large sends about ${LARGE_FILLER_WORDS.toLocaleString()} repeated filler words with max output 1; use sparingly because it still consumes gateway quota.`,
    );
    probes.push(
      await generationProbe({
        label: `${options.modelId} large generation`,
        rootUrl,
        openAiBaseUrl,
        modelId: options.modelId,
        authHeaders,
        fillerWords: LARGE_FILLER_WORDS,
      }),
    );
  }

  if (options.includeBedrock) {
    if (isOpus47OrNewerModelId(options.modelId)) {
      probes.push(await bedrockOpus47Probe(rootUrl, authHeaders, options.includeLarge));
    } else {
      notes.push("--bedrock currently runs only for Opus 4.7 model IDs.");
    }
  }

  return {
    ok: probes.every((probe) => probe.ok),
    modelId: options.modelId,
    generatedAt: new Date().toISOString(),
    notes,
    probes,
  };
}

export function formatGatewayLatencyProbe(report: GatewayLatencyProbeReport): string {
  if (!report.ok && report.error) {
    return `Gateway latency probe for ${report.modelId} failed.\n  Error: ${report.error}`;
  }

  const lines = [`Gateway latency probe for ${report.modelId}`, `Generated: ${report.generatedAt}`];
  if (report.notes.length > 0) {
    lines.push("", "Notes:", ...report.notes.map((note) => `- ${note}`));
  }
  lines.push("", "Probes:");
  for (const probe of report.probes) {
    const timing = [
      probe.durationMs !== undefined ? `total=${probe.durationMs}ms` : undefined,
      probe.headersMs !== undefined ? `headers=${probe.headersMs}ms` : undefined,
      probe.firstChunkMs !== undefined ? `firstChunk=${probe.firstChunkMs}ms` : undefined,
      probe.firstTextMs !== undefined ? `firstText=${probe.firstTextMs}ms` : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(
      `- ${probe.ok ? "OK" : "FAIL"} ${probe.label}${probe.status ? ` (HTTP ${probe.status})` : ""}${timing ? ` :: ${timing}` : ""}`,
    );
    const usage = summarizeUsage(probe.usage);
    if (usage) lines.push(`  usage: ${usage}`);
    if (probe.error) lines.push(`  error: ${probe.error}`);
  }
  return lines.join("\n");
}

function baseError(modelId: string, error: string): GatewayLatencyProbeReport {
  return {
    ok: false,
    modelId,
    generatedAt: new Date().toISOString(),
    notes: [],
    probes: [],
    error,
  };
}

async function timedJsonProbe(
  label: string,
  url: string,
  headers: Record<string, string>,
): Promise<GatewayLatencyProbeEntry> {
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(url, { method: "GET", headers }, METADATA_TIMEOUT_MS);
    await response.text();
    return {
      label,
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - started,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      label,
      ok: false,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function generationProbe(input: {
  label: string;
  rootUrl: string;
  openAiBaseUrl: string;
  modelId: string;
  authHeaders: Record<string, string>;
  fillerWords: number;
}): Promise<GatewayLatencyProbeEntry> {
  if (isAnthropicModelId(input.modelId)) {
    return sseProbe(
      input.label,
      `${input.rootUrl}/v1/messages`,
      buildAnthropicBody(input.modelId, input.fillerWords),
      {
        ...input.authHeaders,
        "anthropic-version": "2023-06-01",
      },
    );
  }

  if (isGpt5FamilyResponsesModelId(input.modelId)) {
    return sseProbe(
      input.label,
      `${input.rootUrl}/responses`,
      buildOpenAiResponsesBody(input.modelId, input.fillerWords),
      input.authHeaders,
    );
  }

  return sseProbe(
    input.label,
    `${input.openAiBaseUrl}/chat/completions`,
    buildOpenAiChatBody(input.modelId, input.fillerWords),
    input.authHeaders,
  );
}

function buildPrompt(fillerWords: number): string {
  if (fillerWords <= 0) return "Latency probe. Return exactly: pong";
  return [
    "Latency probe. Ignore the repeated filler and return exactly: pong",
    "FILLER START",
    "alpha ".repeat(fillerWords),
    "FILLER END",
    "Return exactly: pong",
  ].join("\n");
}

function buildAnthropicBody(modelId: string, fillerWords: number): Record<string, unknown> {
  return {
    model: modelId,
    max_tokens: 1,
    stream: true,
    messages: [{ role: "user", content: buildPrompt(fillerWords) }],
    // Keep latency probes stable and cheap. Users can test thinking separately
    // with the normal model selector / wire trace.
    thinking: { type: "disabled" },
  };
}

// Exported for unit tests.
export function buildOpenAiResponsesBody(
  modelId: string,
  fillerWords: number,
): Record<string, unknown> {
  return {
    model: modelId,
    max_output_tokens: RESPONSES_LATENCY_PROBE_MAX_OUTPUT_TOKENS,
    input: [{ role: "user", content: [{ type: "input_text", text: buildPrompt(fillerWords) }] }],
    stream: true,
    store: false,
  };
}

function buildOpenAiChatBody(modelId: string, fillerWords: number): Record<string, unknown> {
  return {
    model: modelId,
    max_tokens: 1,
    messages: [{ role: "user", content: buildPrompt(fillerWords) }],
    stream: true,
  };
}

async function sseProbe(
  label: string,
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<GatewayLatencyProbeEntry> {
  const started = Date.now();
  const entry: GatewayLatencyProbeEntry = { label, ok: false };
  try {
    const response = await fetchWithTimeout(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      GENERATION_TIMEOUT_MS,
    );
    entry.status = response.status;
    entry.headersMs = Date.now() - started;
    if (!response.ok || !response.body) {
      entry.durationMs = Date.now() - started;
      entry.error = preview(await response.text());
      return entry;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (entry.firstChunkMs === undefined) entry.firstChunkMs = Date.now() - started;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        consumeSseEvent(entry, rawEvent, started);
      }
    }
    entry.ok = !entry.error;
    entry.durationMs = Date.now() - started;
    return entry;
  } catch (error) {
    entry.durationMs = Date.now() - started;
    entry.error = error instanceof Error ? error.message : String(error);
    return entry;
  }
}

function consumeSseEvent(entry: GatewayLatencyProbeEntry, rawEvent: string, started: number): void {
  for (const line of rawEvent.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    entry.eventCount = (entry.eventCount ?? 0) + 1;
    if (entry.firstEventMs === undefined) entry.firstEventMs = Date.now() - started;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }

    const error = extractError(parsed);
    if (error) entry.error = error;
    const usage = extractUsage(parsed);
    if (usage) entry.usage = usage;
    const text = extractTextDelta(parsed);
    if (text) {
      if (entry.firstTextMs === undefined) entry.firstTextMs = Date.now() - started;
      entry.textChars = (entry.textChars ?? 0) + text.length;
    }
  }
}

async function bedrockOpus47Probe(
  rootUrl: string,
  authHeaders: Record<string, string>,
  large: boolean,
): Promise<GatewayLatencyProbeEntry> {
  const label = `claude-opus-4-7 bedrock invoke-with-response-stream${large ? " large" : ""}`;
  const started = Date.now();
  const entry: GatewayLatencyProbeEntry = { label, ok: false };
  try {
    const response = await fetchWithTimeout(
      `${rootUrl}/bedrock/model/global.anthropic.claude-opus-4-7/invoke-with-response-stream`,
      {
        method: "POST",
        headers: { ...authHeaders, Accept: "application/vnd.amazon.eventstream" },
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 1,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: buildPrompt(large ? LARGE_FILLER_WORDS : 0) }],
            },
          ],
        }),
      },
      GENERATION_TIMEOUT_MS,
    );
    entry.status = response.status;
    entry.headersMs = Date.now() - started;
    if (!response.ok || !response.body) {
      entry.durationMs = Date.now() - started;
      entry.error = preview(await response.text());
      return entry;
    }
    const reader = response.body.getReader();
    const { value } = await reader.read();
    entry.firstChunkMs = Date.now() - started;
    entry.eventCount = value?.byteLength ? 1 : 0;
    await reader.cancel();
    entry.durationMs = Date.now() - started;
    entry.ok = true;
    return entry;
  } catch (error) {
    entry.durationMs = Date.now() - started;
    entry.error = error instanceof Error ? error.message : String(error);
    return entry;
  }
}

function extractTextDelta(parsed: Record<string, unknown>): string {
  const delta = parsed.delta;
  if (typeof delta === "string") return delta;
  if (delta && typeof delta === "object") {
    const record = delta as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.thinking === "string") return record.thinking;
  }
  const choices = parsed.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as { delta?: { content?: unknown } } | undefined;
    if (typeof first?.delta?.content === "string") return first.delta.content;
  }
  return "";
}

function extractUsage(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  if (parsed.usage && typeof parsed.usage === "object")
    return parsed.usage as Record<string, unknown>;
  const message = parsed.message;
  if (message && typeof message === "object") {
    const usage = (message as Record<string, unknown>).usage;
    if (usage && typeof usage === "object") return usage as Record<string, unknown>;
  }
  const response = parsed.response;
  if (response && typeof response === "object") {
    const usage = (response as Record<string, unknown>).usage;
    if (usage && typeof usage === "object") return usage as Record<string, unknown>;
  }
  return undefined;
}

function extractError(parsed: Record<string, unknown>): string | undefined {
  if (parsed.type === "error") return preview(JSON.stringify(parsed));
  if (parsed.error) return preview(JSON.stringify(parsed.error));
  return undefined;
}

function summarizeUsage(usage: Record<string, unknown> | undefined): string | undefined {
  if (!usage) return undefined;
  const keys = [
    "input_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "output_tokens",
    "total_tokens",
  ];
  const parts = keys
    .map((key) => (typeof usage[key] === "number" ? `${key}=${usage[key]}` : undefined))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function preview(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 400);
}
