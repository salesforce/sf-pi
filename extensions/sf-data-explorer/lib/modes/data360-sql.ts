/* SPDX-License-Identifier: Apache-2.0 */
import type { ExplorerStrategy, CatalogLoad, FieldsLoad, QueryBuildState } from "../types.ts";
import { cacheKey, getCached, setCached } from "../cache.ts";
import type { SfDataExplorerTransport } from "../transport.ts";
import { normalizeData360SqlResult, type Data360SqlResponse } from "../result-normalize.ts";
import { validateSelectOnly } from "../validators.ts";
import { fit, pad, quoteData360Identifier } from "../text.ts";

export interface Data360ObjectMeta {
  name?: string;
  displayName?: string;
  category?: string;
  type?: string;
  entityType?: "DMO" | "DLO";
}

export interface Data360FieldMeta {
  name?: string;
  label?: string;
  displayName?: string;
  type?: string;
  dataType?: string;
  businessType?: string;
  nullable?: boolean;
}

interface MetadataResponse {
  metadata?: Data360ObjectMeta[];
}
type MetadataDetailResponse = Record<string, unknown>;

type FilterMode = "All" | "DMO" | "DLO";

function unwrapMetadataDetail(raw: MetadataDetailResponse): MetadataDetailResponse {
  if (Array.isArray(raw.metadata) && raw.metadata.length === 1)
    return raw.metadata[0] as MetadataDetailResponse;
  if (Array.isArray(raw.dataModelObject) && raw.dataModelObject.length === 1)
    return raw.dataModelObject[0] as MetadataDetailResponse;
  if (Array.isArray(raw.dataLakeObjects) && raw.dataLakeObjects.length === 1)
    return raw.dataLakeObjects[0] as MetadataDetailResponse;
  if (Array.isArray(raw.items) && raw.items.length === 1)
    return raw.items[0] as MetadataDetailResponse;
  return raw;
}

function extractMetadataFields(raw: MetadataDetailResponse): Data360FieldMeta[] {
  const detail = unwrapMetadataDetail(raw);
  const candidates = [
    detail.fields,
    detail.dataFields,
    detail.dataLakeFieldInfoRepresentation,
    (detail.dataLakeObjectInfo as Record<string, unknown> | undefined)?.fields,
    (detail.dataModelObjectInfo as Record<string, unknown> | undefined)?.fields,
  ];
  const fields =
    candidates.find((value): value is Data360FieldMeta[] => Array.isArray(value)) ?? [];
  return fields
    .filter((field) => field.name)
    .map((field) => ({
      name: field.name,
      label: field.label ?? field.displayName ?? field.name,
      displayName: field.displayName,
      type: field.type ?? field.dataType ?? field.businessType,
      dataType: field.dataType ?? field.type ?? field.businessType,
      businessType: field.businessType,
      nullable: field.nullable,
    }));
}

export function buildData360Sql(state: QueryBuildState<Data360ObjectMeta>): string {
  const obj = state.selectedObject;
  if (!obj?.name) return "-- select a Data 360 DMO/DLO";
  const projection = state.selectedFieldNames.length
    ? state.selectedFieldNames.map(quoteData360Identifier).join(",\n  ")
    : "*";
  const where = state.whereClause.trim() ? `\nWHERE ${state.whereClause.trim()}` : "";
  return `SELECT\n  ${projection}\nFROM ${quoteData360Identifier(obj.name)}${where}\nLIMIT ${state.limit}`;
}

export function defaultData360Fields(fields: Data360FieldMeta[]): string[] {
  const names = fields.map((f) => f.name).filter((n): n is string => !!n);
  const scored = names
    .map((name) => {
      let score = 0;
      if (/id|key/i.test(name)) score += 20;
      if (/name|email|phone|date|created/i.test(name)) score += 15;
      if (/^DataSource|^InternalOrganization/i.test(name)) score -= 100;
      return { name, score };
    })
    .sort((a, b) => b.score - a.score);
  const selected = scored
    .filter((s) => s.score > 0)
    .slice(0, 6)
    .map((s) => s.name);
  return selected.length ? selected : names.slice(0, 6);
}

