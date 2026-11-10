/* SPDX-License-Identifier: Apache-2.0 */
/** Best-effort Setup Audit Trail enrichment for Browser Evidence. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { redactText } from "./redaction.ts";
import { resolveTargetOrg } from "./salesforce-open.ts";
import { spawnCommand } from "../../../lib/common/windows-spawn.ts";

export interface SetupAuditTrailRow {
  Id?: string;
  CreatedDate?: string;
  Action?: string;
  Section?: string;
  Display?: string;
  DelegateUser?: string;
  ResponsibleNamespacePrefix?: string;
  CreatedBy?: { Name?: string };
}

export interface SetupAuditTrailSummary {
  status: "skipped" | "queried" | "unavailable";
  targetOrg?: string;
  query?: string;
  lookbackMinutes?: number;
  rows?: SetupAuditTrailRow[];
  rowCount?: number;
  error?: string;
}

const DEFAULT_LOOKBACK_MINUTES = 5;
const MAX_LOOKBACK_MINUTES = 60;
const LIMIT = 20;
const FIELDS = [
  "Id",
  "CreatedDate",
  "Action",
  "Section",
  "Display",
  "DelegateUser",
  "ResponsibleNamespacePrefix",
  "CreatedBy.Name",
] as const;

export async function fetchSetupAuditTrail(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: { target_org?: string; auditLookbackMinutes?: number },
  signal?: AbortSignal,
): Promise<SetupAuditTrailSummary> {
  const targetOrg = await resolveTargetOrg(pi, ctx, input.target_org);
  const lookbackMinutes = clampLookback(input.auditLookbackMinutes);
  if (!targetOrg) {
    return { status: "skipped", lookbackMinutes, error: "No Salesforce target org resolved." };
  }

  const now = new Date();
  const start = new Date(now.getTime() - lookbackMinutes * 60_000);
  const query = [
    `SELECT ${FIELDS.join(", ")}`,
    "FROM SetupAuditTrail",
    `WHERE CreatedDate >= ${soqlDateTime(start)}`,
    `AND CreatedDate <= ${soqlDateTime(new Date(now.getTime() + 30_000))}`,
    "ORDER BY CreatedDate DESC",
    `LIMIT ${LIMIT}`,
  ].join(" ");

  try {
    const [file, fileArgs] = spawnCommand("sf", [
      "data",
      "query",
      "--json",
      "-o",
      targetOrg,
      "-q",
      query,
    ]);
    const result = await pi.exec(file, fileArgs, {
      cwd: ctx.cwd,
      signal,
      timeout: 30_000,
    });
    if (result.code !== 0) {
      return {
        status: "unavailable",
        targetOrg,
        query,
        lookbackMinutes,
        error: redactText([result.stderr, result.stdout].filter(Boolean).join("\n").trim()),
      };
    }
    const parsed = JSON.parse(result.stdout) as { result?: { records?: SetupAuditTrailRow[] } };
    const rows = parsed.result?.records ?? [];
    return { status: "queried", targetOrg, query, lookbackMinutes, rows, rowCount: rows.length };
  } catch (error) {
    return {
      status: "unavailable",
      targetOrg,
      query,
      lookbackMinutes,
      error: redactText(error instanceof Error ? error.message : String(error)),
    };
  }
}

export function summarizeSetupAuditTrail(summary: SetupAuditTrailSummary): string[] {
  if (summary.status === "skipped") {
    return [`Setup Audit Trail: skipped${summary.error ? ` (${summary.error})` : ""}`];
  }
  if (summary.status === "unavailable") {
    return [
      "Setup Audit Trail: unavailable",
      summary.error ? `Audit error: ${summary.error}` : undefined,
    ].filter((line): line is string => !!line);
  }
  const rows = summary.rows ?? [];
  if (!rows.length) {
    return [`Setup Audit Trail: queried; no rows in last ${summary.lookbackMinutes}m.`];
  }
  return [
    `Setup Audit Trail: ${rows.length} row(s) in last ${summary.lookbackMinutes}m.`,
    ...rows.slice(0, 5).map(formatAuditRow),
  ];
}

function formatAuditRow(row: SetupAuditTrailRow): string {
  return [
    row.CreatedDate,
    row.Action,
    row.Section,
    row.Display,
    row.CreatedBy?.Name ? `by ${row.CreatedBy.Name}` : undefined,
  ]
    .filter(Boolean)
    .join(" — ");
}

function clampLookback(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LOOKBACK_MINUTES;
  return Math.min(MAX_LOOKBACK_MINUTES, Math.max(1, Math.floor(value as number)));
}

function soqlDateTime(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}
