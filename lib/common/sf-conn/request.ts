/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Thin wrapper around `Connection.request` that returns `{ status, body }`
 * instead of throwing on HTTP errors. Mirrors the contract of the SFAP
 * client in `extensions/sf-agentscript/lib/eval/sfap.ts` for non-SFAP
 * (instance-URL) routes.
 *
 * The auto-refreshing token, retry on 5xx, and JSON parse all live inside
 * `Connection`; callers just see a typed body and a status. 4xx responses
 * surface as `{ status, body }` too — this helper never raises for HTTP.
 *
 * Example:
 *   const conn = await connFromAlias(targetOrg);
 *   const resp = await connRequest<DmoListResponse>(conn, {
 *     method: "GET",
 *     url: "/services/data/v66.0/ssot/data-model-objects?limit=1",
 *   });
 *   if (resp.status >= 400) … else use resp.body …
 */

import type { Connection } from "@salesforce/core";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ConnRequest {
  method: HttpMethod;
  /** Path relative to instance URL (e.g. `/services/data/v66.0/...`) or absolute URL. */
  url: string;
  /**
   * Request body. Passed through unchanged when it's already a string
   * (caller has serialized it; e.g. an LLM tool that accepted a raw JSON
   * body). Otherwise JSON-serialized. Pass undefined to omit.
   *
   * The string-passthrough path matters in practice: if a caller hands us
   * an already-stringified `{"sql":"..."}` and we run it through
   * `JSON.stringify` again, the server receives a JSON-quoted string and
   * returns `JSON_PARSER_ERROR`. See `serializeBody` below for the rule.
   */
  body?: unknown;
  /** Custom headers. Defaults to `Content-Type: application/json` + `Accept: application/json`. */
  headers?: Record<string, string>;
  /** Per-call timeout in ms. Default 120_000. Enforced by this wrapper. */
  timeoutMs?: number;
  /** Optional caller cancellation signal. */
  signal?: AbortSignal;
}

export interface ConnResponse<T> {
  /** HTTP status. 200 on success path; 4xx/5xx for errors. */
  status: number;
  /** Parsed JSON body on success; `{ errorCode, message, name }` shape on error. */
  body: T;
}

/**
 * Single HTTP call via `Connection.request`. Never throws on HTTP errors.
 *
 * jsforce auto-refreshes auth, parses JSON responses, and follows the
 * Connection's instance URL. We layer "HTTP errors are data, not exceptions"
 * on top so call sites can write linear code.
 */
