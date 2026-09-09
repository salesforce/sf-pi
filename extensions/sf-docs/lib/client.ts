/* SPDX-License-Identifier: Apache-2.0 */
/** HTTP JSON-RPC/SSE client for the Salesforce Docs service. */
import { parseJsonRpcSseResponse } from "./sse.ts";

export interface DocsClientOptions {
  endpoint: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface JsonRpcEnvelope {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

const REQUEST_ID = 1;

export class DocsClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: DocsClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortListener = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abortListener, { once: true });
    try {
      const response = await this.fetchImpl(this.options.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: REQUEST_ID,
          method: "tools/call",
          params: { name, arguments: args },
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Docs service HTTP ${response.status}: ${text.slice(0, 500)}`);
      }
      const parsed = validateJsonRpcEnvelope(
        parseJsonRpcResponse(text, response.headers.get("content-type")),
        REQUEST_ID,
      );
      if (parsed.error) {
        throw new Error(
          `Docs service error ${parsed.error.code ?? ""}: ${parsed.error.message ?? "unknown error"}`,
        );
      }
      return unwrapToolContent(parsed.result);
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error("Docs service request timed out or was cancelled.", { cause: err });
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message, { cause: err });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortListener);
    }
  }
}

export function validateJsonRpcEnvelope(
  value: unknown,
  requestId: number | string,
): JsonRpcEnvelope {
  if (!isRecord(value) || value.jsonrpc !== "2.0") {
    throw new Error("Docs service returned an invalid JSON-RPC 2.0 envelope.");
  }
  if (value.id !== requestId) {
    throw new Error(
      `Docs service JSON-RPC response id ${String(value.id)} did not match request id ${String(requestId)}.`,
    );
  }
  const hasResult = Object.hasOwn(value, "result");
  const hasError = Object.hasOwn(value, "error") && value.error !== undefined;
  if (hasResult === hasError) {
    throw new Error("Docs service JSON-RPC response must contain exactly one result or error.");
  }
  if (hasError && !isRecord(value.error)) {
    throw new Error("Docs service JSON-RPC error must be an object.");
  }
  return value as JsonRpcEnvelope;
}

export function parseJsonRpcResponse(body: string, contentType?: string | null): unknown {
  if (contentType?.toLowerCase().includes("text/event-stream")) {
    return parseJsonRpcSseResponse(body);
  }
  if (contentType?.toLowerCase().includes("application/json")) {
    return parseJsonBody(body);
  }
  try {
    return parseJsonBody(body);
  } catch {
    return parseJsonRpcSseResponse(body);
  }
}

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Docs service returned invalid JSON: ${message}`, { cause: err });
  }
}

export function unwrapToolContent(result: unknown): unknown {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)
    ?.content;
  const text = content?.map((part) => (typeof part.text === "string" ? part.text : "")).join("");
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
