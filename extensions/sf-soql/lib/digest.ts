/* SPDX-License-Identifier: Apache-2.0 */
/** SOQL Run Digest builders. */

import type {
  DigestRow,
  SfSoqlAction,
  SoqlApiCallRailItem,
  SoqlArtifact,
  SoqlFinding,
  SoqlPlanDigest,
  SoqlQueryShape,
  SoqlResultDigest,
  SoqlRunDigest,
  SoqlRunSection,
  ToolResult,
} from "./types.ts";

export function buildDigest(params: {
  action: SfSoqlAction;
  status: SoqlRunDigest["status"];
  icon: string;
  title: string;
  org?: SoqlRunDigest["org"];
  meta?: string[];
  query?: SoqlQueryShape;
  validation?: SoqlRunDigest["validation"];
  plan?: SoqlPlanDigest;
  result?: SoqlResultDigest;
  api_calls?: SoqlApiCallRailItem[];
  sections: SoqlRunSection[];
  artifacts?: SoqlArtifact[];
  output_mode?: SoqlRunDigest["output_mode"];
  schema_preview?: SoqlRunDigest["schema_preview"];
}): SoqlRunDigest {
  return { kind: "soql_run", ...params };
}

export function row(icon: string, label: string, value: unknown): DigestRow {
  return {
    icon,
    label,
    value: value === undefined || value === null || value === "" ? "—" : String(value),
  };
}

export function section(icon: string, title: string, rows: DigestRow[]): SoqlRunSection {
  return { icon, title, rows };
}

export function textForDigest(digest: SoqlRunDigest): string {
  const bits = [digest.title, digest.meta?.join(" · ")].filter(Boolean).join(" · ");
  const findings =
    digest.validation?.findings?.filter((finding) => finding.severity !== "info").length ?? 0;
  const rows = digest.result?.rows_returned;
  const lines = [
    `${digest.status.toUpperCase()}: ${bits}`,
    digest.query?.normalized ? `Query: ${digest.query.normalized}` : undefined,
    rows !== undefined ? `Rows returned: ${rows}` : undefined,
    findings ? `Findings: ${findings}` : undefined,
  ].filter((line): line is string => Boolean(line));

  appendSchemaPreview(lines, digest);
  appendValidationFindings(lines, digest);
  appendRowPreview(lines, digest);
  appendArtifacts(lines, digest);

  return lines.join("\n");
}

function appendSchemaPreview(lines: string[], digest: SoqlRunDigest): void {
  const preview = digest.schema_preview;
  if (!preview?.fields.length || digest.output_mode === "file_only") return;
  lines.push("", "Field Preview:");
  const inline = digest.output_mode === "inline";
  const headers = inline
    ? [
        "name",
        "type",
        "filterable",
        "sortable",
        "relationship",
        "referenceTo",
        "nillable",
        "custom",
      ]
    : ["name", "type", "filterable", "sortable"];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const field of preview.fields) {
    const values = inline
      ? [
          field.name,
          field.type ?? "—",
          boolText(field.filterable),
          boolText(field.sortable),
          field.relationshipName ?? "—",
          field.referenceTo?.join(", ") || "—",
          boolText(field.nillable),
          boolText(field.custom),
        ]
      : [field.name, field.type ?? "—", boolText(field.filterable), boolText(field.sortable)];
    lines.push(`| ${values.map(escapeTableCell).join(" | ")} |`);
  }
  const hidden = preview.total_fields - preview.fields.length;
  if (hidden > 0) lines.push(`+${hidden} more fields in artifacts/details.`);
}

function appendValidationFindings(lines: string[], digest: SoqlRunDigest): void {
  const findings = digest.validation?.findings ?? [];
  if (!findings.length || digest.output_mode === "file_only") return;
  const max = digest.output_mode === "inline" ? 10 : 5;
  const visible = (
    digest.output_mode === "inline"
      ? findings
      : findings.filter((finding) => finding.severity !== "info")
  ).slice(0, max);
  if (!visible.length) return;
  lines.push("", "Findings:");
  for (const finding of visible) {
    lines.push(`- [${finding.severity}] ${finding.label}: ${finding.message}`);
  }
  const hidden = findings.length - visible.length;
  if (hidden > 0) lines.push(`+${hidden} more findings in details.`);
}

function appendRowPreview(lines: string[], digest: SoqlRunDigest): void {
  const sampleRows = digest.result?.sample_rows ?? [];
  if (!sampleRows.length || digest.output_mode === "file_only") return;
  const maxFields = digest.output_mode === "inline" ? 8 : 5;
  const maxCell = digest.output_mode === "inline" ? 160 : 100;
  const columns = (
    digest.result?.columns?.length ? digest.result.columns : Object.keys(sampleRows[0] ?? {})
  ).slice(0, maxFields);
  if (!columns.length) return;
  lines.push("", "Row Preview:");
  lines.push(`| ${columns.map(escapeTableCell).join(" | ")} |`);
  lines.push(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const sample of sampleRows) {
    lines.push(
      `| ${columns.map((column) => escapeTableCell(clipCell(sample[column], maxCell))).join(" | ")} |`,
    );
  }
  const hiddenRows = Math.max(
    0,
    (digest.result?.rows_returned ?? sampleRows.length) - sampleRows.length,
  );
  const hiddenColumns = Math.max(
    0,
    (digest.result?.columns?.length ?? columns.length) - columns.length,
  );
  if (hiddenRows > 0 || hiddenColumns > 0) {
    lines.push(
      [
        hiddenRows > 0 ? `+${hiddenRows} more rows` : undefined,
        hiddenColumns > 0 ? `+${hiddenColumns} more columns` : undefined,
      ]
        .filter(Boolean)
        .join("; ") + " in artifacts.",
    );
  }
}

function appendArtifacts(lines: string[], digest: SoqlRunDigest): void {
  const artifacts = digest.artifacts ?? [];
  if (!artifacts.length) return;
  lines.push("", "Artifacts:");
  for (const artifact of artifacts.slice(0, 6)) {
    lines.push(`- ${artifactLabel(artifact.kind)}: ${artifact.path}`);
  }
  if (artifacts.length > 6) lines.push(`+${artifacts.length - 6} more artifacts in details.`);
}

function artifactLabel(kind: string): string {
  return kind
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function boolText(value: boolean | undefined): string {
  return value === undefined ? "—" : value ? "yes" : "no";
}

function clipCell(value: unknown, max: number): string {
  const text = value === undefined || value === null || value === "" ? "—" : String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeTableCell(value: unknown): string {
  return String(value ?? "—")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|");
}

export function toolResultFromDigest(digest: SoqlRunDigest): ToolResult {
  return {
    content: [{ type: "text", text: textForDigest(digest) }],
    details: {
      ok: digest.status !== "fail",
      digest,
      ...(shouldRecommendQueryingSkill(digest.action)
        ? { recommended_skills: ["querying-soql"] }
        : {}),
    },
  };
}

function shouldRecommendQueryingSkill(action: string): boolean {
  return [
    "query.draft",
    "query.validate",
    "query.explain",
    "query.run",
    "query.sample",
    "query.count",
    "query.queryAll",
    "file.diagnose",
    "sosl.run",
  ].includes(action);
}

export function finding(
  severity: SoqlFinding["severity"],
  icon: string,
  label: string,
  message: string,
): SoqlFinding {
  return { severity, icon, label, message };
}
