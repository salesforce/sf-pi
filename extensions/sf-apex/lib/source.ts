/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only Org Apex Source Evidence through Tooling API. */

import path from "node:path";
import type { Connection } from "@salesforce/core";
import { apiVersion, toolingQueryAll } from "./api.ts";
import { artifactTimestamp, writeApexArtifact } from "./artifacts.ts";
import { buildApexDigest, plural } from "./digest.ts";
import { ok } from "./result.ts";
import { escapeSoql, quoteSoql } from "./soql.ts";
import type { ApexArtifact, SfApexParams, ToolResult } from "./types.ts";

interface SourceTarget {
  raw: string;
  id?: string;
  namespace?: string;
  name?: string;
}

interface ApexSourceRow extends Record<string, unknown> {
  Id: string;
  Name: string;
  NamespacePrefix?: string | null;
  Body?: string | null;
  Status?: string;
  type: "ApexClass" | "ApexTrigger";
}

interface SourceEvidence {
  id: string;
  name: string;
  full_name: string;
  type: "ApexClass" | "ApexTrigger";
  status?: string;
  body_length: number;
  hidden: boolean;
  empty: boolean;
  artifact?: ApexArtifact;
}

const APEX_ID = /^(01p|01q)[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;

export async function getApexSource(conn: Connection, params: SfApexParams): Promise<ToolResult> {
  const targets = sourceTargets(params);
  const rows = targets.length ? await querySourceRows(conn, targets) : [];
  const evidence: SourceEvidence[] = [];
  const sourceArtifacts: ApexArtifact[] = [];
  const stamp = artifactTimestamp();

  for (const row of rows) {
    const hidden = typeof row.Body === "string" && row.Body.includes("(hidden)");
    const empty = !row.Body || row.Body.length === 0;
    const extension = row.type === "ApexTrigger" ? "trigger" : "cls";
    const fullName = row.NamespacePrefix ? `${row.NamespacePrefix}.${row.Name}` : row.Name;
    let artifact: ApexArtifact | undefined;
    if (!hidden && !empty && row.Body) {
      artifact = await writeApexArtifact("source", `${stamp}-${fullName}.${extension}`, row.Body);
      sourceArtifacts.push(artifact);
    }
    evidence.push({
      id: row.Id,
      name: row.Name,
      full_name: fullName,
      type: row.type,
      status: row.Status,
      body_length: row.Body?.length ?? 0,
      hidden,
      empty,
      artifact,
    });
  }

  const summaryArtifact = await writeApexArtifact("source", `${stamp}-source-summary.json`, {
    targets: targets.map((target) => target.raw),
    found: evidence,
  });
  const artifacts = [...sourceArtifacts, summaryArtifact];

  return ok(`Apex source evidence: ${evidence.length} item(s).`, {
    kind: "source_get",
    targets: targets.map((target) => target.raw),
    sources: evidence,
    artifacts,
    digest: buildApexDigest({
      action: params.action,
      kind: "source_get",
      status: evidence.length ? "pass" : "warning",
      icon: "📄",
      title: "Org Apex Source Evidence",
      orgAlias: params.target_org,
      apiVersion: apiVersion(conn),
      apiCalls: [
        {
          method: "GET",
          path: "/tooling/query ApexClass,ApexTrigger",
          detail: `targets=${targets.length}`,
        },
      ],
      sections: [
        {
          icon: "🎯",
          title: "Scope",
          rows: [
            {
              icon: "📄",
              label: "Targets",
              value: compactList(targets.map((target) => target.raw)) || "none",
            },
            { icon: "📊", label: "Found", value: `${plural(evidence.length, "source item")}` },
          ],
        },
        {
          icon: "📄",
          title: "Source",
          rows: sourceRows(evidence),
        },
      ],
      evidenceRows: [{ icon: "📁", label: "Saved", value: artifactSummary(artifacts) }],
      nextRows: [
        {
          icon: "🧭",
          label: "Recommend",
          value: evidence.length
            ? "inspect source artifacts or run targeted diagnostics/tests"
            : "verify class/trigger name or id, then rerun apex.source.get",
        },
      ],
      artifacts,
    }),
  });
}

export function parseSourceTarget(input: string): SourceTarget {
  const raw = input.trim();
  if (!raw) return { raw };
  if (APEX_ID.test(raw)) return { raw, id: raw };
  const base = path.basename(raw).replace(/\.(cls|trigger)$/i, "");
  const parts = base.split(".");
  if (parts.length === 2) return { raw, namespace: parts[0], name: parts[1] };
  return { raw, name: base };
}

function sourceTargets(params: SfApexParams): SourceTarget[] {
  const values = [
    ...(params.apex_ids ?? []),
    ...(params.class_names ?? []),
    ...(params.targets ?? []),
    ...(params.target ? [params.target] : []),
  ];
  const seen = new Set<string>();
  return values
    .map(parseSourceTarget)
    .filter((target) => target.raw && !seen.has(target.raw) && seen.add(target.raw));
}

async function querySourceRows(
  conn: Connection,
  targets: SourceTarget[],
): Promise<ApexSourceRow[]> {
  const ids = targets.map((target) => target.id).filter((id): id is string => Boolean(id));
  const names = targets.filter((target) => target.name);
  const [classes, triggers] = await Promise.all([
    queryApexClassRows(
      conn,
      ids.filter((id) => id.startsWith("01p")),
      names,
    ),
    queryApexTriggerRows(
      conn,
      ids.filter((id) => id.startsWith("01q")),
      names,
    ),
  ]);
  return [...classes, ...triggers].sort((a, b) => a.Name.localeCompare(b.Name));
}

async function queryApexClassRows(
  conn: Connection,
  ids: string[],
  names: SourceTarget[],
): Promise<ApexSourceRow[]> {
  const filters = sourceFilters(ids, names);
  if (!filters.length) return [];
  const result = await toolingQueryAll<Record<string, unknown>>(
    conn,
    `SELECT Id, Name, NamespacePrefix, Body, Status FROM ApexClass WHERE ${filters.join(" OR ")} ORDER BY Name`,
  );
  return result.records.map((row) => ({ ...row, type: "ApexClass" as const })) as ApexSourceRow[];
}

async function queryApexTriggerRows(
  conn: Connection,
  ids: string[],
  names: SourceTarget[],
): Promise<ApexSourceRow[]> {
  const filters = sourceFilters(ids, names);
  if (!filters.length) return [];
  const result = await toolingQueryAll<Record<string, unknown>>(
    conn,
    `SELECT Id, Name, NamespacePrefix, Body, Status FROM ApexTrigger WHERE ${filters.join(" OR ")} ORDER BY Name`,
  );
  return result.records.map((row) => ({ ...row, type: "ApexTrigger" as const })) as ApexSourceRow[];
}

function sourceFilters(ids: string[], names: SourceTarget[]): string[] {
  const filters: string[] = [];
  if (ids.length) filters.push(`Id IN (${ids.map(quoteSoql).join(",")})`);
  for (const target of names) {
    if (!target.name) continue;
    const nameFilter = `Name = '${escapeSoql(target.name)}'`;
    filters.push(
      target.namespace
        ? `(${nameFilter} AND NamespacePrefix = '${escapeSoql(target.namespace)}')`
        : nameFilter,
    );
  }
  return filters;
}

function sourceRows(evidence: SourceEvidence[]) {
  if (!evidence.length) return [{ icon: "⚠️", label: "Source", value: "none found" }];
  return evidence.slice(0, 10).map((item) => ({
    icon: item.hidden ? "🔒" : item.empty ? "⚪" : "📄",
    label: item.full_name,
    value: `${item.type} · ${item.status ?? "unknown"} · ${item.hidden ? "hidden" : item.empty ? "empty" : `${item.body_length} chars`}`,
  }));
}

function artifactSummary(artifacts: ApexArtifact[]): string {
  if (artifacts.length === 0) return "none";
  const kinds = [...new Set(artifacts.map((artifact) => artifact.kind))];
  return `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"} · ${kinds.join(" + ")}`;
}

function compactList(values: string[]): string {
  if (values.length === 0) return "";
  const visible = values.slice(0, 3).join(", ");
  return values.length > 3 ? `${visible}, +${values.length - 3} more` : visible;
}
