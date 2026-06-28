/* SPDX-License-Identifier: Apache-2.0 */
/** Native Salesforce API helpers for sf-soql. */

import type { Connection } from "@salesforce/core";
import { connFromAlias, resolveOrgIdentity } from "../../../lib/common/sf-conn/connection.ts";
import { connRequest, type HttpMethod } from "../../../lib/common/sf-conn/request.ts";
import type {
  SalesforceQueryResult,
  SalesforceSearchResult,
  SObjectDescribe,
  SoqlApiMode,
  SoqlApiCallRailItem,
} from "./types.ts";

const SOQL_CONNECTION_TIMEOUT_MS = 90_000;
const SOQL_REQUEST_TIMEOUT_MS = 120_000;

export async function soqlConnection(
  targetOrg?: string,
  signal?: AbortSignal,
): Promise<Connection> {
  return connFromAlias(targetOrg, { timeoutMs: SOQL_CONNECTION_TIMEOUT_MS, signal });
}

export function apiVersion(conn: Connection): string {
  const value =
    (conn as unknown as { getApiVersion?: () => string; version?: string }).getApiVersion?.() ??
    (conn as unknown as { version?: string }).version ??
    "67.0";
  return String(value).replace(/^v/, "");
}

export function orgAlias(conn: Connection, fallback?: string): string | undefined {
  return (
    fallback ??
    (conn as unknown as { getUsername?: () => string }).getUsername?.() ??
    (conn as unknown as { username?: string }).username
  );
}

export async function currentUserId(conn: Connection): Promise<string | undefined> {
  try {
    return (await resolveOrgIdentity(conn, { timeoutMs: SOQL_CONNECTION_TIMEOUT_MS })).user_id;
  } catch {
    return undefined;
  }
}

export async function requestJson<T>(
  conn: Connection,
  method: HttpMethod,
  url: string,
  body?: unknown,
): Promise<T> {
  const response = await connRequest<T>(conn, {
    method,
    url,
    body,
    timeoutMs: SOQL_REQUEST_TIMEOUT_MS,
  });
  if (response.status >= 400) {
    throw new Error(
      `Salesforce API ${method} ${url} failed (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }
  return response.body;
}

export async function restQuery(
  conn: Connection,
  query: string,
  mode: SoqlApiMode,
  maxRows: number,
): Promise<SalesforceQueryResult> {
  const records: SalesforceQueryResult["records"] = [];
  let first = await queryOnce(conn, query, mode);
  records.push(...first.records.slice(0, maxRows));
  while (!first.done && first.nextRecordsUrl && records.length < maxRows) {
    first = await requestJson<SalesforceQueryResult>(conn, "GET", first.nextRecordsUrl);
    records.push(...first.records.slice(0, Math.max(0, maxRows - records.length)));
  }
  return { ...first, records, done: first.done };
}

async function queryOnce(
  conn: Connection,
  query: string,
  mode: SoqlApiMode,
): Promise<SalesforceQueryResult> {
  const encoded = encodeURIComponent(query);
  const prefix = mode === "tooling" ? "/tooling" : "";
  return requestJson<SalesforceQueryResult>(
    conn,
    "GET",
    `/services/data/v${apiVersion(conn)}${prefix}/query/?q=${encoded}`,
  );
}

export async function queryAll(
  conn: Connection,
  query: string,
  maxRows: number,
): Promise<SalesforceQueryResult> {
  const records: SalesforceQueryResult["records"] = [];
  let page = await requestJson<SalesforceQueryResult>(
    conn,
    "GET",
    `/services/data/v${apiVersion(conn)}/queryAll/?q=${encodeURIComponent(query)}`,
  );
  records.push(...page.records.slice(0, maxRows));
  while (!page.done && page.nextRecordsUrl && records.length < maxRows) {
    page = await requestJson<SalesforceQueryResult>(conn, "GET", page.nextRecordsUrl);
    records.push(...page.records.slice(0, Math.max(0, maxRows - records.length)));
  }
  return { ...page, records, done: page.done };
}

export interface QueryPlanResponse {
  plans?: Array<{
    cardinality?: number;
    fields?: string[];
    leadingOperationType?: string;
    notes?: Array<{ description?: string; fields?: string[]; tableEnumOrId?: string }>;
    relativeCost?: number;
    sobjectCardinality?: number;
    sobjectType?: string;
  }>;
}

export async function explainQuery(conn: Connection, query: string): Promise<QueryPlanResponse> {
  return requestJson<QueryPlanResponse>(
    conn,
    "GET",
    `/services/data/v${apiVersion(conn)}/query?explain=${encodeURIComponent(query)}`,
  );
}

export async function describeSObject(
  conn: Connection,
  objectName: string,
): Promise<SObjectDescribe> {
  return requestJson<SObjectDescribe>(
    conn,
    "GET",
    `/services/data/v${apiVersion(conn)}/sobjects/${encodeURIComponent(objectName)}/describe`,
  );
}

export async function soslSearch(conn: Connection, sosl: string): Promise<SalesforceSearchResult> {
  return requestJson<SalesforceSearchResult>(
    conn,
    "GET",
    `/services/data/v${apiVersion(conn)}/search/?q=${encodeURIComponent(sosl)}`,
  );
}

export async function orgLimits(conn: Connection): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>(
    conn,
    "GET",
    `/services/data/v${apiVersion(conn)}/limits`,
  );
}

export async function listSObjects(conn: Connection): Promise<{
  sobjects?: Array<{
    name: string;
    label?: string;
    labelPlural?: string;
    queryable?: boolean;
    searchable?: boolean;
  }>;
}> {
  return requestJson<{
    sobjects?: Array<{
      name: string;
      label?: string;
      labelPlural?: string;
      queryable?: boolean;
      searchable?: boolean;
    }>;
  }>(conn, "GET", `/services/data/v${apiVersion(conn)}/sobjects`);
}

export function apiCall(method: string, path: string, detail?: string): SoqlApiCallRailItem {
  return { method, path, detail };
}
