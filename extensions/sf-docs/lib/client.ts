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
const TRANSIENT_RETRY_DELAY_MS = 100;

class DocsHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DocsHttpError";
  }
}

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
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await this.callToolOnce(name, args, controller.signal);
        } catch (err) {
          if (attempt === 0 && !controller.signal.aborted && isRetryableRequestError(err)) {
            await waitForRetry(controller.signal);
            continue;
          }
          throw err;
        }
      }
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

  private async callToolOnce(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
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
      signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new DocsHttpError(
        response.status,
        `Docs service HTTP ${response.status}: ${text.slice(0, 500)}`,
      );
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
  }
}

function isRetryableRequestError(error: unknown): boolean {
  if (error instanceof DocsHttpError) return [502, 503, 504].includes(error.status);
  if (!(error instanceof TypeError)) return false;
  if (/fetch failed|connection (?:closed|reset)|network error/iu.test(error.message)) return true;
  const code = (error.cause as { code?: unknown } | undefined)?.code;
  return (
    typeof code === "string" &&
    ["EAI_AGAIN", "ECONNRESET", "ENETUNREACH", "UND_ERR_SOCKET"].includes(code)
  );
}

function waitForRetry(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, TRANSIENT_RETRY_DELAY_MS);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
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
