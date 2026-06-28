/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only Apex test suite discovery. */

import type { Connection } from "@salesforce/core";
import { TestService } from "@salesforce/apex-node";
import { apiVersion, toolingQueryAll } from "./api.ts";
import { artifactTimestamp, writeApexArtifact } from "./artifacts.ts";
import { buildApexDigest, plural } from "./digest.ts";
import { ok } from "./result.ts";
import { quoteSoql } from "./soql.ts";
import type { ApexArtifact, SfApexParams, ToolResult } from "./types.ts";

interface SuiteRow {
  id: string;
  name: string;
  members?: SuiteMemberRow[];
}

interface SuiteMemberRow extends Record<string, unknown> {
  ApexTestSuiteId: string;
  ApexClassId: string;
  ApexClass?: { Name?: string; NamespacePrefix?: string | null };
}

export async function testSuites(conn: Connection, params: SfApexParams): Promise<ToolResult> {
  const service = new TestService(conn);
  const suites = (await service.retrieveAllSuites()).map((suite) => ({
    id: suite.id,
    name: suite.TestSuiteName,
  }));
  const withMembers =
    params.include_members && suites.length
      ? await attachSuiteMembers(conn, suites)
      : suites.map((suite) => ({ ...suite, members: undefined }));
  const artifact = await writeApexArtifact("tests", `${artifactTimestamp()}-test-suites.json`, {
    include_members: params.include_members === true,
    suites: withMembers,
  });

  return ok(`Apex test suites: ${withMembers.length}.`, {
    kind: "test_suites",
    suites: withMembers,
    counts: {
      suites: withMembers.length,
      members: withMembers.reduce((sum, suite) => sum + (suite.members?.length ?? 0), 0),
    },
    artifacts: [artifact],
    digest: buildApexDigest({
      action: params.action,
      kind: "test_suites",
      status: "pass",
      icon: "🧪",
      title: "Apex Test Suites",
      orgAlias: params.target_org,
      apiVersion: apiVersion(conn),
      apiCalls: [
        { method: "GET", path: "/tooling/query ApexTestSuite", detail: "existing suites" },
        ...(params.include_members
          ? [
              {
                method: "GET",
                path: "/tooling/query TestSuiteMembership",
                detail: "suite members",
              },
            ]
          : []),
      ],
      sections: [
        {
          icon: "🎯",
          title: "Scope",
          rows: [
            { icon: "📊", label: "Suites", value: String(withMembers.length) },
            {
              icon: params.include_members ? "👥" : "⚪",
              label: "Members",
              value: params.include_members ? "included" : "not requested",
            },
          ],
        },
        {
          icon: "🧪",
          title: "Suites",
          rows: suiteRows(withMembers),
        },
      ],
      evidenceRows: [{ icon: "📁", label: "Saved", value: artifactSummary([artifact]) }],
      nextRows: [
        {
          icon: "🧭",
          label: "Recommend",
          value: withMembers.length
            ? "run an existing suite with sf_apex test.run suite_names=[...]"
            : "no existing suites; use targeted test.run instead",
        },
      ],
      artifacts: [artifact],
    }),
  });
}

async function attachSuiteMembers(
  conn: Connection,
  suites: Array<{ id: string; name: string }>,
): Promise<SuiteRow[]> {
  const ids = suites.map((suite) => quoteSoql(suite.id)).join(",");
  const members = (
    await toolingQueryAll<SuiteMemberRow>(
      conn,
      `SELECT ApexTestSuiteId, ApexClassId, ApexClass.Name, ApexClass.NamespacePrefix FROM TestSuiteMembership WHERE ApexTestSuiteId IN (${ids}) ORDER BY ApexClass.Name`,
    )
  ).records;
  const membersBySuite = new Map<string, SuiteMemberRow[]>();
  for (const member of members) {
    const rows = membersBySuite.get(member.ApexTestSuiteId) ?? [];
    rows.push(member);
    membersBySuite.set(member.ApexTestSuiteId, rows);
  }
  return suites.map((suite) => ({ ...suite, members: membersBySuite.get(suite.id) ?? [] }));
}

export function suiteRows(suites: SuiteRow[]) {
  if (!suites.length) return [{ icon: "⚪", label: "Suites", value: "none found" }];
  return suites.slice(0, 10).map((suite, index) => ({
    icon: index === 0 ? "✅" : "🧪",
    label: suite.name,
    value: `${suite.id}${suite.members ? ` · ${plural(suite.members.length, "member")}` : ""}`,
  }));
}

function artifactSummary(artifacts: ApexArtifact[]): string {
  if (artifacts.length === 0) return "none";
  const kinds = [...new Set(artifacts.map((artifact) => artifact.kind))];
  return `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"} · ${kinds.join(" + ")}`;
}
