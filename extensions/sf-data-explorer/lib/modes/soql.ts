/* SPDX-License-Identifier: Apache-2.0 */
import type { ExplorerStrategy, CatalogLoad, FieldsLoad, QueryBuildState } from "../types.ts";
import { cacheKey, getCached, setCached } from "../cache.ts";
import type { SfDataExplorerTransport } from "../transport.ts";
import { normalizeCoreQueryResult } from "../result-normalize.ts";
import { validateSelectOnly } from "../validators.ts";
import { fit, pad } from "../text.ts";

export interface CoreSObjectMeta {
  name: string;
  label: string;
  labelPlural?: string;
  custom: boolean;
  queryable: boolean;
  searchable?: boolean;
  deprecatedAndHidden?: boolean;
}

export interface CoreFieldMeta {
  name: string;
  label: string;
  type: string;
  custom?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  groupable?: boolean;
  calculated?: boolean;
  relationshipName?: string;
  referenceTo?: string[];
}

interface SObjectsResponse {
  sobjects?: CoreSObjectMeta[];
}
interface DescribeResponse {
  fields?: CoreFieldMeta[];
}

function cleanLabel(label: string | undefined, name: string): string {
  if (!label || /^__MISSING LABEL__/i.test(label)) return "";
  if (label === name) return "";
  return label;
}

function sortObjects(a: CoreSObjectMeta, b: CoreSObjectMeta): number {
  if (a.custom !== b.custom) return a.custom ? 1 : -1;
  return a.name.localeCompare(b.name);
}

export function buildSoql(state: QueryBuildState<CoreSObjectMeta>): string {
  const obj = state.selectedObject;
  if (!obj?.name) return "-- select a queryable sObject";
  const fields = state.selectedFieldNames.length ? state.selectedFieldNames : ["Id"];
  const projection = fields.join(",\n  ");
  const where = state.whereClause.trim() ? `\nWHERE ${state.whereClause.trim()}` : "";
  return `SELECT\n  ${projection}\nFROM ${obj.name}${where}\nLIMIT ${state.limit}`;
}

export function defaultCoreFields(fields: CoreFieldMeta[]): string[] {
  const names = new Set(fields.map((f) => f.name));
  const preferred = [
    "Id",
    "Name",
    "FirstName",
    "LastName",
    "Email",
    "Phone",
    "CreatedDate",
    "LastModifiedDate",
  ];
  const out = preferred.filter((name) => names.has(name));
  if (out.length) return out.slice(0, 6);
  return fields
    .slice(0, 5)
    .map((f) => f.name)
    .filter(Boolean);
}

export function createSoqlStrategy(args: {
  transport: SfDataExplorerTransport;
  org: string;
  initial: { objects: CoreSObjectMeta[]; cacheLine: string };
}): ExplorerStrategy<CoreSObjectMeta, CoreFieldMeta> {
  const { transport, org, initial } = args;
  return {
    mode: "soql",
    whereLabel: "WHERE",
    limitLabel: "LIMIT",
    defaultLimit: 25,
    title: (o) => ` SF Data Explorer · SOQL · ${o} `,
    objectKindLabel: () => "sObject",
    initialObjects: () => initial.objects,
    initialCacheLine: () => initial.cacheLine,
    loadCatalog: async (force): Promise<CatalogLoad<CoreSObjectMeta>> => {
      const ctx = await transport.resolveTarget(org === "default" ? undefined : org);
      const key = cacheKey(["catalog", "soql", ctx.targetOrg, ctx.apiVersion]);
      const cached = getCached<CoreSObjectMeta[]>(key, force);
      if (cached)
        return {
          value: cached.value,
          cached: true,
          loadedAt: cached.loadedAt,
          kindLabel: "SOQL sObject catalog",
        };
      const resp = await transport.callRest<SObjectsResponse>({
        targetOrg: org,
        method: "GET",
        path: "/sobjects",
      });
      const value = (resp.body.sobjects ?? [])
        .filter((o) => o.queryable && !o.deprecatedAndHidden)
        .sort(sortObjects);
      const stored = setCached(key, value);
      return {
        value: stored.value,
        cached: false,
        loadedAt: stored.loadedAt,
        kindLabel: "SOQL sObject catalog",
      };
    },
    loadFields: async (obj, force): Promise<FieldsLoad<CoreFieldMeta>> => {
      const ctx = await transport.resolveTarget(org === "default" ? undefined : org);
      const key = cacheKey(["fields", "soql", ctx.targetOrg, ctx.apiVersion, obj.name]);
      const cached = getCached<CoreFieldMeta[]>(key, force);
      if (cached)
        return {
          value: cached.value,
          cached: true,
          loadedAt: cached.loadedAt,
          kindLabel: `${obj.name} describe`,
        };
      const resp = await transport.callRest<DescribeResponse>({
        targetOrg: org,
        method: "GET",
        path: `/sobjects/${encodeURIComponent(obj.name)}/describe`,
      });
      const value = (resp.body.fields ?? [])
        .filter((f) => f.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      const stored = setCached(key, value);
      return {
        value: stored.value,
        cached: false,
        loadedAt: stored.loadedAt,
        kindLabel: `${obj.name} describe`,
      };
    },
    objectName: (o) => o.name,
    objectDisplayName: (o) => o.name,
    objectSubtitle: (o) =>
      [
        cleanLabel(o.label, o.name),
        o.custom ? "Custom" : "Standard",
        o.searchable ? "searchable" : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
    objectQueryHay: (o) =>
      `${o.name} ${o.label} ${o.labelPlural ?? ""} ${o.custom ? "custom" : "standard"} ${o.searchable ? "searchable" : ""}`,
    objectRow: (o, selected, active, width, theme) => {
      const status = active ? theme.fg("success", pad("ACTIVE", 7)) : pad("", 7);
      const type = pad(theme.fg(o.custom ? "borderAccent" : "muted", o.custom ? "CUST" : "STD"), 5);
      const label = cleanLabel(o.label, o.name);
      const name = o.custom ? theme.fg("borderAccent", o.name) : theme.fg("text", o.name);
      const row = `${status} ${type} ${name}${label ? theme.fg("muted", ` · ${label}`) : ""}${o.searchable ? theme.fg("dim", " · searchable") : ""}`;
      return [fit(selected ? theme.bold(row) : row, width)];
    },
    fieldName: (f) => f.name,
    fieldLabel: (f) => f.label || f.name,
    fieldQueryHay: (f) =>
      `${f.name} ${f.label} ${f.type} ${f.custom ? "custom" : "standard"} ${f.filterable ? "filterable" : ""}`,
    fieldTypeLabel: (f) =>
      `${f.type}${f.filterable ? " · filter" : ""}${f.sortable ? " · sort" : ""}`,
    defaultFieldSelections: defaultCoreFields,
    buildQuery: buildSoql,
    validateQuery: (q) => validateSelectOnly(q, "SOQL"),
    runQuery: async (queryText, signal) => {
      const resp = await transport.querySoql({ targetOrg: org, soql: queryText, signal });
      return normalizeCoreQueryResult(resp.body, {
        query: queryText,
        targetOrg: resp.context.targetOrg ?? org,
        apiVersion: resp.context.apiVersion,
      });
    },
    exportBaseName: (state) => `sf-data-explorer-soql-${state.selectedObject?.name ?? "query"}`,
  };
}
