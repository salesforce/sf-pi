/* SPDX-License-Identifier: Apache-2.0 */
/** SF Apex domain helpers over the shared Salesforce Connection Module. */

import type { HttpMethod, SalesforceSession } from "../../../lib/common/sf-conn/index.ts";

const APEX_CONNECTION_TIMEOUT_MS = 30_000;
const APEX_REQUEST_TIMEOUT_MS = 120_000;
const MAX_TOOLING_QUERY_ROWS = 50_000;

export type ApexConnection = SalesforceSession;

export function apiVersion(sf: ApexConnection): string {
  return sf.target.apiVersion;
}

export async function requestJson<T>(
  sf: ApexConnection,
  method: HttpMethod,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
  continuation = false,
): Promise<T> {
  const input = {
    method,
    path,
    body,
    headers,
    timeoutMs: APEX_REQUEST_TIMEOUT_MS,
  };
  const response = continuation ? await sf.continueRequest<T>(input) : await sf.request<T>(input);
  if (response.status >= 400) {
    throw new Error(
      `Salesforce API ${method} ${response.path.split("?", 1)[0]} failed (${response.status}).`,
    );
  }
  return response.body;
}

export async function requestText(
  sf: ApexConnection,
  method: HttpMethod,
  path: string,
  body?: unknown,
  headers: Record<string, string> = { Accept: "text/plain" },
): Promise<string> {
  const response = await sf.request<string>({
    method,
    scope: path.startsWith("/services/Soap/") ? "instance" : "data",
    path,
    body,
    headers,
    timeoutMs: APEX_REQUEST_TIMEOUT_MS,
  });
  if (response.status >= 400) {
    throw new Error(
      `Salesforce API ${method} ${response.path.split("?", 1)[0]} failed (${response.status}).`,
    );
  }
  return String(response.body ?? "");
}

export async function toolingQuery<T extends Record<string, unknown>>(
  sf: ApexConnection,
  soql: string,
): Promise<{ totalSize: number; records: T[]; done?: boolean; nextRecordsUrl?: string }> {
  const result = await sf.query<T>({
    soql,
    api: "tooling",
    maxRows: MAX_TOOLING_QUERY_ROWS,
    timeoutMs: APEX_REQUEST_TIMEOUT_MS,
  });
  if (result.truncated) {
    throw new Error(`Apex Tooling query exceeded ${MAX_TOOLING_QUERY_ROWS} rows.`);
  }
  return {
    totalSize: result.totalSize ?? result.records.length,
    records: result.records,
    done: result.done,
    nextRecordsUrl: result.nextRecordsUrl,
  };
}

export async function toolingQueryAll<T extends Record<string, unknown>>(
  sf: ApexConnection,
  soql: string,
): Promise<{ totalSize: number; records: T[] }> {
  const result = await toolingQuery<T>(sf, soql);
  return { totalSize: result.records.length, records: result.records };
}

export async function currentUserId(sf: ApexConnection): Promise<string> {
  return (await sf.identity({ timeoutMs: APEX_CONNECTION_TIMEOUT_MS })).user_id;
}

export async function createTooling<T>(
  sf: ApexConnection,
  objectName: string,
  body: unknown,
): Promise<T> {
  return requestJson<T>(sf, "POST", `/tooling/sobjects/${encodeURIComponent(objectName)}`, body);
}

export async function patchTooling(
  sf: ApexConnection,
  objectName: string,
  id: string,
  body: unknown,
): Promise<void> {
  await requestJson(
    sf,
    "PATCH",
    `/tooling/sobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(id)}`,
    body,
  );
}

export async function deleteTooling(
  sf: ApexConnection,
  objectName: string,
  id: string,
): Promise<void> {
  await requestJson(
    sf,
    "DELETE",
    `/tooling/sobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(id)}`,
  );
}
