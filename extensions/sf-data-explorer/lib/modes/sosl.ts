/* SPDX-License-Identifier: Apache-2.0 */
import type { ExplorerStrategy, CatalogLoad, FieldsLoad, QueryBuildState } from "../types.ts";
import { cacheKey, getCached, setCached } from "../cache.ts";
import type { SfDataExplorerTransport } from "../transport.ts";
import { normalizeCoreSearchResult } from "../result-normalize.ts";
import { escapeSoslTerm, validateFindOnly } from "../validators.ts";
import { fit, pad } from "../text.ts";
import type { CoreFieldMeta, CoreSObjectMeta } from "./soql.ts";

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

export function buildSosl(state: QueryBuildState<CoreSObjectMeta>): string {
  const term = escapeSoslTerm(state.whereClause.trim() || "sample");
  const obj = state.selectedObject;
  if (!obj?.name)
    return `FIND {${term}}\nIN ALL FIELDS\nRETURNING Account(Id, Name)\nLIMIT ${state.limit}`;
  const fields = state.selectedFieldNames.length ? state.selectedFieldNames : ["Id"];
  return `FIND {${term}}\nIN ALL FIELDS\nRETURNING ${obj.name}(${fields.join(", ")})\nLIMIT ${state.limit}`;
}

export function defaultSearchFields(fields: CoreFieldMeta[]): string[] {
  const names = new Set(fields.map((f) => f.name));
  const preferred = ["Id", "Name", "FirstName", "LastName", "Email", "Phone"];
  const out = preferred.filter((name) => names.has(name));
  if (out.length) return out.slice(0, 6);
  return fields
    .slice(0, 5)
    .map((f) => f.name)
    .filter(Boolean);
}

export function createSoslStrategy(args: {
  transport: SfDataExplorerTransport;
  org: string;
  initial: { objects: CoreSObjectMeta[]; cacheLine: string };
}): ExplorerStrategy<CoreSObjectMeta, CoreFieldMeta> {
  const { transport, org, initial } = args;
  return {
    mode: "sosl",
    whereLabel: "search term",
    limitLabel: "LIMIT",
    defaultLimit: 10,
    title: (o) => ` SF Data Explorer · SOSL · ${o} `,
    objectKindLabel: () => "searchable sObject",
    initialObjects: () => initial.objects,
    initialCacheLine: () => initial.cacheLine,
    loadCatalog: async (force): Promise<CatalogLoad<CoreSObjectMeta>> => {
      const ctx = await transport.resolveTarget(org === "default" ? undefined : org);
      const key = cacheKey(["catalog", "sosl", ctx.targetOrg, ctx.apiVersion]);
      const cached = getCached<CoreSObjectMeta[]>(key, force);
      if (cached)
        return {
          value: cached.value,
          cached: true,
          loadedAt: cached.loadedAt,
          kindLabel: "SOSL searchable sObject catalog",
        };
      const resp = await transport.callRest<SObjectsResponse>({
        targetOrg: org,
        method: "GET",
        path: "/sobjects",
      });
      const value = (resp.body.sobjects ?? [])
        .filter((o) => o.queryable && o.searchable && !o.deprecatedAndHidden)
        .sort(sortObjects);
      const stored = setCached(key, value);
      return {
        value: stored.value,
        cached: false,
        loadedAt: stored.loadedAt,
        kindLabel: "SOSL searchable sObject catalog",
      };
    },
    loadFields: async (obj, force): Promise<FieldsLoad<CoreFieldMeta>> => {
      const ctx = await transport.resolveTarget(org === "default" ? undefined : org);
      const key = cacheKey(["fields", "sosl", ctx.targetOrg, ctx.apiVersion, obj.name]);
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
      [cleanLabel(o.label, o.name), o.custom ? "Custom" : "Standard"].filter(Boolean).join(" · "),
    objectQueryHay: (o) =>
      `${o.name} ${o.label} ${o.labelPlural ?? ""} ${o.custom ? "custom" : "standard"}`,
    objectRow: (o, selected, active, width, theme) => {
      const status = active ? theme.fg("success", pad("ACTIVE", 7)) : pad("", 7);
      const type = pad(theme.fg(o.custom ? "borderAccent" : "muted", o.custom ? "CUST" : "STD"), 5);
      const label = cleanLabel(o.label, o.name);
      const name = o.custom ? theme.fg("borderAccent", o.name) : theme.fg("text", o.name);
      const row = `${status} ${type} ${name}${label ? theme.fg("muted", ` · ${label}`) : ""}`;
      return [fit(selected ? theme.bold(row) : row, width)];
    },
    fieldName: (f) => f.name,
    fieldLabel: (f) => f.label || f.name,
    fieldQueryHay: (f) => `${f.name} ${f.label} ${f.type}`,
    fieldTypeLabel: (f) => f.type,
    defaultFieldSelections: defaultSearchFields,
    buildQuery: buildSosl,
    validateQuery: validateFindOnly,
    runQuery: async (queryText, signal) => {
      const resp = await transport.searchSosl({ targetOrg: org, sosl: queryText, signal });
      return normalizeCoreSearchResult(resp.body, {
        query: queryText,
        targetOrg: resp.context.targetOrg ?? org,
        apiVersion: resp.context.apiVersion,
      });
    },
    exportBaseName: (state) => `sf-data-explorer-sosl-${state.selectedObject?.name ?? "search"}`,
  };
}
