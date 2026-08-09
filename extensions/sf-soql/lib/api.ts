/* SPDX-License-Identifier: Apache-2.0 */
/** SF SOQL domain helpers over the shared Salesforce Connection Module. */

import type {
  HttpMethod,
  SalesforceSession,
  SalesforceQueryResult as SharedQueryResult,
} from "../../../lib/common/sf-conn/index.ts";
import type {
  SalesforceQueryResult,
  SalesforceSearchResult,
  SObjectDescribe,
  SoqlApiMode,
  SoqlApiCallRailItem,
} from "./types.ts";

const SOQL_CONNECTION_TIMEOUT_MS = 90_000;
const SOQL_REQUEST_TIMEOUT_MS = 120_000;

export type SoqlConnection = SalesforceSession;

export function apiVersion(sf: SoqlConnection): string {
  return sf.target.apiVersion;
}

export function orgAlias(sf: SoqlConnection, fallback?: string): string | undefined {
  return fallback ?? sf.target.alias ?? sf.target.targetOrg ?? sf.target.username;
}

export async function currentUserId(sf: SoqlConnection): Promise<string | undefined> {
  try {
    return (await sf.identity({ timeoutMs: SOQL_CONNECTION_TIMEOUT_MS })).user_id;
  } catch {
    return undefined;
  }
}

export async function requestJson<T>(
  sf: SoqlConnection,
  method: HttpMethod,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<T> {
  const response = await sf.request<T>({
    method,
    path,
    body,
    query,
    timeoutMs: SOQL_REQUEST_TIMEOUT_MS,
  });
  if (response.status >= 400) {
    throw new Error(
      `Salesforce API ${method} ${response.path.split("?", 1)[0]} failed (${response.status}).`,
    );
  }
  return response.body;
}

export async function restQuery(
  sf: SoqlConnection,
  query: string,
  mode: SoqlApiMode,
  maxRows: number,
): Promise<SalesforceQueryResult> {
  return toSoqlQueryResult(
    await sf.query({ soql: query, api: mode, maxRows, timeoutMs: SOQL_REQUEST_TIMEOUT_MS }),
  );
}

export async function queryAll(
  sf: SoqlConnection,
  query: string,
  maxRows: number,
): Promise<SalesforceQueryResult> {
  return toSoqlQueryResult(
    await sf.query({
      soql: query,
      api: "rest",
      queryAll: true,
      maxRows,
      timeoutMs: SOQL_REQUEST_TIMEOUT_MS,
    }),
  );
}

function toSoqlQueryResult(
  result: SharedQueryResult<Record<string, unknown>>,
): SalesforceQueryResult {
  return {
    totalSize: result.totalSize ?? result.records.length,
    done: result.done,
    records: result.records,
    nextRecordsUrl: result.nextRecordsUrl,
  };
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

export async function explainQuery(sf: SoqlConnection, query: string): Promise<QueryPlanResponse> {
  return requestJson<QueryPlanResponse>(sf, "GET", "/query", undefined, { explain: query });
}

export async function describeSObject(
  sf: SoqlConnection,
  objectName: string,
): Promise<SObjectDescribe> {
  return requestJson<SObjectDescribe>(
    sf,
    "GET",
    `/sobjects/${encodeURIComponent(objectName)}/describe`,
  );
}

export async function soslSearch(
  sf: SoqlConnection,
  sosl: string,
): Promise<SalesforceSearchResult> {
  return requestJson<SalesforceSearchResult>(sf, "GET", "/search/", undefined, { q: sosl });
}

export async function orgLimits(sf: SoqlConnection): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>(sf, "GET", "/limits");
}

export async function listSObjects(sf: SoqlConnection): Promise<{
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
  }>(sf, "GET", "/sobjects");
}

export function apiCall(method: string, path: string, detail?: string): SoqlApiCallRailItem {
  return { method, path, detail };
}
