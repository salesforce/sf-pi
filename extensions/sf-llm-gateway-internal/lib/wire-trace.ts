/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Opt-in wire-level trace for the SF LLM Gateway Internal extension.
 *
 * Why a fetch wrapper instead of onPayload/onChunk?
 * - onPayload shows only what we send.
 * - onChunk is Pi-side post-parse, after pi-ai has already interpreted the
 *   SSE stream. If pi-ai's parser is dropping a chunk, onChunk wouldn't
 *   show it.
 *
 * The raw fetch response body gives us ground-truth from the gateway.
 *
 * Activation: set `SF_LLM_GATEWAY_INTERNAL_TRACE=1`.
 * Output file: under Pi's global agent directory as `sf-llm-gateway-internal.trace.jsonl`
 * Non-destructive: one-line JSON per request/chunk, append-only.
 * No-op unless the URL matches the configured gateway baseUrl, so other
 * providers' fetches pass through untouched.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";

const TRACE_ENV = "SF_LLM_GATEWAY_INTERNAL_TRACE";

let installed = false;

function traceFilePath(): string {
  return globalAgentPath("sf-llm-gateway-internal.trace.jsonl");
}

function ensureTraceFile(): string {
  const p = traceFilePath();
  const dir = path.dirname(p);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Truncate on first install per process so each pi launch starts clean.
  if (!installed) {
    writeFileSync(p, "", { mode: 0o600 });
  }
  return p;
}

function writeLine(p: string, line: unknown): void {
  try {
    appendFileSync(p, JSON.stringify(line) + "\n");
  } catch {
    // tracing must never break requests
  }
}

/**
 * Install a global fetch wrapper that records every request+response for the
 * SF LLM Gateway base URL. Idempotent. No-op unless the trace env var is set.
 *
 * Returns true if tracing is now active, false otherwise.
 */
export function installWireTrace(baseUrlHint?: string): boolean {
  if (process.env[TRACE_ENV] !== "1") return false;
  if (installed) return true;

  const filterHost = (() => {
    if (!baseUrlHint) return undefined;
    try {
      return new URL(baseUrlHint).host;
    } catch {
      return undefined;
    }
  })();

  const traceFile = ensureTraceFile();
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" || input instanceof URL ? String(input) : (input as Request).url;
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return "";
      }
    })();

    // Only record gateway traffic when a host filter is known.
    const shouldTrace = !filterHost || host === filterHost;

    if (!shouldTrace) {
      return originalFetch(input as RequestInfo, init);
    }

    const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    // Capture the request body if present and string-like.
    let bodyPreview: unknown = undefined;
    if (init?.body && typeof init.body === "string") {
      try {
        bodyPreview = JSON.parse(init.body);
      } catch {
        bodyPreview =
          init.body.length > 4000 ? init.body.slice(0, 4000) + "…[truncated]" : init.body;
      }
    }

    writeLine(traceFile, {
      t: "req",
      reqId,
      ts: new Date().toISOString(),
      url,
      method: init?.method || "GET",
      body: bodyPreview,
    });

    let response: Response;
    try {
      response = await originalFetch(input as RequestInfo, init);
    } catch (error) {
      writeLine(traceFile, {
        t: "err",
        reqId,
        ts: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    writeLine(traceFile, {
      t: "res_head",
      reqId,
      ts: new Date().toISOString(),
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
    });

    // If not streaming or no body, log and pass through.
    const contentType = response.headers.get("content-type") || "";
    const isSse = contentType.includes("text/event-stream");
    if (!response.body || !isSse) {
      // For non-streamed responses, tee the body so both the tracer and the
      // caller can read it.
      const cloned = response.clone();
      cloned
        .text()
        .then((text) => {
          writeLine(traceFile, {
            t: "res_body",
            reqId,
            ts: new Date().toISOString(),
            body: text.length > 20000 ? text.slice(0, 20000) + "…[truncated]" : text,
          });
        })
        .catch(() => {});
      return response;
    }

    // SSE path: tee the stream so the caller sees every chunk untouched AND
    // the trace file gets a copy of every chunk.
    const [forCaller, forTrace] = response.body.tee();

    // Drain the trace branch in the background.
    (async () => {
      const reader = forTrace.getReader();
      const decoder = new TextDecoder();
      let chunkIndex = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          writeLine(traceFile, {
            t: "sse_chunk",
            reqId,
            ts: new Date().toISOString(),
            chunkIndex: chunkIndex++,
            text,
          });
        }
      } catch (error) {
        writeLine(traceFile, {
          t: "sse_err",
          reqId,
          ts: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        writeLine(traceFile, {
          t: "sse_end",
          reqId,
          ts: new Date().toISOString(),
          totalChunks: chunkIndex,
        });
      }
    })();

    // Return a new Response that wraps the caller branch.
    return new Response(forCaller, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }) as typeof globalThis.fetch;

  installed = true;
  writeLine(traceFile, {
    t: "install",
    ts: new Date().toISOString(),
    filterHost: filterHost ?? "(any)",
  });
  return true;
}

export function isWireTraceEnabled(): boolean {
  return process.env[TRACE_ENV] === "1";
}

export function getWireTraceFile(): string {
  return traceFilePath();
}
