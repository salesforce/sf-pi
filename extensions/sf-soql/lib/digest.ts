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
  return [
    `${digest.status.toUpperCase()}: ${bits}`,
    digest.query?.normalized ? `Query: ${digest.query.normalized}` : undefined,
    rows !== undefined ? `Rows returned: ${rows}` : undefined,
    findings ? `Findings: ${findings}` : undefined,
    digest.artifacts?.length ? `Artifacts: ${digest.artifacts.length}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
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
