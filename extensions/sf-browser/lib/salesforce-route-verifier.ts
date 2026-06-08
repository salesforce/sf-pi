/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Verified structured Salesforce route resolution for SF Browser.
 *
 * `sf_browser_resolve_path` stays deterministic/local. `sf_browser_open_org`
 * uses this module for structured `route` inputs so partial user intent is
 * verified through Salesforce APIs before the browser navigates.
 */
import type { Connection } from "@salesforce/core";
import { connFromAlias } from "../../../lib/common/sf-conn/connection.ts";
import type { SalesforceRoute } from "./salesforce-path-resolver.ts";

export interface VerifiedRouteResult {
  path: string;
  objectApiName?: string;
  recordId?: string;
  listView?: VerifiedListView;
  relatedList?: VerifiedRelatedList;
}

export interface VerifiedListView {
  id?: string;
  apiName?: string;
  label?: string;
  filterName: string;
}

export interface VerifiedRelatedList {
  relatedListId: string;
  label?: string;
  objectApiName?: string;
}

interface ObjectDescribeLike {
  name: string;
  queryable?: boolean;
  createable?: boolean;
}

interface QueryResultLike {
  totalSize: number;
  records?: unknown[];
}

interface ListInfoResponse {
  lists?: ListInfoItem[];
}

interface ListInfoItem {
  id?: string | null;
  apiName?: string;
  developerName?: string;
  label?: string;
}

interface RelatedListInfoResponse {
  relatedLists?: RelatedListInfoItem[];
}

interface RelatedListInfoItem {
  relatedListId?: string;
  label?: string;
  objectApiName?: string;
}

const API_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const SALESFORCE_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

export async function resolveVerifiedRoutePath(
  targetOrg: string,
  route: SalesforceRoute,
): Promise<VerifiedRouteResult> {
  const conn = await connFromAlias(targetOrg);
  return verifySalesforceRoute(conn, route);
}

export async function verifySalesforceRoute(
  conn: Connection,
  route: SalesforceRoute,
): Promise<VerifiedRouteResult> {
  switch (route.type) {
    case "home":
      return { path: "/lightning/page/home" };
    case "setup":
      throw new Error(
        "Setup routes are resolved through the curated local Setup Destination registry.",
      );
    case "data-cloud":
      throw new Error(
        "Data Cloud routes are resolved through the local verified Data Cloud Destination Pack.",
      );
    case "object-list": {
      const object = await verifyObject(conn, route.objectApiName);
      return { path: `/lightning/o/${object.name}/list`, objectApiName: object.name };
    }
    case "object-new": {
      const object = await verifyObject(conn, route.objectApiName);
      if (object.createable === false) {
        throw new Error(`Object ${object.name} is not createable for the current user.`);
      }
      return { path: `/lightning/o/${object.name}/new`, objectApiName: object.name };
    }
    case "record-view": {
      const object = await verifyObject(conn, route.objectApiName);
      await verifyRecordExists(conn, object.name, route.recordId);
      return {
        path: `/lightning/r/${object.name}/${route.recordId}/view`,
        objectApiName: object.name,
        recordId: route.recordId,
      };
    }
    case "list-view": {
      const object = await verifyObject(conn, route.objectApiName);
      const listView = await resolveListView(conn, object.name, route.filterName);
      return {
        path: `/lightning/o/${object.name}/list?filterName=${encodeURIComponent(listView.filterName)}`,
        objectApiName: object.name,
        listView,
      };
    }
    case "record-related-list": {
      const object = await verifyObject(conn, route.objectApiName);
      await verifyRecordExists(conn, object.name, route.recordId);
      const relatedList = await resolveRelatedList(conn, object.name, route.relatedListApiName);
      return {
        path: `/lightning/r/${object.name}/${route.recordId}/related/${encodeURIComponent(
          relatedList.relatedListId,
        )}/view`,
        objectApiName: object.name,
        recordId: route.recordId,
        relatedList,
      };
    }
    default:
      return assertNever(route);
  }
}

