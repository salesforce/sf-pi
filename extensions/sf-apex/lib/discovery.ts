/* SPDX-License-Identifier: Apache-2.0 */
/** Native Apex lifecycle discovery actions. */

import path from "node:path";
import type { Connection } from "@salesforce/core";
import { apiVersion, currentUserId, requestJson, toolingQuery } from "./api.ts";
import { buildApexDigest } from "./digest.ts";
import { ok } from "./result.ts";
import { escapeSoql, quoteSoql } from "./soql.ts";
import type { SfApexParams, ToolResult } from "./types.ts";
import { activeTraceFlags } from "./trace.ts";

interface ApexClassRow extends Record<string, unknown> {
  Id: string;
  Name: string;
  NamespacePrefix?: string | null;
  Status?: string;
}

interface ApexTriggerRow extends Record<string, unknown> {
  Id: string;
  Name: string;
  Status?: string;
  TableEnumOrId?: string;
}

interface ToolingTestMethod {
  name: string;
  line?: number;
  column?: number;
}

interface ToolingTestClass {
  id: string;
  name: string;
  namespacePrefix?: string;
  testMethods?: ToolingTestMethod[];
}

interface TestDiscoveryPage {
  apexTestClasses?: ToolingTestClass[];
  nextRecordsUrl?: string | null;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export async function orgPreflight(conn: Connection, params: SfApexParams): Promise<ToolResult> {
  const version = apiVersion(conn);
  const userId = await currentUserId(conn);
  const active = await activeTraceFlags(conn, params.user_id ?? userId);
  const classProbe = await toolingQuery<{ Id: string }>(conn, "SELECT Id FROM ApexClass LIMIT 1");
  const queueProbe = await toolingQuery<Record<string, unknown>>(
    conn,
    "SELECT Id, Status, JobType, CreatedDate FROM AsyncApexJob WHERE JobType = 'TestRequest' ORDER BY CreatedDate DESC LIMIT 5",
  );

  return ok(`Apex org preflight ready. API v${version}. Active trace flags: ${active.length}.`, {
    kind: "org_preflight",
    api_version: version,
    user_id: userId,
    active_trace_flags: active,
    apex_class_probe: classProbe.totalSize,
    recent_test_jobs: queueProbe.records,
    digest: buildApexDigest({
      action: params.action,
      kind: "org_preflight",
      status: "pass",
      icon: "🩺",
      title: "Apex Org Preflight · ready",
      orgAlias: params.target_org,
      apiVersion: version,
      userId,
      apiCalls: [
        { method: "GET", path: "/oauth2/userinfo", detail: "current user" },
        { method: "GET", path: "/tooling/query ApexClass", detail: "queryability probe · limit=1" },
        { method: "GET", path: "/tooling/query TraceFlag", detail: "active SF Pi traces" },
        {
          method: "GET",
          path: "/tooling/query AsyncApexJob",
          detail: "JobType=TestRequest · limit=5",
        },
      ],
      sections: [
        {
          icon: "✅",
          title: "Readiness",
          rows: [
            { icon: "🟢", label: "Connection", value: "ready" },
            { icon: "🌐", label: "API", value: `v${version}` },
            { icon: "👤", label: "User", value: userId },
            {
              icon: "📦",
              label: "ApexClass",
              value: classProbe.totalSize >= 0 ? "queryable" : "unknown",
            },
            {
              icon: active.length ? "🟢" : "⚪",
              label: "TraceFlags",
              value: `${active.length} active`,
            },
          ],
        },
        {
          icon: "🧪",
          title: "Recent Test Queue",
          rows: queueProbe.records.length
            ? queueProbe.records.map((job) => ({
                icon: "🧾",
                label: String(job.Status ?? "Job"),
                value: `${job.Id ?? "unknown"} · ${job.CreatedDate ?? "unknown date"}`,
              }))
            : [{ icon: "⚪", label: "Recent", value: "no recent test jobs found" }],
        },
      ],
      nextRows: [
        {
          icon: "🧭",
          label: "Recommend",
          value: "search Apex, discover tests, or start the lifecycle plan",
        },
      ],
    }),
  });
}

export async function apexSearch(conn: Connection, params: SfApexParams): Promise<ToolResult> {
  const limit = boundedLimit(params.limit);
  const term = (params.query ?? params.target ?? "").trim();
  const classRows = await queryApexClasses(conn, term, limit, params.test_only === true);
  const triggerRows = params.test_only ? [] : await queryApexTriggers(conn, term, limit);
  const total = classRows.length + triggerRows.length;

  return ok(`Apex search found ${total} result(s).`, {
    kind: "apex_search",
    query: term,
    classes: classRows,
    triggers: triggerRows,
    digest: buildApexDigest({
      action: params.action,
      kind: "apex_search",
      status: "pass",
      icon: "🔎",
      title: "Apex Search · results",
      orgAlias: params.target_org,
      apiVersion: apiVersion(conn),
      apiCalls: [
        {
          method: "GET",
          path: "/tooling/query ApexClass",
          detail: `${term ? `Name LIKE '%${term}%'` : "active classes"} · limit=${limit}`,
        },
        ...(params.test_only
          ? []
          : [
              {
                method: "GET",
                path: "/tooling/query ApexTrigger",
                detail: `${term ? `Name LIKE '%${term}%'` : "active triggers"} · limit=${limit}`,
              },
            ]),
      ],
      sections: [
        {
          icon: "🔎",
          title: "Search",
          rows: [
            { icon: "🔤", label: "Query", value: term || "all active Apex" },
            { icon: "🧪", label: "Test only", value: params.test_only ? "yes" : "no" },
            { icon: "📊", label: "Results", value: `${total} total` },
          ],
        },
        {
          icon: "📦",
          title: "Matches",
          rows: matchRows(classRows, triggerRows),
        },
      ],
      nextRows: [
        {
          icon: "🧭",
          label: "Recommend",
          value: "use test.discover or diagnose.file on the target",
        },
      ],
    }),
  });
}

export async function testDiscover(conn: Connection, params: SfApexParams): Promise<ToolResult> {
  const limit = boundedLimit(params.limit);
  const hints = testNameHints(params);
  const discovery = await discoverApexTests(conn, params, limit, hints);
  const candidates = discovery.classes;

  return ok(`Discovered ${candidates.length} Apex test candidate(s).`, {
    kind: "test_discover",
    hints,
    candidates,
    flow_tests_omitted: discovery.flowTestsOmitted,
    discovery_mode: discovery.mode,
    digest: buildApexDigest({
      action: params.action,
      kind: "test_discover",
      status: "pass",
      icon: "🧪",
      title: "Apex Test Discovery · candidates",
      orgAlias: params.target_org,
      apiVersion: apiVersion(conn),
      apiCalls: [
        discovery.mode === "tooling_tests"
          ? {
              method: "GET",
              path: "/tooling/tests",
              detail: `showAllMethods=true · Apex only · limit=${limit}`,
            }
          : {
              method: "GET",
              path: "/tooling/query ApexClass",
              detail: hints.length
                ? `Name IN/LIKE ${compactList(hints)} · testOnly · limit=${limit}`
                : `Name LIKE '%Test%' · limit=${limit}`,
            },
      ],
      sections: [
        {
          icon: "🎯",
          title: "Discovery Scope",
          rows: [
            {
              icon: "📄",
              label: "Targets",
              value: compactList(targetInputs(params)) || "not specified",
            },
            { icon: "🧪", label: "Hints", value: compactList(hints) || "workspace test classes" },
            { icon: "📊", label: "Found", value: `${candidates.length} candidate(s)` },
            discovery.flowTestsOmitted
              ? {
                  icon: "🌊",
                  label: "Omitted",
                  value: `${discovery.flowTestsOmitted} Flow test(s)`,
                }
              : undefined,
          ].filter((row): row is { icon: string; label: string; value: string } => Boolean(row)),
        },
        {
          icon: "🧪",
          title: "Candidates",
          rows: classRows(candidates),
        },
      ],
      nextRows: [
        {
          icon: "🧭",
          label: "Recommend",
          value: "run the smallest useful candidate with test.run",
        },
      ],
    }),
  });
}

async function discoverApexTests(
  conn: Connection,
  params: SfApexParams,
  limit: number,
  hints: string[],
): Promise<{
  classes: Array<ApexClassRow & { testMethods?: ToolingTestMethod[] }>;
  flowTestsOmitted: number;
  mode: "tooling_tests" | "heuristic";
}> {
  try {
    const classes: Array<ApexClassRow & { testMethods?: ToolingTestMethod[] }> = [];
    let flowTestsOmitted = 0;
    let nextUrl: string | undefined =
      `/services/data/v${Math.max(Number(apiVersion(conn)), 65).toFixed(1)}/tooling/tests?showAllMethods=true`;
    let pages = 0;
    while (nextUrl && pages < 25) {
      pages += 1;
      const page = await requestJson<TestDiscoveryPage>(conn, "GET", nextUrl, undefined, {
        Accept: "application/json",
        "X-Chatter-Entity-Encoding": "false",
      });
      for (const item of page.apexTestClasses ?? []) {
        if (isFlowTestClass(item)) {
          flowTestsOmitted += 1;
          continue;
        }
        const candidate = normalizeTestClass(item);
        if (!matchesTestDiscoveryFilters(candidate, params, hints)) continue;
        classes.push(candidate);
        if (classes.length >= limit) break;
      }
      if (classes.length >= limit) break;
      nextUrl = page.nextRecordsUrl ?? undefined;
    }
    return { classes, flowTestsOmitted, mode: "tooling_tests" };
  } catch {
    const classes = hints.length
      ? await queryClassesByNamesOrLike(conn, hints, limit, true)
      : await queryApexClasses(conn, params.query ?? "Test", limit, true);
    return { classes, flowTestsOmitted: 0, mode: "heuristic" };
  }
}

function normalizeTestClass(
  item: ToolingTestClass,
): ApexClassRow & { testMethods?: ToolingTestMethod[] } {
  return {
    Id: item.id,
    Name: item.name,
    NamespacePrefix: item.namespacePrefix || undefined,
    Status: "Active",
    testMethods: item.testMethods ?? [],
  };
}

function isFlowTestClass(item: ToolingTestClass): boolean {
  return (
    item.namespacePrefix?.startsWith("FlowTesting") === true || item.name.startsWith("FlowTesting.")
  );
}

function matchesTestDiscoveryFilters(
  candidate: ApexClassRow & { testMethods?: ToolingTestMethod[] },
  params: SfApexParams,
  hints: string[],
): boolean {
  const haystack = [
    candidate.Name,
    candidate.NamespacePrefix,
    ...(candidate.testMethods?.map((method) => method.name) ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hints.length > 0) return hints.some((hint) => haystack.includes(hint.toLowerCase()));
  const query = (params.query ?? "").trim().toLowerCase();
  return !query || haystack.includes(query);
}

export async function testPlan(conn: Connection, params: SfApexParams): Promise<ToolResult> {
  const limit = boundedLimit(params.limit ?? 10);
  const hints = testNameHints(params);
  const discovery = await discoverApexTests(conn, params, limit, hints);
  const candidates = discovery.classes;
  const primary = candidates[0];

  return ok(
    primary
      ? `Apex test plan: start with ${primary.Name}.`
      : "Apex test plan: no candidate tests found.",
    {
      kind: "test_plan",
      hints,
      candidates,
      primary,
      digest: buildApexDigest({
        action: params.action,
        kind: "test_plan",
        status: candidates.length ? "pass" : "warning",
        icon: "🧭",
        title: "Apex Test Plan",
        orgAlias: params.target_org,
        apiVersion: apiVersion(conn),
        apiCalls: [
          discovery.mode === "tooling_tests"
            ? {
                method: "GET",
                path: "/tooling/tests",
                detail: `showAllMethods=true · rank Apex candidates · limit=${limit}`,
              }
            : {
                method: "GET",
                path: "/tooling/query ApexClass",
                detail: hints.length
                  ? `Name IN/LIKE ${compactList(hints)} · rank candidates`
                  : "test candidates · rank candidates",
              },
        ],
        sections: [
          {
            icon: "🎯",
            title: "Plan",
            rows: [
              {
                icon: primary ? "✅" : "⚠️",
                label: "Primary",
                value: primary?.Name ?? "no candidate found",
              },
              {
                icon: "📦",
                label: "Scope",
                value: primary ? "single targeted class first" : "needs discovery refinement",
              },
              { icon: "📈", label: "Widen", value: "only after focused pass" },
            ],
          },
          {
            icon: "🧪",
            title: "Candidates",
            rows: classRows(candidates),
          },
        ],
        nextRows: [
          {
            icon: "🧭",
            label: "Recommend",
            value: primary
              ? `run sf_apex test.run class_names=["${primary.Name}"]`
              : "refine target/query and rerun test.discover",
          },
        ],
      }),
    },
  );
}

async function queryApexClasses(
  conn: Connection,
  term: string,
  limit: number,
  testOnly: boolean,
): Promise<ApexClassRow[]> {
  const filters = ["Status = 'Active'"];
  if (term) filters.push(`Name LIKE '%${escapeSoql(term)}%'`);
  if (testOnly) filters.push("(Name LIKE '%Test%' OR Name LIKE '%_Test')");
  return (
    await toolingQuery<ApexClassRow>(
      conn,
      `SELECT Id, Name, NamespacePrefix, Status FROM ApexClass WHERE ${filters.join(" AND ")} ORDER BY Name LIMIT ${limit}`,
    )
  ).records;
}

async function queryApexTriggers(
  conn: Connection,
  term: string,
  limit: number,
): Promise<ApexTriggerRow[]> {
  const filters = ["Status = 'Active'"];
  if (term) filters.push(`Name LIKE '%${escapeSoql(term)}%'`);
  return (
    await toolingQuery<ApexTriggerRow>(
      conn,
      `SELECT Id, Name, Status, TableEnumOrId FROM ApexTrigger WHERE ${filters.join(" AND ")} ORDER BY Name LIMIT ${limit}`,
    )
  ).records;
}

async function queryClassesByNamesOrLike(
  conn: Connection,
  names: string[],
  limit: number,
  testOnly: boolean,
): Promise<ApexClassRow[]> {
  const filters = ["Status = 'Active'"];
  const exact = names.map(quoteSoql).join(",");
  const like = names.map((name) => `Name LIKE '%${escapeSoql(name)}%'`).join(" OR ");
  filters.push(`(Name IN (${exact}) OR ${like})`);
  if (testOnly) filters.push("(Name LIKE '%Test%' OR Name LIKE '%_Test')");
  return (
    await toolingQuery<ApexClassRow>(
      conn,
      `SELECT Id, Name, NamespacePrefix, Status FROM ApexClass WHERE ${filters.join(" AND ")} ORDER BY Name LIMIT ${limit}`,
    )
  ).records;
}

function boundedLimit(value: number | undefined): number {
  return Math.max(1, Math.min(Math.floor(value ?? DEFAULT_LIMIT), MAX_LIMIT));
}

function targetInputs(params: SfApexParams): string[] {
  return [
    ...(params.targets ?? []),
    ...(params.target ? [params.target] : []),
    ...(params.class_names ?? []),
  ].filter(Boolean);
}

function testNameHints(params: SfApexParams): string[] {
  const names = targetInputs(params).flatMap((target) => {
    const base = path.basename(target).replace(/\.(cls|trigger)$/i, "");
    if (!base) return [];
    if (/test/i.test(base)) return [base];
    return [`${base}Test`, `${base}_Test`];
  });
  return [...new Set(names)];
}

function matchRows(classes: ApexClassRow[], triggers: ApexTriggerRow[]) {
  const rows = [
    ...classes.slice(0, 8).map((klass) => ({
      icon: /test/i.test(klass.Name) ? "🧪" : "📦",
      label: "Class",
      value: `${klass.Name}${klass.NamespacePrefix ? ` · ns=${klass.NamespacePrefix}` : ""}`,
    })),
    ...triggers.slice(0, 5).map((trigger) => ({
      icon: "⚙️",
      label: "Trigger",
      value: `${trigger.Name}${trigger.TableEnumOrId ? ` · ${trigger.TableEnumOrId}` : ""}`,
    })),
  ];
  return rows.length ? rows : [{ icon: "⚪", label: "Matches", value: "none" }];
}

function classRows(classes: Array<ApexClassRow & { testMethods?: ToolingTestMethod[] }>) {
  return classes.length
    ? classes.slice(0, 10).map((klass, index) => {
        const methods = klass.testMethods ?? [];
        const methodSummary = methods.length
          ? ` · ${methods.length} method(s)${methods[0]?.name ? ` · first=${methods[0].name}` : ""}`
          : "";
        return {
          icon: index === 0 ? "✅" : "🧪",
          label: index === 0 ? "Primary" : `${index + 1}.`,
          value: `${klass.NamespacePrefix ? `${klass.NamespacePrefix}.` : ""}${klass.Name}${methodSummary}`,
        };
      })
    : [{ icon: "⚠️", label: "Candidates", value: "none found" }];
}

function compactList(values: string[]): string {
  if (values.length === 0) return "";
  const visible = values.slice(0, 3).join(", ");
  return values.length > 3 ? `${visible}, +${values.length - 3} more` : visible;
}
