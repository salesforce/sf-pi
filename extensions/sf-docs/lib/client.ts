/* SPDX-License-Identifier: Apache-2.0 */
/** HTTP JSON-RPC/SSE client for the Salesforce Docs service. */
import { parseJsonRpcSseResponse } from "./sse.ts";
import { ENV_TOKEN } from "./types.ts";

export interface DocsClientOptions {
  endpoint: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface JsonRpcEnvelope {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

let nextId = 1;

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
    signal?.addEventListener("abort", abortListener, { once: true });
    try {
      const response = await this.fetchImpl(this.options.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: nextId++,
          method: "tools/call",
          params: { name, arguments: args },
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          redactSecrets(
            `Docs service HTTP ${response.status}: ${text.slice(0, 500)}`,
            this.options.token,
          ),
        );
      }
      const parsed = parseJsonRpcSseResponse(text) as JsonRpcEnvelope;
      if (parsed.error) {
        throw new Error(
          redactSecrets(
            `Docs service error ${parsed.error.code ?? ""}: ${parsed.error.message ?? "unknown error"}`,
            this.options.token,
          ),
        );
      }
      return unwrapToolContent(parsed.result);
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error("Docs service request timed out or was cancelled.", { cause: err });
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(redactSecrets(message, this.options.token), { cause: err });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortListener);
    }
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

export function redactSecrets(value: string, token?: string): string {
  let output = value;
  if (token) output = output.split(token).join("[REDACTED]");
  const envToken = process.env[ENV_TOKEN];
  if (envToken) output = output.split(envToken).join("[REDACTED]");
  return output.replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]");
}
