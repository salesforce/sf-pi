/* SPDX-License-Identifier: Apache-2.0 */
/** Native Salesforce API helpers for sf-apex. */

import type { Connection } from "@salesforce/core";
import { connFromAlias, resolveOrgIdentity } from "../../../lib/common/sf-conn/connection.ts";
import { connRequest, type HttpMethod } from "../../../lib/common/sf-conn/request.ts";

const APEX_CONNECTION_TIMEOUT_MS = 30_000;

export async function apexConnection(
  targetOrg?: string,
  signal?: AbortSignal,
): Promise<Connection> {
  return connFromAlias(targetOrg, { timeoutMs: APEX_CONNECTION_TIMEOUT_MS, signal });
}

export function apiVersion(conn: Connection): string {
  const value =
    (conn as unknown as { getApiVersion?: () => string; version?: string }).getApiVersion?.() ??
    (conn as unknown as { version?: string }).version ??
    "67.0";
  return String(value).replace(/^v/, "");
}

export async function requestJson<T>(
  conn: Connection,
  method: HttpMethod,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await connRequest<T>(conn, { method, url, body, headers, timeoutMs: 120_000 });
  if (response.status >= 400) {
    throw new Error(
      `Salesforce API ${method} ${url} failed (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }
  return response.body;
}

export async function requestText(
  conn: Connection,
  method: HttpMethod,
  url: string,
  body?: unknown,
  headers: Record<string, string> = { Accept: "text/plain" },
): Promise<string> {
  const response = await connRequest<string>(conn, {
    method,
    url,
    body,
    headers,
    timeoutMs: 120_000,
  });
  if (response.status >= 400) {
    throw new Error(
      `Salesforce API ${method} ${url} failed (${response.status}): ${String(response.body)}`,
    );
  }
  return String(response.body ?? "");
}

export async function toolingQuery<T extends Record<string, unknown>>(
  conn: Connection,
  soql: string,
): Promise<{ totalSize: number; records: T[]; done?: boolean; nextRecordsUrl?: string }> {
  const v = apiVersion(conn);
  const encoded = encodeURIComponent(soql);
  const result = await requestJson<{
    totalSize: number;
    records: T[];
    done?: boolean;
    nextRecordsUrl?: string;
  }>(conn, "GET", `/services/data/v${v}/tooling/query/?q=${encoded}`);
  return result;
}

export async function toolingQueryAll<T extends Record<string, unknown>>(
  conn: Connection,
  soql: string,
): Promise<{ totalSize: number; records: T[] }> {
  let page = await toolingQuery<T>(conn, soql);
  const records = [...page.records];
  while (page.done === false && page.nextRecordsUrl) {
    page = await requestJson<{
      totalSize: number;
      records: T[];
      done?: boolean;
      nextRecordsUrl?: string;
    }>(conn, "GET", page.nextRecordsUrl);
    records.push(...page.records);
  }
  return { totalSize: records.length, records };
}

export async function currentUserId(conn: Connection): Promise<string> {
  return (await resolveOrgIdentity(conn, { timeoutMs: 30_000 })).user_id;
}

export async function createTooling<T>(
  conn: Connection,
  objectName: string,
  body: unknown,
): Promise<T> {
  return requestJson<T>(
    conn,
    "POST",
    `/services/data/v${apiVersion(conn)}/tooling/sobjects/${objectName}`,
    body,
  );
}

export async function patchTooling(
  conn: Connection,
  objectName: string,
  id: string,
  body: unknown,
): Promise<void> {
  await requestJson(
    conn,
    "PATCH",
    `/services/data/v${apiVersion(conn)}/tooling/sobjects/${objectName}/${id}`,
    body,
  );
}

export async function deleteTooling(
  conn: Connection,
  objectName: string,
  id: string,
): Promise<void> {
  await requestJson(
    conn,
    "DELETE",
    `/services/data/v${apiVersion(conn)}/tooling/sobjects/${objectName}/${id}`,
  );
}