export async function connRequest<T = unknown>(
  conn: Connection,
  req: ConnRequest,
): Promise<ConnResponse<T>> {
  const headers = req.headers ?? {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const timeout = req.timeoutMs ?? 120_000;

  try {
    if (req.signal?.aborted) throw new ConnRequestAbortedError();
    const body = serializeBody(req.body);
    const nativeFetch = nativeFetchRequest<T>(conn, {
      method: req.method,
      url: req.url,
      headers,
      body,
      timeoutMs: timeout,
      signal: req.signal,
    });
    if (nativeFetch) return await nativeFetch;

    const request = conn.request<T>({
      method: req.method,
      url: req.url,
      headers,
      body,
      timeout,
    } as Parameters<typeof conn.request>[0]);
    const responseBody = await boundedConnRequest(request, timeout, req.signal);
    return { status: 200, body: responseBody };
  } catch (err) {
    return { status: inferStatus(err), body: errorAsBody(err) as T };
  }
}

interface NativeFetchRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

function nativeFetchRequest<T>(
  conn: Connection,
  req: NativeFetchRequest,
): Promise<ConnResponse<T>> | undefined {
  const accessToken = getAccessToken(conn);
  const instanceUrl = conn.instanceUrl;
  if (!accessToken || !instanceUrl) return undefined;

  return boundedNativeFetch<T>(absoluteUrl(instanceUrl, req.url), {
    ...req,
    headers: { ...req.headers, Authorization: `Bearer ${accessToken}` },
  });
}

function getAccessToken(conn: Connection): string | undefined {
  return (
    (conn as unknown as { accessToken?: string }).accessToken ??
    (conn.getConnectionOptions?.() as { accessToken?: string } | undefined)?.accessToken
  );
}

function absoluteUrl(instanceUrl: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${instanceUrl.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}

async function boundedNativeFetch<T>(
  url: string,
  req: NativeFetchRequest,
): Promise<ConnResponse<T>> {
  if (req.signal?.aborted) throw new ConnRequestAbortedError();

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = (): void => controller.abort();
  req.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, req.timeoutMs);

  try {
    const resp = await fetch(url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
    return { status: resp.status, body: (await parseFetchBody(resp)) as T };
  } catch (err) {
    if (req.signal?.aborted) throw new ConnRequestAbortedError();
    if (timedOut) throw new ConnRequestTimeoutError(req.timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function parseFetchBody(resp: Response): Promise<unknown> {
  const text = await resp.text();
  if (!text) return undefined;
  const contentType = resp.headers.get("content-type") ?? "";
  if (contentType.includes("json") || /^[[{]/.test(text.trim())) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export class ConnRequestTimeoutError extends Error {
  readonly statusCode = 408;
  readonly errorCode = "REQUEST_TIMEOUT";
  readonly timedOutAfterMs: number;

  constructor(timeoutMs: number) {
    super(`conn.request timed out after ${timeoutMs}ms.`);
    this.name = "ConnRequestTimeoutError";
    this.timedOutAfterMs = timeoutMs;
  }
}

export class ConnRequestAbortedError extends Error {
  readonly statusCode = 499;
  readonly errorCode = "REQUEST_ABORTED";

  constructor() {
    super("conn.request aborted.");
    this.name = "ConnRequestAbortedError";
  }
}

async function boundedConnRequest<T>(
  request: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal?.aborted) throw new ConnRequestAbortedError();

  let timer: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ConnRequestTimeoutError(timeoutMs)), timeoutMs);
  });
  const abort = signal
    ? new Promise<T>((_resolve, reject) => {
        abortHandler = () => reject(new ConnRequestAbortedError());
        signal.addEventListener("abort", abortHandler, { once: true });
      })
    : undefined;

  try {
    return await Promise.race(abort ? [request, timeout, abort] : [request, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
  }
}

/**
 * Serialize a request body for jsforce's HTTP transport.
 *
 * jsforce sends `request.body` to the wire as-is — it does not re-stringify.
 * That makes the rule simple: if the caller already gave us a string, trust
 * it and pass it through; otherwise JSON-encode the value.
 *
 * Why not always JSON.stringify? Because some callers (most often LLM tool
 * inputs declared as `Type.Any()`) hand us a body that's already a JSON
 * string. `JSON.stringify('{"sql":"SELECT 1"}')` produces
 * `'"{\\"sql\\":\\"SELECT 1\\"}"'` and the server returns
 * `JSON_PARSER_ERROR: Value does not match expected type`.
 */
export function serializeBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

/**
 * Pull an HTTP status code out of whatever jsforce/Connection threw.
 *
 * Status sometimes lives on `statusCode`, sometimes embedded in the message
 * (`"Error 404: …"`), sometimes nowhere. Mirrors the equivalent in
 * `extensions/sf-agentscript/lib/eval/sfap.ts` so the two wrappers behave
 * the same way.
 */
function inferStatus(err: unknown): number {
  const e = err as Record<string, unknown> | null;
  if (!e || typeof e !== "object") return 500;

  const direct = e.statusCode;
  if (typeof direct === "number" && direct >= 100 && direct < 600) return direct;

  const message = typeof e.message === "string" ? e.message : "";
  const errorCode = typeof e.errorCode === "string" ? e.errorCode : "";
  const name = typeof e.name === "string" ? e.name : "";

  // jsforce often surfaces Salesforce REST errors with an `errorCode`/`name`
  // string and no numeric status (e.g. `errorCode: "NOT_FOUND"`,
  // `name: "NOT_FOUND"`, message: "The requested resource does not exist").
  // Map the common ones so callers see the right status without parsing the
  // error body separately.
  const codeStatus =
    SALESFORCE_ERROR_CODE_TO_STATUS[errorCode] ?? SALESFORCE_ERROR_CODE_TO_STATUS[name];
  if (codeStatus) return codeStatus;

  const blob = `${message} ${errorCode} ${name}`;
  const match = /\b(\d{3})\b/.exec(blob);
  if (match) {
    const n = parseInt(match[1], 10);
    if (n >= 100 && n < 600) return n;
  }

  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i.test(blob)) return 503;
  if (/auth|token|expired|refresh|unauthorized/i.test(blob)) return 401;

  return 500;
}

/**
 * Subset of Salesforce REST/SFDC error codes worth mapping to an HTTP status.
 * Kept narrow on purpose — only codes where the mapping is unambiguous and
 * useful for callers that branch on `status`.
 */
const SALESFORCE_ERROR_CODE_TO_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  ENTITY_IS_DELETED: 404,
  INVALID_SESSION_ID: 401,
  INVALID_LOGIN: 401,
  INVALID_GRANT: 401,
  REQUEST_LIMIT_EXCEEDED: 429,
  RATE_LIMIT_EXCEEDED: 429,
  SERVER_UNAVAILABLE: 503,
  FUNCTIONALITY_NOT_ENABLED: 403,
  INSUFFICIENT_ACCESS: 403,
  INSUFFICIENT_ACCESS_OR_READONLY: 403,
};

function errorAsBody(err: unknown): unknown {
  const e = err as Record<string, unknown> | null;
  if (!e) return {};
  return {
    errorCode: e.errorCode,
    message: e.message,
    name: e.name,
    statusCode: e.statusCode,
  };
}
