/* SPDX-License-Identifier: Apache-2.0 */
/** API-aware object discovery and describe caching for sf-soql. */

import type { SoqlConnection as Connection } from "./api.ts";
import { describeSObject, listSObjects, sobjectsPath } from "./api.ts";
import type {
  SfSoqlParams,
  SfSoqlSessionState,
  SObjectCatalogEntry,
  SObjectDescribe,
  SoqlApiCallRailItem,
  SoqlApiMode,
  SoqlApiPreference,
} from "./types.ts";

export interface SchemaCandidate {
  api: SoqlApiMode;
  describe: SObjectDescribe;
}

export interface SchemaResolution {
  requestedApi: SoqlApiPreference;
  candidates: SchemaCandidate[];
  apiCalls: SoqlApiCallRailItem[];
  errors: Array<{ api: SoqlApiMode; error: unknown }>;
}

export interface ResolvedObjectSchema {
  requestedApi: SoqlApiPreference;
  resolvedApi: SoqlApiMode;
  describe: SObjectDescribe;
  reason: string;
  apiCalls: SoqlApiCallRailItem[];
}

export async function resolveSchemaCandidates(
  conn: Connection,
  params: SfSoqlParams,
  objectName: string,
  state?: SfSoqlSessionState,
): Promise<SchemaResolution> {
  const requestedApi = params.api ?? "auto";
  const apiCalls: SoqlApiCallRailItem[] = [];
  const errors: Array<{ api: SoqlApiMode; error: unknown }> = [];
  let modes: SoqlApiMode[];

  if (requestedApi !== "auto") {
    modes = [requestedApi];
  } else {
    const catalogs = await Promise.all(
      (["rest", "tooling"] as const).map(async (api) => {
        try {
          const catalog = await loadObjectCatalog(conn, api, state);
          apiCalls.push({
            method: catalog.cached ? "CACHE" : "GET",
            path: conn.path(sobjectsPath(api)),
            detail: `api=${api}`,
          });
          return { api, objects: catalog.objects };
        } catch (error) {
          errors.push({ api, error });
          return { api, objects: [] as SObjectCatalogEntry[] };
        }
      }),
    );
    modes = catalogs
      .filter(({ objects }) =>
        objects.some(
          (object) =>
            object.name.toLowerCase() === objectName.toLowerCase() && object.queryable !== false,
        ),
      )
      .map(({ api }) => api);
    if (!modes.length) modes = ["rest", "tooling"];
  }

  const candidates: SchemaCandidate[] = [];
  await Promise.all(
    modes.map(async (api) => {
      try {
        const schema = await loadSchemaDescription(conn, objectName, api, state);
        apiCalls.push({
          method: schema.cached ? "CACHE" : "GET",
          path: conn.path(`${sobjectsPath(api)}/${encodeURIComponent(objectName)}/describe`),
          detail: `api=${api} · fields=${schema.describe.fields.length}`,
        });
        candidates.push({ api, describe: schema.describe });
      } catch (error) {
        errors.push({ api, error });
      }
    }),
  );
  candidates.sort((left, right) => apiPriority(left.api) - apiPriority(right.api));
  errors.sort((left, right) => apiPriority(left.api) - apiPriority(right.api));
  apiCalls.sort(
    (left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
  );
  return { requestedApi, candidates, apiCalls, errors };
}

export async function resolveObjectSchema(
  conn: Connection,
  params: SfSoqlParams,
  objectName: string,
  state?: SfSoqlSessionState,
): Promise<ResolvedObjectSchema> {
  const resolution = await resolveSchemaCandidates(conn, params, objectName, state);
  const selected = preferredCandidate(resolution.candidates, resolution.requestedApi);
  if (!selected)
    throw resolution.errors[0]?.error ?? new Error(`No schema found for ${objectName}.`);
  return {
    requestedApi: resolution.requestedApi,
    resolvedApi: selected.api,
    describe: selected.describe,
    reason: resolutionReason(resolution.requestedApi, resolution.candidates, selected.api),
    apiCalls: resolution.apiCalls,
  };
}

export async function loadSchemaDescription(
  conn: Connection,
  objectName: string,
  api: SoqlApiMode,
  state?: SfSoqlSessionState,
): Promise<{ describe: SObjectDescribe; cached: boolean }> {
  const cache = (state ?? {}).schemaCache ?? new Map<string, SObjectDescribe>();
  if (state && !state.schemaCache) state.schemaCache = cache;
  const key = `${orgKey(conn)}:${api}:${objectName.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached) return { describe: cached, cached: true };
  const describe = await describeSObject(conn, objectName, api);
  cache.set(key, describe);
  return { describe, cached: false };
}

export function resolutionReason(
  requestedApi: SoqlApiPreference,
  candidates: SchemaCandidate[],
  selectedApi: SoqlApiMode,
  fieldMatchedApi?: SoqlApiMode,
): string {
  if (requestedApi !== "auto") return `explicit ${requestedApi.toUpperCase()} selection`;
  if (fieldMatchedApi) return `query fields validate only through ${fieldMatchedApi.toUpperCase()}`;
  if (candidates.length === 1) return `object is available through ${selectedApi.toUpperCase()}`;
  return `object is available through both APIs; ${selectedApi.toUpperCase()} preferred`;
}

export function describeResolutionError(
  api: SoqlApiMode,
  objectName: string,
  error: unknown,
): string {
  const code = errorCode(error);
  return `${api.toUpperCase()} metadata is unavailable for ${objectName}${code ? ` (${code})` : ""}.`;
}

async function loadObjectCatalog(
  conn: Connection,
  api: SoqlApiMode,
  state?: SfSoqlSessionState,
): Promise<{ objects: SObjectCatalogEntry[]; cached: boolean }> {
  const cache = (state ?? {}).objectCatalogCache ?? new Map<string, SObjectCatalogEntry[]>();
  if (state && !state.objectCatalogCache) state.objectCatalogCache = cache;
  const key = `${orgKey(conn)}:${api}`;
  const cached = cache.get(key);
  if (cached) return { objects: cached, cached: true };
  const result = await listSObjects(conn, api);
  const objects = result.sobjects ?? [];
  cache.set(key, objects);
  return { objects, cached: false };
}

function preferredCandidate(
  candidates: SchemaCandidate[],
  requestedApi: SoqlApiPreference,
): SchemaCandidate | undefined {
  if (requestedApi !== "auto")
    return candidates.find((candidate) => candidate.api === requestedApi);
  return candidates.find((candidate) => candidate.api === "rest") ?? candidates[0];
}

function orgKey(conn: Connection): string {
  return `${conn.target.orgId ?? conn.target.targetOrg}:${conn.target.apiVersion}`;
}

function apiPriority(api: SoqlApiMode): number {
  return api === "rest" ? 0 : 1;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { errorCode?: unknown }).errorCode;
  return typeof value === "string" ? value : undefined;
}
