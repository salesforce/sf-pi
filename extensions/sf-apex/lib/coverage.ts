/* SPDX-License-Identifier: Apache-2.0 */
/** Native Apex Coverage Evidence for sf-apex. */

import path from "node:path";
import type { Connection } from "@salesforce/core";
import { apiVersion, toolingQuery, toolingQueryAll } from "./api.ts";
import { artifactTimestamp, writeApexArtifact } from "./artifacts.ts";
import { buildApexDigest, plural } from "./digest.ts";
import { ok } from "./result.ts";
import { quoteSoql } from "./soql.ts";
import type { ApexArtifact, SfApexParams, ToolResult } from "./types.ts";

interface ApexMemberRow extends Record<string, unknown> {
  Id: string;
  Name: string;
  type: "ApexClass" | "ApexTrigger";
}

interface CoverageRow extends Record<string, unknown> {
  ApexClassOrTriggerId?: string;
  ApexClassOrTrigger?: { Id?: string; Name?: string };
  NumLinesCovered?: number;
  NumLinesUncovered?: number;
  Coverage?: {
    coveredLines?: number[];
    uncoveredLines?: number[];
  };
}

interface NormalizedCoverageRow {
  apex_id: string;
  name: string;
  type?: string;
  covered: number;
  uncovered: number;
  total: number;
  pct: number;
  covered_lines?: number[];
  uncovered_lines?: number[];
}

export async function coverageSummary(conn: Connection, params: SfApexParams): Promise<ToolResult> {
  const names = coverageTargetNames(params);
  const threshold = boundedThreshold(params.threshold_percent);
  const includeLines = params.include_uncovered_lines === true;
  const includeOrgWide = params.org_wide === true || names.length === 0;
  const members = names.length ? await queryApexMembersByNames(conn, names) : [];
  const coverageRows = await queryCoverage(conn, members, includeLines);
  const normalized = normalizeCoverageRows(coverageRows, members, includeLines);
  const orgWide = includeOrgWide ? await queryOrgWideCoverage(conn) : undefined;
  const artifactPayload = {
    targets: names,
    org_wide: orgWide,
    threshold_percent: threshold,
    include_uncovered_lines: includeLines,
    members,
    coverage: normalized,
    raw_coverage: coverageRows,
  };
  const artifact = await writeApexArtifact(
    "coverage",
    `${artifactTimestamp()}-coverage-summary.json`,
    artifactPayload,
  );
  const belowThreshold =
    threshold === undefined ? [] : normalized.filter((row) => row.pct < threshold);
  const orgBelowThreshold =
    threshold !== undefined && orgWide !== undefined && orgWide.percent_covered < threshold;
  const status =
    normalized.length === 0 && orgWide === undefined
      ? "warning"
      : belowThreshold.length || orgBelowThreshold
        ? "warning"
        : "pass";

  return ok(`Apex coverage summary: ${normalized.length} target(s).`, {
    kind: "coverage_summary",
    targets: names,
    org_wide: orgWide,
    threshold_percent: threshold,
    include_uncovered_lines: includeLines,
    coverage: normalized.slice(0, 25),
    counts: { targets: normalized.length, below_threshold: belowThreshold.length },
    artifacts: [artifact],
    digest: buildApexDigest({
      action: params.action,
      kind: "coverage_summary",
      status,
      icon: "📈",
      title: "Apex Coverage Evidence",
      orgAlias: params.target_org,
      apiVersion: apiVersion(conn),
      apiCalls: coverageApiCalls(names, members.length, includeLines, includeOrgWide),
      sections: [
        {
          icon: "🎯",
          title: "Scope",
          rows: [
            { icon: "📄", label: "Targets", value: compactList(names) || "not specified" },
            {
              icon: "📊",
              label: "Found",
              value: `${plural(normalized.length, "coverage record")}`,
            },
            threshold === undefined
              ? { icon: "⚪", label: "Threshold", value: "not set" }
              : { icon: "📏", label: "Threshold", value: `${threshold}% signal only` },
            includeLines
              ? { icon: "📍", label: "Lines", value: "covered/uncovered lines in artifact" }
              : { icon: "⚪", label: "Lines", value: "line arrays not requested" },
          ],
        },
        {
          icon: "🌐",
          title: "Org Wide",
          rows: orgWide
            ? [
                {
                  icon:
                    threshold !== undefined && orgWide.percent_covered < threshold ? "🟡" : "🟢",
                  label: "Coverage",
                  value: `${orgWide.percent_covered}%`,
                },
              ]
            : [{ icon: "⚪", label: "Coverage", value: "not requested" }],
        },
        {
          icon: "📈",
          title: "Lowest Covered",
          rows: coverageRowsForCard(normalized, threshold),
        },
      ],
      evidenceRows: [{ icon: "📁", label: "Saved", value: artifactSummary([artifact]) }],
      nextRows: [
        {
          icon: "🧭",
          label: "Recommend",
          value: belowThreshold.length
            ? "add focused tests for the lowest-covered targets"
            : normalized.length
              ? "coverage evidence is available in artifacts"
              : "run targeted tests, then rerun coverage.summary",
        },
      ],
      artifacts: [artifact],
    }),
  });
}