async function verifyObject(conn: Connection, objectApiName: string): Promise<ObjectDescribeLike> {
  const safeObject = validateApiName(objectApiName, "objectApiName");
  try {
    const described = (await conn.describe(safeObject)) as ObjectDescribeLike;
    if (!described?.name) throw new Error(`Describe returned no name for ${safeObject}.`);
    return described;
  } catch (error) {
    throw new Error(
      `Could not verify object ${JSON.stringify(safeObject)}: ${errorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
}

async function verifyRecordExists(
  conn: Connection,
  objectApiName: string,
  recordId: string,
): Promise<void> {
  const safeId = validateSalesforceId(recordId, "recordId");
  const result = (await conn.query(
    `SELECT Id FROM ${objectApiName} WHERE Id = '${safeId}' LIMIT 1`,
  )) as QueryResultLike;
  if (result.totalSize !== 1) {
    throw new Error(`Record ${safeId} was not found or is not accessible on ${objectApiName}.`);
  }
}

async function resolveListView(
  conn: Connection,
  objectApiName: string,
  rawFilterName: string,
): Promise<VerifiedListView> {
  const value = rawFilterName.trim();
  if (!value) throw new Error("list-view route requires filterName.");
  const response = (await conn.request(
    `/services/data/v${conn.version}/ui-api/list-info/${objectApiName}?pageSize=200`,
  )) as ListInfoResponse;
  const lists = response.lists ?? [];
  const matches = lists.filter((item) => matchesListView(item, value));
  if (matches.length === 1) return listViewFromItem(matches[0] as ListInfoItem, value);
  if (matches.length > 1) {
    throw new Error(
      `List view ${JSON.stringify(value)} is ambiguous on ${objectApiName}. Candidates: ${formatListViewCandidates(
        matches,
      )}`,
    );
  }
  throw new Error(
    `List view ${JSON.stringify(value)} was not found on ${objectApiName}. Candidates: ${formatListViewCandidates(
      lists.slice(0, 10),
    )}`,
  );
}

function matchesListView(item: ListInfoItem, value: string): boolean {
  const normalized = normalize(value);
  return [item.id, item.apiName, item.developerName, item.label]
    .filter(
      (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
    )
    .some((candidate) => normalize(candidate) === normalized);
}

function listViewFromItem(item: ListInfoItem, fallback: string): VerifiedListView {
  const filterName = item.apiName || item.developerName || item.id || fallback;
  return {
    ...(item.id ? { id: item.id } : {}),
    ...(item.apiName || item.developerName ? { apiName: item.apiName || item.developerName } : {}),
    ...(item.label ? { label: item.label } : {}),
    filterName,
  };
}

async function resolveRelatedList(
  conn: Connection,
  objectApiName: string,
  rawRelatedList: string,
): Promise<VerifiedRelatedList> {
  const value = rawRelatedList.trim();
  if (!value) throw new Error("record-related-list route requires relatedListApiName.");
  const response = (await conn.request(
    `/services/data/v${conn.version}/ui-api/related-list-info/${objectApiName}`,
  )) as RelatedListInfoResponse;
  const relatedLists = response.relatedLists ?? [];
  const matches = relatedLists.filter((item) => matchesRelatedList(item, value));
  if (matches.length === 1) return relatedListFromItem(matches[0] as RelatedListInfoItem);
  if (matches.length > 1) {
    throw new Error(
      `Related list ${JSON.stringify(value)} is ambiguous on ${objectApiName}. Candidates: ${formatRelatedListCandidates(
        matches,
      )}`,
    );
  }
  throw new Error(
    `Related list ${JSON.stringify(value)} was not found on ${objectApiName}. Candidates: ${formatRelatedListCandidates(
      relatedLists.slice(0, 10),
    )}`,
  );
}

function matchesRelatedList(item: RelatedListInfoItem, value: string): boolean {
  const normalized = normalize(value);
  return [item.relatedListId, item.label, item.objectApiName]
    .filter(
      (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
    )
    .some((candidate) => normalize(candidate) === normalized);
}

function relatedListFromItem(item: RelatedListInfoItem): VerifiedRelatedList {
  if (!item.relatedListId) throw new Error("Related list metadata returned no relatedListId.");
  return {
    relatedListId: item.relatedListId,
    ...(item.label ? { label: item.label } : {}),
    ...(item.objectApiName ? { objectApiName: item.objectApiName } : {}),
  };
}

function validateApiName(value: string, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (!API_NAME_RE.test(trimmed)) throw new Error(`Invalid ${field} ${JSON.stringify(value)}.`);
  return trimmed;
}

function validateSalesforceId(value: string, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (!SALESFORCE_ID_RE.test(trimmed)) {
    throw new Error(`${field} must be a 15 or 18 character Salesforce id.`);
  }
  return trimmed;
}

function formatListViewCandidates(items: ListInfoItem[]): string {
  return items
    .map((item) =>
      [item.label, item.apiName || item.developerName, item.id].filter(Boolean).join(" / "),
    )
    .filter(Boolean)
    .join("; ");
}

function formatRelatedListCandidates(items: RelatedListInfoItem[]): string {
  return items
    .map((item) => [item.label, item.relatedListId, item.objectApiName].filter(Boolean).join(" / "))
    .filter(Boolean)
    .join("; ");
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported route: ${JSON.stringify(value)}`);
}
