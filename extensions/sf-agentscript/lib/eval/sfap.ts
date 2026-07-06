/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SFAP-aware HTTP client using @salesforce/core for auth and bounded native fetch for transport.
 *
 * Replaces the old subprocess path (`sf api request rest`). Same retry +
 * fallback policy:
 *  - 4 SFAP endpoints live on `api.salesforce.com`. Sandbox routing requires
 *    the host walk: `api.salesforce.com → test.api.salesforce.com →
 *    dev.api.salesforce.com` on 404.
 *  - 5xx + connection errors retry with jittered exponential backoff
 *    (1s / 2s / 4s plus up to 500 ms jitter). 4xx responses (including
 *    408/429) do NOT retry — the SFAP eval API has no published Retry-After
 *    contract and blind retries can amplify a server overload.
 *
 * Auth resolution is `Connection`'s job; we don't catch 401 specially.
 *
 * Never throws on HTTP errors. The caller decides what to do with non-2xx.
 */

import type { Connection } from "@salesforce/core";
import { clearAgentApiAuthCache } from "../agent-api-auth.ts";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "DELETE";

export interface SfapRequest {
  /** Absolute URL on api.salesforce.com — the host gets rewritten on fallback. */
  url: string;
  method: HttpMethod;
  /** Custom headers. Authorization is auto-attached by jsforce. */
  headers?: Record<string, string>;
  /** JSON-serializable body for POST. */
  body?: unknown;
  /** Per-call timeout in ms. Default 300_000 for POST, 60_000 for GET. */
  timeoutMs?: number;
  /** Max retries on 5xx + connection errors. Default 2. */
  maxRetries?: number;
  /** Retry client-side request timeouts. Default true for backwards compatibility. */
  retryOnTimeout?: boolean;
  /** Optional caller cancellation signal. */
  signal?: AbortSignal;
  /** Toggle the api → test.api → dev.api walk on 404. Default true. */
  fallback?: boolean;
  /**
   * When set, skip the host walk and target only this endpoint. Used by
   * sticky-session calls (send/end/trace) to pin to the host that served
   * `start`. Overrides `fallback`.
   */
  pinnedEndpoint?: "" | "test." | "dev.";
}

export interface SfapResponse<T = unknown> {
  status: number;
  body: T;
  /** Which SFAP host actually answered (`""` = prod, `"test."` = sandbox). */
  endpoint: "" | "test." | "dev.";
  /** In-memory endpoint-cache status for local operation timings. */
  endpoint_cache?: "hit" | "miss" | "refresh" | "bypass";
}

/**
 * Detect the canonical "this org isn't Agentforce/SFAP-enabled" failure mode
 * (every host variant returns 404 / HTML error pages). Returning true means
 * any retry across hosts will keep failing — the org just doesn't have these
 * routes wired up.
 */
export function isSfapRoutingFailure<T>(resp: SfapResponse<T>): boolean {
  if (resp.status !== 404) return false;
  const body = resp.body as unknown;
  if (!body) return false;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return /ERROR_HTTP_404|URL No Longer Exists/i.test(text);
}

// -------------------------------------------------------------------------------------------------
// Internals
// -------------------------------------------------------------------------------------------------

const PREFIXES = ["", "test.", "dev."] as const;
const HOST_RE = /https:\/\/(?:test\.|dev\.)?api\.salesforce\.com/;
const sfapEndpointCache = new Map<string, SfapResponse["endpoint"]>();

function swapEndpoint(url: string, prefix: string): string {
  return url.replace(HOST_RE, `https://${prefix}api.salesforce.com`);
}