export function normalizeCoverageRows(
  rows: CoverageRow[],
  members: ApexMemberRow[] = [],
  includeLines = false,
): NormalizedCoverageRow[] {
  const memberById = new Map(members.map((member) => [member.Id, member]));
  return rows
    .map((row) => {
      const apexId = String(row.ApexClassOrTriggerId ?? row.ApexClassOrTrigger?.Id ?? "");
      const member = memberById.get(apexId);
      const covered = Number(row.NumLinesCovered ?? 0);
      const uncovered = Number(row.NumLinesUncovered ?? 0);
      const total = covered + uncovered;
      return {
        apex_id: apexId,
        name: member?.Name ?? String(row.ApexClassOrTrigger?.Name ?? shortId(apexId)),
        type: member?.type,
        covered,
        uncovered,
        total,
        pct: total > 0 ? Math.round((covered / total) * 100) : 0,
        ...(includeLines
          ? {
              covered_lines: row.Coverage?.coveredLines ?? [],
              uncovered_lines: row.Coverage?.uncoveredLines ?? [],
            }
          : {}),
      };
    })
    .sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name));
}

async function queryApexMembersByNames(
  conn: Connection,
  names: string[],
): Promise<ApexMemberRow[]> {
  const quoted = names.map(quoteSoql).join(",");
  const [classes, triggers] = await Promise.all([
    toolingQuery<{ Id: string; Name: string }>(
      conn,
      `SELECT Id, Name FROM ApexClass WHERE Name IN (${quoted}) AND Status = 'Active' ORDER BY Name`,
    ),
    toolingQuery<{ Id: string; Name: string }>(
      conn,
      `SELECT Id, Name FROM ApexTrigger WHERE Name IN (${quoted}) AND Status = 'Active' ORDER BY Name`,
    ),
  ]);
  return [
    ...classes.records.map((record) => ({ ...record, type: "ApexClass" as const })),
    ...triggers.records.map((record) => ({ ...record, type: "ApexTrigger" as const })),
  ];
}

async function queryCoverage(
  conn: Connection,
  members: ApexMemberRow[],
  includeLines: boolean,
): Promise<CoverageRow[]> {
  if (members.length === 0) return [];
  const fields = [
    "ApexClassOrTrigger.Id",
    "ApexClassOrTrigger.Name",
    "NumLinesCovered",
    "NumLinesUncovered",
    ...(includeLines ? ["Coverage"] : []),
  ].join(", ");
  return (
    await toolingQueryAll<CoverageRow>(
      conn,
      `SELECT ${fields} FROM ApexCodeCoverageAggregate WHERE ApexClassOrTriggerId IN (${members.map((member) => quoteSoql(member.Id)).join(",")})`,
    )
  ).records;
}

async function queryOrgWideCoverage(
  conn: Connection,
): Promise<{ percent_covered: number } | undefined> {
  const rows = (
    await toolingQuery<{ PercentCovered: number }>(
      conn,
      "SELECT PercentCovered FROM ApexOrgWideCoverage LIMIT 1",
    )
  ).records;
  const percent = rows[0]?.PercentCovered;
  return typeof percent === "number" ? { percent_covered: percent } : undefined;
}

function coverageTargetNames(params: SfApexParams): string[] {
  const names = [...(params.class_names ?? []), ...targetInputs(params)].map((target) =>
    path.basename(target).replace(/\.(cls|trigger)$/i, ""),
  );
  return [...new Set(names.filter(Boolean))];
}

function targetInputs(params: SfApexParams): string[] {
  return [...(params.targets ?? []), ...(params.target ? [params.target] : [])].filter(Boolean);
}

function coverageRowsForCard(rows: NormalizedCoverageRow[], threshold: number | undefined) {
  if (rows.length === 0) {
    return [{ icon: "⚠️", label: "Coverage", value: "no coverage records found for targets" }];
  }
  return rows.slice(0, 8).map((row) => ({
    icon: threshold !== undefined && row.pct < threshold ? "🟡" : row.pct >= 75 ? "🟢" : "🟡",
    label: row.name,
    value: `${row.pct}% · ${row.covered}/${row.total} covered${row.uncovered_lines ? ` · ${row.uncovered_lines.length} uncovered line(s)` : ""}`,
  }));
}

function coverageApiCalls(
  names: string[],
  memberCount: number,
  includeLines: boolean,
  includeOrgWide: boolean,
) {
  return [
    ...(names.length
      ? [
          {
            method: "GET",
            path: "/tooling/query ApexClass,ApexTrigger",
            detail: `Name IN ${compactList(names)}`,
          },
        ]
      : []),
    ...(includeOrgWide
      ? [
          {
            method: "GET",
            path: "/tooling/query ApexOrgWideCoverage",
            detail: "org-wide percent",
          },
        ]
      : []),
    {
      method: "GET",
      path: "/tooling/query ApexCodeCoverageAggregate",
      detail: `targets=${memberCount} · lines=${includeLines ? "yes" : "no"}`,
    },
  ];
}

function boundedThreshold(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
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

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 3)}…${value.slice(-4)}` : value;
}
