/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Bounded Salesforce REST helpers for sf-agentscript.
 *
 * Auth still comes from @salesforce/core Connection / sf CLI auth state. This
 * module only owns the HTTP transport for timeout-sensitive read-only calls so
 * a jsforce request/query hang cannot block Agent Script workflows forever.
 */

import type { Connection } from "@salesforce/core";

export const DEFAULT_BOUNDED_LOOKUP_TIMEOUT_MS = 10_000;

export class BoundedOperationTimeoutError extends Error {
  readonly timedOutAfterMs: number;

  constructor(message: string, timedOutAfterMs: number) {
    super(message);
    this.name = "BoundedOperationTimeoutError";
    this.timedOutAfterMs = timedOutAfterMs;
  }
}

export async function boundedPromise<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = DEFAULT_BOUNDED_LOOKUP_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new BoundedOperationTimeoutError(
                `${label} timed out after ${timeoutMs}ms.`,
                timeoutMs,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function boundedLegacyPromise<T>(
  factory: () => Promise<T>,
  label: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new Error(`${label} aborted before it started.`);

  let timer: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;
  try {
    return await Promise.race([
      factory(),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new BoundedOperationTimeoutError(
                `${label} timed out after ${timeoutMs}ms.`,
                timeoutMs,
              ),
            ),
          timeoutMs,
        );
        if (signal) {
          abortHandler = () => reject(new Error(`${label} aborted.`));
          signal.addEventListener("abort", abortHandler, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

export type BoundedRequestFailureReason =
  | "missing_connection_fields"
  | "timeout"
  | "aborted"
  | "http_error"
  | "request_failed"
  | "parse_failed";

export type BoundedSoqlFailureReason = BoundedRequestFailureReason;

export type BoundedSoqlResult<T> =
  | { ok: true; records: T[]; totalSize: number }
  | {
      ok: false;
      reason: BoundedSoqlFailureReason;
      detail: string;
      status?: number;
      timed_out_after_ms?: number;
    };

export interface BoundedRequestOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface BoundedSoqlOptions extends BoundedRequestOptions {
  api?: "data" | "tooling";
}

interface ConnectionAuthShape {
  instanceUrl?: string;
  accessToken?: string;
  apiVersion: string;
}

function getConnectionAuthShape(conn: Connection): ConnectionAuthShape {
  const opts = conn.getConnectionOptions?.() as
    { instanceUrl?: string; accessToken?: string } | undefined;
  let apiVersion = "67.0";
  try {
    apiVersion = conn.getApiVersion?.() ?? apiVersion;
  } catch {
    /* best-effort */
  }
  return {
    instanceUrl: conn.instanceUrl ?? opts?.instanceUrl,
    accessToken: (conn as unknown as { accessToken?: string }).accessToken ?? opts?.accessToken,
    apiVersion,
  };
}

export type BoundedRestResult<T> =
  | { ok: true; status: number; body: T }
  | {
      ok: false;
      reason: BoundedRequestFailureReason;
      detail: string;
      status?: number;
      body?: unknown;
      timed_out_after_ms?: number;
    };

function serializeBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

function restPath(apiVersion: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  if (path.startsWith("/services/data/")) return path;
  return `/services/data/v${apiVersion}${path}`;
}

export async function boundedRestRequest<T>(
  conn: Connection,
  pathOrUrl: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  opts: BoundedRequestOptions = {},
): Promise<BoundedRestResult<T>> {
  const { instanceUrl, accessToken, apiVersion } = getConnectionAuthShape(conn);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BOUNDED_LOOKUP_TIMEOUT_MS;
  if (!accessToken) {
    if (opts.signal?.aborted) {
      return {
        ok: false,
        reason: "aborted",
        detail: "Salesforce request aborted before it started.",
      };
    }
    try {
      const body = (await boundedLegacyPromise(
        () =>
          conn.request({
            method,
            url: pathOrUrl,
            headers: opts.headers,
            body: serializeBody(opts.body),
          } as Parameters<typeof conn.request>[0]) as Promise<T>,
        "Salesforce request",
        timeoutMs,
        opts.signal,
      )) as T;
      return { ok: true, status: 200, body };
    } catch (err) {
      if (opts.signal?.aborted) {
        return { ok: false, reason: "aborted", detail: "Salesforce request aborted." };
      }
      if (err instanceof BoundedOperationTimeoutError) {
        return {
          ok: false,
          reason: "timeout",
          timed_out_after_ms: err.timedOutAfterMs,
          detail: err.message,
        };
      }
      return {
        ok: false,
        reason: "request_failed",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
  if (!instanceUrl) {
    return {
      ok: false,
      reason: "missing_connection_fields",
      detail: "Connection is missing instanceUrl.",
    };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = (): void => controller.abort();
  if (opts.signal?.aborted) {
    return {
      ok: false,
      reason: "aborted",
      detail: "Salesforce request aborted before it started.",
    };
  }
  opts.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const base = instanceUrl.endsWith("/") ? instanceUrl.slice(0, -1) : instanceUrl;
    const path = restPath(apiVersion, pathOrUrl);
    const url = /^https?:\/\//i.test(path) ? path : `${base}${path}`;
    const resp = await fetchImpl(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(opts.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
      },
      body: serializeBody(opts.body),
      signal: controller.signal,
    });
    const text = await resp.text();
    let body: unknown = text;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } else {
      body = {};
    }
    if (!resp.ok) {
      return {
        ok: false,
        reason: "http_error",
        status: resp.status,
        body,
        detail: `Salesforce request returned HTTP ${resp.status}.`,
      };
    }
    return { ok: true, status: resp.status, body: body as T };
  } catch (err) {
    if (opts.signal?.aborted) {
      return { ok: false, reason: "aborted", detail: "Salesforce request aborted." };
    }
    if (timedOut) {
      return {
        ok: false,
        reason: "timeout",
        timed_out_after_ms: timeoutMs,
        detail: `Salesforce request timed out after ${timeoutMs}ms.`,
      };
    }
    return {
      ok: false,
      reason: "request_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function boundedSoqlQuery<T>(
  conn: Connection,
  soql: string,
  opts: BoundedSoqlOptions = {},
): Promise<BoundedSoqlResult<T>> {
  const { instanceUrl, accessToken, apiVersion } = getConnectionAuthShape(conn);
  const apiPath = opts.api === "tooling" ? "tooling/query" : "query";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BOUNDED_LOOKUP_TIMEOUT_MS;
  if (!accessToken) {
    // Legacy unit-test seam: older tests provide tokenless fake Connections
    // that implement query() or request(). Real org connections should take
    // the bounded fetch path below.
    if (opts.signal?.aborted) {
      return {
        ok: false,
        reason: "aborted",
        detail: "Salesforce query aborted before it started.",
      };
    }
    try {
      const query = (conn as unknown as { query?: (q: string) => Promise<unknown> }).query;
      const body = (await boundedLegacyPromise(
        () =>
          query
            ? query(soql)
            : (conn.request({
                method: "GET",
                url: `/${apiPath}?q=${encodeURIComponent(soql)}`,
              } as Parameters<typeof conn.request>[0]) as Promise<unknown>),
        "Salesforce query",
        timeoutMs,
        opts.signal,
      )) as { records?: T[]; totalSize?: number };
      return {
        ok: true,
        records: body.records ?? [],
        totalSize:
          typeof body.totalSize === "number" ? body.totalSize : (body.records ?? []).length,
      };
    } catch (err) {
      if (opts.signal?.aborted) {
        return { ok: false, reason: "aborted", detail: "Salesforce query aborted." };
      }
      if (err instanceof BoundedOperationTimeoutError) {
        return {
          ok: false,
          reason: "timeout",
          timed_out_after_ms: err.timedOutAfterMs,
          detail: err.message,
        };
      }
      return {
        ok: false,
        reason: "request_failed",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
  if (!instanceUrl) {
    return {
      ok: false,
      reason: "missing_connection_fields",
      detail: "Connection is missing instanceUrl.",
    };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = (): void => controller.abort();
  if (opts.signal?.aborted) {
    return {
      ok: false,
      reason: "aborted",
      detail: "Salesforce query aborted before it started.",
    };
  }
  opts.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const base = instanceUrl.endsWith("/") ? instanceUrl.slice(0, -1) : instanceUrl;
    const url = `${base}/services/data/v${apiVersion}/${apiPath}?q=${encodeURIComponent(soql)}`;
    const resp = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!resp.ok) {
      return {
        ok: false,
        reason: "http_error",
        status: resp.status,
        detail: `Salesforce query returned HTTP ${resp.status}.`,
      };
    }
    let body: unknown;
    try {
      body = await resp.json();
    } catch (err) {
      return {
        ok: false,
        reason: "parse_failed",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    const records = (body as { records?: unknown[] }).records;
    const totalSize = (body as { totalSize?: unknown }).totalSize;
    if (!Array.isArray(records)) {
      return {
        ok: false,
        reason: "parse_failed",
        detail: "Salesforce query response did not include a records array.",
      };
    }
    return {
      ok: true,
      records: records as T[],
      totalSize: typeof totalSize === "number" ? totalSize : records.length,
    };
  } catch (err) {
    if (opts.signal?.aborted) {
      return {
        ok: false,
        reason: "aborted",
        detail: "Salesforce query aborted.",
      };
    }
    if (timedOut) {
      return {
        ok: false,
        reason: "timeout",
        timed_out_after_ms: timeoutMs,
        detail: `Salesforce query timed out after ${timeoutMs}ms.`,
      };
    }
    return {
      ok: false,
      reason: "request_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", abortFromCaller);
  }
}
