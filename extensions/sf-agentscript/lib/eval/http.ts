/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SFAP-aware HTTP client for the eval API surface.
 *
 * Authentication strategy
 * -----------------------
 * We do NOT call `https://api.salesforce.com/...` directly with our own
 * bearer token. Instead, every request is shelled through
 * `sf api request rest` so that the active org's auth context is reused
 * (auto-refresh, named-creds, JWT, etc. all keep working). This matches the
 * sf-data360 pattern and keeps the eval module out of the access-token
 * business.
 *
 * Endpoint fallback
 * -----------------
 * The eval and trace endpoints live on Salesforce Falcon API Platform (SFAP),
 * which routes prod/sandbox/scratch traffic via different hosts. The upstream
 * `@salesforce/agents` SDK fixed sandbox 404s by walking
 * `api.salesforce.com → test.api.salesforce.com → dev.api.salesforce.com`
 * (commit f871a07, May 2026). We do the same.
 *
 * Retry policy
 * ------------
 * 5xx responses retry with jittered exponential backoff (1s / 2s / 4s plus
 * up to 500 ms jitter). 4xx responses (including 408/429) do NOT retry —
 * the eval API has no published Retry-After contract and blind retries can
 * amplify a server overload. 404 walks to the next endpoint variant.
 * Connection-level errors (ECONNRESET, ETIMEDOUT, etc.) retry on the same
 * endpoint.
 */

import type { ExecFn } from "../../../../lib/common/sf-environment/detect.ts";

export type HttpMethod = "GET" | "POST";

export interface HttpRequest {
  /** Absolute URL on api.salesforce.com (host gets rewritten on fallback). */
  url: string;
  method: HttpMethod;
  /** Required: the org alias / username — passed to `sf api request rest --target-org`. */
  targetOrg: string;
  /** Custom headers (Authorization is auto-attached by sf CLI). */
  headers?: Record<string, string>;
  /** JSON-serializable body for POST. */
  body?: unknown;
  /** Per-call timeout in ms. Defaults to 300_000 (5 min) for eval, 60_000 for trace. */
  timeoutMs?: number;
  /** Max retries for 5xx + connection errors. Default 2. */
  maxRetries?: number;
  /** Toggle the api → test.api → dev.api walk on 404. Default true. */
  fallback?: boolean;
}

export interface HttpResponse<T = unknown> {
  status: number;
  body: T;
  /** Which SFAP host actually answered (`""` = prod, `"test."` = sandbox, etc.). */
  endpoint: string;
}

const SFAP_PREFIXES = ["", "test.", "dev."] as const;
const SFAP_HOST_RE = /https:\/\/(?:test\.|dev\.)?api\.salesforce\.com/;

function swapEndpoint(url: string, prefix: string): string {
  return url.replace(SFAP_HOST_RE, `https://${prefix}api.salesforce.com`);
}

function backoffMs(attempt: number): number {
  return 2 ** attempt * 1000 + Math.floor(Math.random() * 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Permissive parse — sf CLI sometimes wraps the response in its own envelope. */
function parseSfApiResult(stdout: string): { status?: number; body: unknown } {
  const trimmed = stdout.trim();
  if (!trimmed) return { body: {} };
  try {
    const parsed = JSON.parse(trimmed);
    // `sf api request rest --json` returns the response body inline; we don't
    // get the HTTP status code directly. We infer success from exit code.
    return { body: parsed };
  } catch {
    return { body: trimmed };
  }
}

/**
 * Detect HTTP errors that sf CLI surfaces as nonzero exits.
 * The CLI emits errors like:
 *   Error (404): Not Found
 *   ERROR_HTTP_500
 *   { "errorCode": "INVALID_AUTH" }
 */
function inferStatus(exitCode: number, stdout: string, stderr: string): number {
  if (exitCode === 0) return 200;
  const combined = `${stdout}\n${stderr}`;
  const m = /(?:Error\s*\((\d{3})\)|ERROR_HTTP_(\d{3}))/i.exec(combined);
  if (m) return parseInt(m[1] ?? m[2], 10);
  // Authentication / network failures bubble through with no embedded code.
  if (/auth|token|expired|refresh/i.test(combined)) return 401;
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(combined)) return 503;
  return 500;
}

function isRetryable(status: number): boolean {
  return status >= 500 && status < 600;
}

/**
 * Execute one HTTP call against an SFAP endpoint via `sf api request rest`,
 * with endpoint fallback on 404 and 5xx retry with jittered backoff.
 */
export async function httpCall<T = unknown>(
  exec: ExecFn,
  req: HttpRequest,
): Promise<HttpResponse<T>> {
  const endpoints = req.fallback === false ? [""] : (SFAP_PREFIXES as readonly string[]);
  const maxRetries = req.maxRetries ?? 2;
  const timeoutMs = req.timeoutMs ?? 300_000;

  let lastStatus = 0;
  let lastBody: unknown = null;
  let lastEndpoint = "";

  for (let i = 0; i < endpoints.length; i++) {
    const prefix = endpoints[i];
    const isLastEndpoint = i === endpoints.length - 1;
    const fullUrl = swapEndpoint(req.url, prefix);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const args = ["api", "request", "rest", fullUrl, "--target-org", req.targetOrg];
      if (req.method && req.method !== "GET") args.push("--method", req.method);
      if (req.body !== undefined && req.method === "POST") {
        args.push("--body", JSON.stringify(req.body));
      }
      for (const [k, v] of Object.entries(req.headers ?? {})) {
        args.push("--header", `${k}: ${v}`);
      }

      const result = await exec("sf", args, { timeout: timeoutMs });
      const status = inferStatus(result.code, result.stdout, result.stderr);
      const parsed = parseSfApiResult(result.stdout);
      lastStatus = status;
      lastBody = parsed.body;
      lastEndpoint = prefix;

      if (status >= 200 && status < 300) {
        return { status, body: parsed.body as T, endpoint: prefix };
      }

      // 404 → walk to next endpoint variant
      if (status === 404 && !isLastEndpoint) break;

      // 5xx + connection-level → retry on the same endpoint
      if (isRetryable(status) && attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }

      // 4xx (other than 404 with more endpoints to try) → terminal, return as-is
      if (status >= 400 && status < 500) {
        return { status, body: parsed.body as T, endpoint: prefix };
      }

      // Out of retries on 5xx → terminal
      if (attempt === maxRetries) {
        return { status, body: parsed.body as T, endpoint: prefix };
      }
    }
  }

  // All endpoints exhausted (only happens when every variant returned 404)
  return {
    status: lastStatus || 404,
    body: (lastBody ?? {}) as T,
    endpoint: lastEndpoint,
  };
}
