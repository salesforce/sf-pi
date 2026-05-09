/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Slack-only HTTP/1.1 fetcher.
 *
 * Newer Node versions (>=26) negotiate HTTP/2 with slack.com via TLS ALPN
 * and undici's H2 dispatcher hangs forever on the response stream. The
 * visible symptom on the splash is `Slack: ⏳ Checking` followed 30 s
 * later by `request_timeout` (the AbortSignal.timeout in `fetchWithRetry`).
 *
 * Empirical results on Node v26.0.0 + undici 7.25.0:
 *   curl --http1.1                      ->  92 ms (200)
 *   curl --http2                        ->  84 ms (200)
 *   undici fetch (H2 default)           ->  hangs 30 s
 *   undici fetch + Agent allowH2:false  ->  returns binary frame data (broken)
 *   node:https.request                  -> 106 ms (200)
 *
 * undici's `allowH2: false` does not disable HTTP/2 reliably here — the
 * stream still negotiates h2 and the response body comes back as raw H2
 * frame bytes. The only consistently working transport on this machine is
 * Node's built-in `node:https` module, which is HTTP/1.1 only.
 *
 * We therefore expose a minimal `slackFetch` that mimics enough of the
 * Web `fetch` Response shape (status, ok, headers, json(), text()) for
 * the rest of sf-slack to consume without further changes.
 */
import https from "node:https";

interface SlackFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  signal?: AbortSignal;
}

/**
 * Fetch-shaped Response we hand back to callers. Only the surface area
 * sf-slack actually uses is implemented (`status`, `ok`, `headers`,
 * `json()`, `text()`, `arrayBuffer()`). That is intentional — keeping the
 * shim minimal means we cannot accidentally diverge from a real Response.
 */
export interface SlackFetchResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Test override hook. When set, `slackFetch` delegates to the supplied
 * fn instead of `node:https.request`. Tests can install a vitest mock
 * here without having to intercept the global fetch (which sf-slack no
 * longer uses on the production path).
 */
type SlackFetchImpl = (url: string, init: SlackFetchInit) => Promise<SlackFetchResponse>;
let slackFetchOverride: SlackFetchImpl | null = null;

export function setSlackFetchForTests(impl: SlackFetchImpl | null): void {
  slackFetchOverride = impl;
}

/**
 * Drop-in replacement for `fetch(url, init)` that is restricted to the
 * Slack API. Uses `node:https.request` so we always speak HTTP/1.1 and
 * skip undici's H2 dispatcher entirely.
 *
 * Throws on network errors and AbortError (for timeout / user signals)
 * so callers can distinguish those from HTTP error responses, matching
 * `fetch` semantics.
 */
export function slackFetch(url: string, init: SlackFetchInit = {}): Promise<SlackFetchResponse> {
  if (slackFetchOverride) return slackFetchOverride(url, init);
  const parsed = new URL(url);
  const bodyText =
    init.body === undefined ? "" : typeof init.body === "string" ? init.body : init.body.toString();
  const headers: Record<string, string> = {
    ...init.headers,
    "Content-Length": String(Buffer.byteLength(bodyText, "utf8")),
  };

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: init.method ?? "GET",
        host: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          // Slack does not advertise gzip/deflate by default in its responses,
          // and we never set Accept-Encoding to anything other than identity.
          // If a future upstream change adds compression here, decode it before
          // resolve(); for now treat the body as raw utf8 / bytes.
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: {
              get(name: string): string | null {
                const value = res.headers[name.toLowerCase()];
                if (Array.isArray(value)) return value.join(", ");
                return typeof value === "string" ? value : null;
              },
            },
            async json() {
              return JSON.parse(buf.toString("utf8")) as unknown;
            },
            async text() {
              return buf.toString("utf8");
            },
            async arrayBuffer() {
              return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            },
          });
        });
        res.on("error", reject);
      },
    );

    req.on("error", (error) => {
      if (init.signal?.aborted) {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        reject(abortError);
        return;
      }
      reject(error);
    });

    if (init.signal) {
      const abortHandler = () => {
        req.destroy(new Error("Aborted"));
      };
      if (init.signal.aborted) {
        abortHandler();
      } else {
        init.signal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    if (bodyText) req.write(bodyText);
    req.end();
  });
}

/** Backwards-compatible alias for older code paths still importing the dispatcher helper. */
export function getSlackHttpDispatcher(): unknown {
  return undefined;
}