function backoffMs(attempt: number): number {
  return 2 ** attempt * 1000 + Math.floor(Math.random() * 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Pull an HTTP status code out of whatever jsforce/connection threw.
 *
 * jsforce surfaces HTTP errors as objects with `errorCode`, `name`, `message`.
 * The HTTP status sometimes lives on `statusCode`, sometimes embedded in the
 * message (`"Error 404: ..."`), sometimes nowhere at all.
 */
function inferStatusFromError(err: unknown): number {
  const e = err as Record<string, unknown> | null;
  if (!e || typeof e !== "object") return 500;

  const direct = e.statusCode;
  if (typeof direct === "number" && direct >= 100 && direct < 600) return direct;

  // jsforce often surfaces error bodies and codes via `message`, `errorCode`,
  // and `name`. Build a search blob from all three so we don't miss the code.
  const message = typeof e.message === "string" ? e.message : "";
  const errorCode = typeof e.errorCode === "string" ? e.errorCode : "";
  const name = typeof e.name === "string" ? e.name : "";
  const blob = `${message} ${errorCode} ${name}`;

  // SFAP frequently reports its routing 404 as ERROR_HTTP_404 inside the body.
  // Match those before the loose `\b\d{3}\b` so we get the actual status.
  const errorHttp = /ERROR_HTTP_(\d{3})/.exec(blob);
  if (errorHttp) {
    const n = parseInt(errorHttp[1], 10);
    if (n >= 100 && n < 600) return n;
  }

  const match = /\b(\d{3})\b/.exec(blob);
  if (match) {
    const n = parseInt(match[1], 10);
    if (n >= 100 && n < 600) return n;
  }

  // Network-level failures bubble through with no status. Treat as retryable 503.
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i.test(blob)) return 503;

  // Auth failures end the run on the spot — don't retry.
  if (/auth|token|expired|refresh|unauthorized/i.test(blob)) return 401;

  return 500;
}

function errorAsBody(err: unknown): unknown {
  const e = err as Record<string, unknown> | null;
  if (!e) return {};
  return {
    errorCode: e.errorCode,
    message: e.message,
    name: e.name,
  };
}

async function callOnce<T>(
  conn: Connection,
  url: string,
  req: SfapRequest,
  timeoutMs: number,
): Promise<{ status: number; body: T }> {
  const accessToken =
    (conn as unknown as { accessToken?: string }).accessToken ??
    (conn.getConnectionOptions?.() as { accessToken?: string } | undefined)?.accessToken;
  if (!accessToken) {
    // Unit tests and a few legacy fakes provide only `conn.request`. Real
    // Salesforce connections should have an access token and take the bounded
    // fetch path below.
    try {
      const body = await conn.request<T>({
        method: req.method,
        url,
        headers: req.headers,
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        timeout: timeoutMs,
      } as Parameters<typeof conn.request>[0]);
      return { status: 200, body };
    } catch (err) {
      return { status: inferStatusFromError(err), body: errorAsBody(err) as T };
    }
  }
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = (): void => controller.abort();
  if (req.signal?.aborted) {
    return {
      status: 499,
      body: { errorCode: "REQUEST_ABORTED", message: "Request aborted before it started." } as T,
    };
  }
  req.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const resp = await fetch(url, {
      method: req.method,
      headers: {
        ...(req.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    });
    const text = await resp.text();
    let body: unknown;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } else {
      body = {};
    }
    return { status: resp.status, body: body as T };
  } catch (err) {
    if (req.signal?.aborted) {
      return {
        status: 499,
        body: {
          errorCode: "REQUEST_ABORTED",
          message: "Request aborted.",
          name: "AbortError",
        } as T,
      };
    }
    if (timedOut) {
      return {
        status: 503,
        body: {
          errorCode: "REQUEST_TIMEOUT",
          message: `Request timed out after ${timeoutMs}ms`,
          name: "TimeoutError",
        } as T,
      };
    }
    return { status: inferStatusFromError(err), body: errorAsBody(err) as T };
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function isRetryable(status: number): boolean {
  return status >= 500 && status < 600;
}

function isRequestTimeoutBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const code = (body as { errorCode?: unknown }).errorCode;
  return code === "REQUEST_TIMEOUT";
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

/**
 * Single SFAP call with host fallback + 5xx retry. Never throws on HTTP errors.
 */
export async function sfapRequest<T = unknown>(
  conn: Connection,
  req: SfapRequest,
): Promise<SfapResponse<T>> {
  // Resolution order:
  //   1. `pinnedEndpoint` set → only that host (sticky session continuity).
  //   2. `fallback === false` → only production.
  //   3. cached prefix first when available, then normal api → test.api → dev.api on 404.
  const cacheKey = sfapEndpointCacheKey(conn);
  const cachedEndpoint = sfapEndpointCache.get(cacheKey);
  const cacheEnabled = req.pinnedEndpoint === undefined && req.fallback !== false;
  const endpoints =
    req.pinnedEndpoint !== undefined
      ? [req.pinnedEndpoint]
      : req.fallback === false
        ? [""]
        : cachedEndpoint
          ? [cachedEndpoint, ...PREFIXES.filter((prefix) => prefix !== cachedEndpoint)]
          : (PREFIXES as readonly string[]);
  const maxRetries = req.maxRetries ?? 2;
  const retryOnTimeout = req.retryOnTimeout ?? true;
  const timeoutMs = req.timeoutMs ?? (req.method === "POST" ? 300_000 : 60_000);

  let lastStatus = 0;
  let lastBody: unknown = null;
  let lastEndpoint: SfapResponse["endpoint"] = "";

  const cacheState = (endpoint: SfapResponse["endpoint"]): SfapResponse["endpoint_cache"] => {
    if (!cacheEnabled) return "bypass";
    if (!cachedEndpoint) return "miss";
    return endpoint === cachedEndpoint ? "hit" : "refresh";
  };

  for (let i = 0; i < endpoints.length; i++) {
    const prefix = endpoints[i] as SfapResponse["endpoint"];
    const isLastEndpoint = i === endpoints.length - 1;
    const fullUrl = swapEndpoint(req.url, prefix);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await callOnce<T>(conn, fullUrl, req, timeoutMs);
      lastStatus = result.status;
      lastBody = result.body;
      lastEndpoint = prefix;

      if (result.status >= 200 && result.status < 300) {
        if (cacheEnabled) sfapEndpointCache.set(cacheKey, prefix);
        return {
          status: result.status,
          body: result.body,
          endpoint: prefix,
          endpoint_cache: cacheState(prefix),
        };
      }

      // 404 → walk to next endpoint variant (sandbox-safe SFAP routing).
      if (result.status === 404 && !isLastEndpoint) break;

      // Client-side timeouts are represented as 503 for older callers, but
      // timeout-sensitive workflows can opt out of retrying a known local timeout.
      if (!retryOnTimeout && isRequestTimeoutBody(result.body)) {
        return {
          status: result.status,
          body: result.body,
          endpoint: prefix,
          endpoint_cache: cacheState(prefix),
        };
      }

      // 5xx + connection-level errors → retry on the same endpoint.
      if (isRetryable(result.status) && attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }

      // 4xx (other than 404 with more endpoints to try) → terminal.
      if (result.status >= 400 && result.status < 500) {
        if (result.status === 401) clearAgentApiAuthCache();
        return {
          status: result.status,
          body: result.body,
          endpoint: prefix,
          endpoint_cache: cacheState(prefix),
        };
      }

      // Out of retries on 5xx → terminal.
      if (attempt === maxRetries) {
        if (result.status === 401) clearAgentApiAuthCache();
        return {
          status: result.status,
          body: result.body,
          endpoint: prefix,
          endpoint_cache: cacheState(prefix),
        };
      }
    }
  }

  return {
    status: lastStatus || 404,
    body: (lastBody ?? {}) as T,
    endpoint: lastEndpoint,
    endpoint_cache: cacheState(lastEndpoint),
  };
}

function sfapEndpointCacheKey(conn: Connection): string {
  const opts = conn.getConnectionOptions?.() as { instanceUrl?: string } | undefined;
  const instanceUrl = conn.instanceUrl ?? opts?.instanceUrl ?? "<unknown-instance>";
  let username = "<unknown-user>";
  let apiVersion = "<unknown-api>";
  try {
    username = conn.getUsername?.() ?? username;
  } catch {
    /* best-effort */
  }
  try {
    apiVersion = conn.getApiVersion?.() ?? apiVersion;
  } catch {
    /* best-effort */
  }
  return [username, instanceUrl, apiVersion].join("::");
}

export function clearSfapEndpointCache(): void {
  sfapEndpointCache.clear();
}

export function sfapEndpointCacheSize(): number {
  return sfapEndpointCache.size;
}
