/* SPDX-License-Identifier: Apache-2.0 */
/** Direct Data 360 Query API V3 transport. */
import type { Connection } from "@salesforce/core";
import { getSalesforceConnectionAccessToken } from "../../../lib/common/sf-conn/auth-refresh.ts";
import { connectSalesforce } from "../../../lib/common/sf-conn/index.ts";
import type { SfData360Input } from "./actions/action-types.ts";
import { getData360TenantTokenSession } from "./actions/ingest/auth.ts";

interface TenantToken {
  accessToken: string;
  instanceUrl: string;
  expiresAt: number;
}
const tokenCache = new WeakMap<Connection, Promise<TenantToken>>();

export function isQueryV3Action(action: string): boolean {
  return [
    "query.sql.run",
    "query.sql.status",
    "query.sql.rows",
    "query.sql.metadata",
    "query.sql.chunk",
    "query.sql.cancel",
  ].includes(action);
}

export async function runDirectData360Request(
  input: SfData360Input,
  cwd: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const params = input.params ?? {};
  const apiFamily = requiredString(params.api_family, "api_family");
  if (!["query", "ingestion"].includes(apiFamily)) {
    throw new Error("Direct api.request supports api_family=query or ingestion.");
  }
  const method = requiredString(params.method, "method").toUpperCase();
  if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) {
    throw new Error(`Unsupported direct API method '${method}'.`);
  }
  const path = requiredString(params.path, "path");
  if (!path.startsWith("/api/") || path.includes("://")) {
    throw new Error("Direct Data 360 paths must be relative /api/* resources.");
  }
  const session = await connectSalesforce({
    cwd,
    targetOrg: input.target_org,
    timeoutMs: input.timeout_ms,
    signal,
  });
  const request = { method, path, query: objectValue(params.query), body: params.body };
  if (input.dry_run) {
    return {
      ok: true,
      tool: "sf_data360",
      action: "api.request",
      namespace: "api",
      transport: apiFamily === "query" ? "query-v3" : "ingestion",
      dryRun: true,
      targetOrg: session.target.targetOrg,
      apiFamily,
      request,
      summary: `Resolved Data 360 Direct API ${method} ${path}`,
    };
  }
  if (method !== "GET" && input.allow_mutation !== true) {
    return {
      ok: false,
      tool: "sf_data360",
      action: "api.request",
      namespace: "api",
      transport: apiFamily === "query" ? "query-v3" : "ingestion",
      error: "CONFIRMATION_REQUIRED",
      summary: "Direct non-GET requests require dry_run review and allow_mutation=true.",
    };
  }
  const token = await resolveTenantToken(
    input,
    session.connection,
    fetchFn,
    signal,
    session.target.targetOrg,
  );
  const url = new URL(path, ensureTrailingSlash(token.instanceUrl));
  for (const [key, value] of Object.entries(objectValue(params.query))) {
    if (["string", "number", "boolean"].includes(typeof value)) {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetchFn(url, {
    method,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: "application/json",
      ...(params.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
    signal,
  });
  return {
    ok: response.ok,
    tool: "sf_data360",
    action: "api.request",
    namespace: "api",
    transport: apiFamily === "query" ? "query-v3" : "ingestion",
    targetOrg: session.target.targetOrg,
    apiFamily,
    status: response.status,
    instanceUrl: token.instanceUrl,
    request: { ...request, url: url.toString() },
    response: await parseBody(response),
    summary: `Data 360 Direct API ${method} ${path} HTTP ${response.status}`,
  };
}

export async function runQueryV3(
  input: SfData360Input,
  cwd: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const session = await connectSalesforce({
    cwd,
    targetOrg: input.target_org,
    timeoutMs: input.timeout_ms,
    signal,
  });
  const request = queryRequest(input);
  if (input.action === "query.sql.cancel" && !input.dry_run && input.allow_mutation !== true) {
    return {
      ok: false,
      tool: "sf_data360",
      action: input.action,
      namespace: "query",
      transport: "query-v3",
      targetOrg: session.target.targetOrg,
      error: "CONFIRMATION_REQUIRED",
      summary: "Query cancellation requires dry_run review and allow_mutation=true.",
    };
  }
  if (input.dry_run) {
    return {
      ok: true,
      tool: "sf_data360",
      action: input.action,
      namespace: "query",
      transport: "query-v3",
      dryRun: true,
      targetOrg: session.target.targetOrg,
      apiVersion: "3",
      request,
      summary: `Resolved Query API V3 ${request.method} ${request.path}`,
    };
  }
  const token = await resolveTenantToken(
    input,
    session.connection,
    fetchFn,
    signal,
    session.target.targetOrg,
  );
  const url = new URL(request.path, ensureTrailingSlash(token.instanceUrl));
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetchFn(url, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: "application/json",
      ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    signal,
  });
  const body = await parseBody(response);
  const hyperdbStatus = parseStatusHeader(response.headers.get("x-hyperdb-status"));
  return {
    ok: response.ok,
    tool: "sf_data360",
    action: input.action,
    namespace: "query",
    transport: "query-v3",
    targetOrg: session.target.targetOrg,
    apiVersion: "3",
    status: response.status,
    instanceUrl: token.instanceUrl,
    request: { ...request, url: url.toString() },
    response: body,
    ...(hyperdbStatus ? { queryStatus: hyperdbStatus } : {}),
    summary: `Query API V3 ${request.method} ${request.path} HTTP ${response.status}`,
  };
}

function queryRequest(input: SfData360Input): {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number>;
  body?: Record<string, unknown>;
} {
  const params = input.params ?? {};
  if (input.action === "query.sql.run") {
    const nested = objectValue(params.input);
    const sql = requiredString(nested.sql ?? params.sql, "sql");
    const body = compact({
      sql,
      transferMode: nested.transferMode ?? params.transferMode ?? "ADAPTIVE",
      paramStyle: nested.paramStyle ?? params.paramStyle,
      parameters: nested.parameters ?? params.parameters,
      settings: nested.settings ?? params.settings,
      resultRange: nested.resultRange ?? params.resultRange,
      queryRowLimit: nested.queryRowLimit ?? params.queryRowLimit,
    });
    return { method: "POST", path: "/api/v3/query", body };
  }
  const queryId = encodeURIComponent(requiredString(params.queryId, "queryId"));
  if (input.action === "query.sql.status") {
    return { method: "GET", path: `/api/v3/query/${queryId}` };
  }
  if (input.action === "query.sql.rows") {
    return {
      method: "GET",
      path: `/api/v3/query/${queryId}/rows`,
      query: compactQuery({
        offset: numberValue(params.offset),
        limit: numberValue(params.limit),
        byteLimit: numberValue(params.byteLimit),
      }),
    };
  }
  if (input.action === "query.sql.metadata") {
    return { method: "GET", path: `/api/v3/query/${queryId}/metadata` };
  }
  if (input.action === "query.sql.chunk") {
    const chunkId = encodeURIComponent(requiredString(params.chunkId, "chunkId"));
    return { method: "GET", path: `/api/v3/query/${queryId}/chunks/${chunkId}` };
  }
  return { method: "DELETE", path: `/api/v3/query/${queryId}` };
}

async function resolveTenantToken(
  input: SfData360Input,
  connection: Connection,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
  targetOrg?: string,
): Promise<TenantToken> {
  const authSessionId =
    typeof input.params?.authSessionId === "string" ? input.params.authSessionId : undefined;
  const configuredSession = getData360TenantTokenSession(authSessionId, targetOrg);
  return configuredSession
    ? {
        accessToken: configuredSession.accessToken,
        instanceUrl: `https://${configuredSession.tenantHost}`,
        expiresAt: configuredSession.expiresAt ?? Date.now() + 60_000,
      }
    : getTenantToken(connection, fetchFn, signal);
}

async function getTenantToken(
  connection: Connection,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<TenantToken> {
  let pending = tokenCache.get(connection);
  if (!pending) {
    pending = exchangeTenantToken(connection, fetchFn, signal).catch((error) => {
      tokenCache.delete(connection);
      throw error;
    });
    tokenCache.set(connection, pending);
  }
  const token = await pending;
  if (token.expiresAt <= Date.now() + 30_000) {
    tokenCache.delete(connection);
    return getTenantToken(connection, fetchFn, signal);
  }
  return token;
}

async function exchangeTenantToken(
  connection: Connection,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<TenantToken> {
  const coreToken = getSalesforceConnectionAccessToken(connection);
  if (!coreToken || !connection.instanceUrl) {
    throw new Error("The Salesforce connection cannot authorize Data 360 Direct API access.");
  }
  const body = new URLSearchParams({
    grant_type: "urn:salesforce:grant-type:external:cdp",
    subject_token: coreToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
  });
  const response = await fetchFn(`${connection.instanceUrl}/services/a360/token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${coreToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal,
  });
  const json = objectValue(await parseBody(response));
  if (!response.ok) {
    const detail = [json.error, json.error_description]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .join(": ");
    throw new Error(
      `Data 360 token exchange failed HTTP ${response.status}${detail ? `: ${detail}` : ""}.`,
    );
  }
  const instanceUrl = requiredString(json.instance_url, "Data 360 instance_url");
  assertTenantUrl(instanceUrl);
  const expiresIn = numberValue(json.expires_in) ?? 3600;
  return {
    accessToken: requiredString(json.access_token, "Data 360 access_token"),
    instanceUrl,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

function assertTenantUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".c360a.salesforce.com")) {
    throw new Error("Data 360 Direct API returned an untrusted tenant endpoint.");
  }
}
async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
function parseStatusHeader(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Missing required parameter '${label}'.`);
  return value.trim();
}
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
function compactQuery(
  value: Record<string, number | undefined>,
): Record<string, string | number> | undefined {
  const compacted = Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Record<string, number>;
  return Object.keys(compacted).length ? compacted : undefined;
}
function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