export function createData360SqlStrategy(args: {
  transport: SfDataExplorerTransport;
  org: string;
  initial: { objects: Data360ObjectMeta[]; cacheLine: string };
  requestRender: () => void;
}): ExplorerStrategy<Data360ObjectMeta, Data360FieldMeta> {
  const { transport, org, initial, requestRender } = args;
  let filter: FilterMode = "All";
  let allObjects = initial.objects;
  const applyFilter = (objects: Data360ObjectMeta[]) =>
    filter === "All" ? objects : objects.filter((o) => o.entityType === filter);
  const nextFilter = () => {
    filter = filter === "All" ? "DMO" : filter === "DMO" ? "DLO" : "All";
  };
  const kindLabel = () => (filter === "All" ? "DMO+DLO" : filter);

  async function loadCombined(
    force: boolean,
  ): Promise<{ value: Data360ObjectMeta[]; cached: boolean; loadedAt: number }> {
    const ctx = await transport.resolveTarget(org === "default" ? undefined : org);
    const key = cacheKey(["catalog", "sql", ctx.targetOrg, ctx.apiVersion]);
    const cached = getCached<Data360ObjectMeta[]>(key, force);
    if (cached) return { value: cached.value, cached: true, loadedAt: cached.loadedAt };
    const [dmo, dlo] = await Promise.all([
      transport.callRest<MetadataResponse>({
        targetOrg: org,
        method: "GET",
        path: "/ssot/metadata-entities",
        query: { entityType: "DataModelObject" },
      }),
      transport.callRest<MetadataResponse>({
        targetOrg: org,
        method: "GET",
        path: "/ssot/metadata-entities",
        query: { entityType: "DataLakeObject" },
      }),
    ]);
    const value = [
      ...(dmo.body.metadata ?? [])
        .filter((m) => m.name)
        .map((m) => ({ ...m, entityType: "DMO" as const })),
      ...(dlo.body.metadata ?? [])
        .filter((m) => m.name)
        .map((m) => ({ ...m, entityType: "DLO" as const })),
    ].sort((a, b) => (a.displayName || a.name || "").localeCompare(b.displayName || b.name || ""));
    const stored = setCached(key, value);
    return { value: stored.value, cached: false, loadedAt: stored.loadedAt };
  }

  return {
    mode: "sql",
    whereLabel: "WHERE",
    limitLabel: "LIMIT",
    defaultLimit: 25,
    title: (o) => ` SF Data Explorer · Data 360 SQL · ${o} · ${kindLabel()} `,
    objectKindLabel: () => kindLabel(),
    initialObjects: () => applyFilter(allObjects),
    initialCacheLine: () => initial.cacheLine,
    loadCatalog: async (force): Promise<CatalogLoad<Data360ObjectMeta>> => {
      const loaded = await loadCombined(force);
      allObjects = loaded.value;
      return {
        value: applyFilter(loaded.value),
        cached: loaded.cached,
        loadedAt: loaded.loadedAt,
        kindLabel: `${kindLabel()} catalog`,
      };
    },
    loadFields: async (obj, force): Promise<FieldsLoad<Data360FieldMeta>> => {
      if (!obj.name) throw new Error("Selected Data 360 object has no name.");
      const ctx = await transport.resolveTarget(org === "default" ? undefined : org);
      const key = cacheKey(["fields", "sql", ctx.targetOrg, ctx.apiVersion, obj.name]);
      const cached = getCached<Data360FieldMeta[]>(key, force);
      if (cached)
        return {
          value: cached.value,
          cached: true,
          loadedAt: cached.loadedAt,
          kindLabel: `${obj.name} queryable fields`,
        };
      const resp = await transport.callRest<MetadataDetailResponse>({
        targetOrg: org,
        method: "GET",
        path: "/ssot/metadata",
        query: { entityName: obj.name },
      });
      if (typeof resp.body.errorCode === "string") {
        throw new Error(
          `${resp.body.errorCode}: ${String(resp.body.message ?? "Could not load Data 360 metadata")}`,
        );
      }
      const value = extractMetadataFields(resp.body);
      const stored = setCached(key, value);
      return {
        value: stored.value,
        cached: false,
        loadedAt: stored.loadedAt,
        kindLabel: `${obj.name} queryable fields`,
      };
    },
    objectName: (o) => o.name ?? "",
    objectDisplayName: (o) => o.displayName ?? o.name ?? "(unnamed)",
    objectSubtitle: (o) => [o.entityType, o.category, o.type, o.name].filter(Boolean).join(" · "),
    objectQueryHay: (o) =>
      `${o.displayName ?? ""} ${o.name ?? ""} ${o.category ?? ""} ${o.type ?? ""} ${o.entityType ?? ""}`,
    objectRow: (o, selected, active, width, theme) => {
      const status = active ? theme.fg("success", pad("ACTIVE", 7)) : pad("", 7);
      const type = pad(theme.fg("borderAccent", o.entityType ?? "---"), 5);
      const cat = o.category ? theme.fg("muted", ` · ${o.category}`) : "";
      const row = `${status} ${type} ${o.displayName || o.name || "(unnamed)"} ${theme.fg("dim", `(${o.name ?? ""})`)}${cat}`;
      return [fit(selected ? theme.bold(row) : row, width)];
    },
    fieldName: (f) => f.name ?? f.label ?? "(unnamed)",
    fieldLabel: (f) => f.label ?? f.name ?? "(unnamed)",
    fieldQueryHay: (f) => `${f.name ?? ""} ${f.label ?? ""} ${f.type ?? ""} ${f.dataType ?? ""}`,
    fieldTypeLabel: (f) => f.type ?? f.dataType ?? "",
    defaultFieldSelections: defaultData360Fields,
    buildQuery: buildData360Sql,
    validateQuery: (q) => validateSelectOnly(q, "Data 360 SQL"),
    runQuery: async (queryText, signal) => {
      const resp = await transport.queryData360Sql({ targetOrg: org, sql: queryText, signal });
      return normalizeData360SqlResult(resp.body as Data360SqlResponse, {
        query: queryText,
        targetOrg: resp.context.targetOrg ?? org,
        apiVersion: resp.context.apiVersion,
      });
    },
    exportBaseName: (state) => `sf-data-explorer-sql-${state.selectedObject?.name ?? "query"}`,
    alternateCatalog: {
      label: "All/DMO/DLO",
      toggle: async () => {
        nextFilter();
        requestRender();
      },
    },
  };
}
