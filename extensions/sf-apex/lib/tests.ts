/* SPDX-License-Identifier: Apache-2.0 */
/** Targeted Apex test execution through the public @salesforce/apex-node TestService. */

import type { Connection } from "@salesforce/core";
import { Duration } from "@salesforce/kit";
import { TestLevel, TestService } from "@salesforce/apex-node";
import { apiVersion, toolingQuery } from "./api.ts";
import { artifactTimestamp, writeApexArtifact } from "./artifacts.ts";
import { buildApexDigest, formatMs, plural } from "./digest.ts";
import { fail, ok } from "./result.ts";
import { escapeSoql } from "./soql.ts";
import { buildApexTestPayloadItems } from "./test-targets.ts";
import type { ApexArtifact, SfApexParams, SfApexSessionState, ToolResult } from "./types.ts";

type ApexNodePayload = Record<string, unknown>;
type ApexNodeTestResult = {
  summary?: Record<string, unknown>;
  tests?: Array<Record<string, unknown>>;
  setup?: Array<Record<string, unknown>>;
  codecoverage?: Array<Record<string, unknown>>;
};
type ApexNodeRunIdResult = { testRunId: string };

export async function runTest(
  conn: Connection,
  params: SfApexParams,
  state: SfApexSessionState,
): Promise<ToolResult> {
  const tests = params.tests ?? [];
  const classNames = params.class_names ?? [];
  if (tests.length === 0 && classNames.length === 0)
    return fail("Provide tests or class_names for test.run.", { kind: "apex_test" });

  const includeCoverage = params.include_coverage === true;
  const waitSeconds = params.wait_seconds ?? 60;
  const service = new TestService(conn);
  const payload = await buildApexNodePayload(conn, service, tests, classNames, includeCoverage);
  state.lastTestSpec = {
    tests: params.tests,
    class_names: params.class_names,
    include_coverage: params.include_coverage,
    target_org: params.target_org,
  };

  const result = (await service.runTestAsynchronous(
    payload as Parameters<TestService["runTestAsynchronous"]>[0],
    includeCoverage,
    waitSeconds <= 0,
    undefined,
    undefined,
    waitSeconds > 0 ? Duration.seconds(waitSeconds) : undefined,
  )) as ApexNodeTestResult | ApexNodeRunIdResult | null;

  if (!result)
    return fail("Apex test run was cancelled before producing a result.", { kind: "apex_test" });
  if (isRunIdResult(result)) {
    state.lastTestRunId = result.testRunId;
    return queuedTestResult(params, result.testRunId, payload, includeCoverage, apiVersion(conn));
  }

  const runId = testRunIdFromResult(result) ?? "unknown";
  if (runId !== "unknown") state.lastTestRunId = runId;
  return formatApexNodeTestResult(conn, params, runId, payload, result, includeCoverage, true);
}

export async function testResult(
  conn: Connection,
  params: SfApexParams,
  state?: SfApexSessionState,
): Promise<ToolResult> {
  const runId = params.run_id ?? state?.lastTestRunId;
  if (!runId) return fail("run_id is required for test.result.", { kind: "apex_test" });

  const waitSeconds = params.wait_seconds ?? 60;
  const job = await waitForTestJob(conn, runId, waitSeconds);
  const status = String(job?.Status ?? "");
  if (!isFinishedStatus(status)) {
    return queuedTestResult(
      params,
      runId,
      { run_id: runId },
      params.include_coverage === true,
      apiVersion(conn),
      {
        job,
        timed_out: true,
        wait_seconds: waitSeconds,
      },
    );
  }

  const includeCoverage = params.include_coverage === true;
  const service = new TestService(conn);
  const result = (await service.reportAsyncResults(
    runId,
    includeCoverage,
  )) as ApexNodeTestResult | null;
  if (!result)
    return fail(`No Apex test result available for run_id ${runId}.`, { kind: "apex_test" });
  return formatApexNodeTestResult(
    conn,
    params,
    runId,
    { run_id: runId },
    result,
    includeCoverage,
    false,
  );
}

export async function rerunTest(
  conn: Connection,
  params: SfApexParams,
  state: SfApexSessionState,
): Promise<ToolResult> {
  if (!state.lastTestSpec) return fail("No prior test.run in this session.", { kind: "apex_test" });
  return runTest(conn, { ...params, ...state.lastTestSpec, action: "test.rerun" }, state);
}

async function buildApexNodePayload(
  conn: Connection,
  service: TestService,
  tests: string[],
  classNames: string[],
  includeCoverage: boolean,
): Promise<ApexNodePayload> {
  const skipCodeCoverage = !includeCoverage;
  if (tests.length > 0 && classNames.length > 0) {
    return {
      tests: await buildApexTestPayloadItems(conn, tests, classNames),
      testLevel: TestLevel.RunSpecifiedTests,
      skipCodeCoverage,
    };
  }
  return (await service.buildAsyncPayload(
    TestLevel.RunSpecifiedTests,
    tests.length ? tests.join(",") : undefined,
    classNames.length ? classNames.join(",") : undefined,
    undefined,
    undefined,
    skipCodeCoverage,
  )) as ApexNodePayload;
}

async function formatApexNodeTestResult(
  conn: Connection,
  params: SfApexParams,
  runId: string,
  payload: ApexNodePayload,
  result: ApexNodeTestResult,
  includeCoverage: boolean,
  includesStartCall: boolean,
): Promise<ToolResult> {
  const summary = summarizeTestResults(result.tests ?? [], result.summary);
  const stamp = artifactTimestamp();
  const artifact = await writeApexArtifact("tests", `${stamp}-${runId}.json`, {
    payload,
    result,
  });
  const text = renderTestSummary(summary, result.tests ?? []);
  return ok(text, {
    kind: "apex_test",
    async_job_id: runId,
    test_result_summary: result.summary,
    tests_sample: (result.tests ?? []).slice(0, 25),
    setup_sample: (result.setup ?? []).slice(0, 10),
    codecoverage_sample: (result.codecoverage ?? []).slice(0, 10),
    counts: {
      tests: result.tests?.length ?? 0,
      setup: result.setup?.length ?? 0,
      codecoverage: result.codecoverage?.length ?? 0,
    },
    summary,
    include_coverage: includeCoverage,
    artifacts: [artifact],
    digest: buildTestRunDigest(
      params,
      runId,
      result,
      summary,
      [artifact],
      apiVersion(conn),
      includeCoverage,
      includesStartCall,
    ),
  });
}

function queuedTestResult(
  params: SfApexParams,
  runId: string,
  payload: ApexNodePayload,
  includeCoverage: boolean,
  version: string,
  extra: Record<string, unknown> = {},
): ToolResult {
  return ok(`Apex test run queued: ${runId}.`, {
    kind: "apex_test",
    async_job_id: runId,
    payload,
    include_coverage: includeCoverage,
    ...extra,
    digest: buildApexDigest({
      action: params.action,
      kind: "apex_test",
      status: extra.timed_out ? "warning" : "info",
      icon: "🧪",
      title: extra.timed_out ? "Apex Test Report · still running" : "Apex Test Report · queued",
      orgAlias: params.target_org,
      apiVersion: version,
      meta: [`run=${shortId(runId)}`],
      apiCalls: [
        {
          method: params.action === "test.result" ? "GET" : "POST",
          path:
            params.action === "test.result"
              ? "/tooling/query AsyncApexJob"
              : "/tooling/runTestsAsynchronous",
          detail: `@salesforce/apex-node TestService · coverage=${includeCoverage ? "yes" : "no"}`,
        },
      ],
      summaryRows: [
        {
          icon: extra.timed_out ? "⏳" : "🔄",
          label: "Outcome",
          value: extra.timed_out ? "still running" : "test run queued",
        },
        { icon: "📦", label: "Scope", value: payloadScope(payload) },
        {
          icon: includeCoverage ? "📈" : "⚪",
          label: "Coverage",
          value: includeCoverage ? "requested" : "not requested",
        },
      ],
      evidenceRows: [{ icon: "🧾", label: "Run Id", value: runId }],
      nextRows: [{ icon: "🧭", label: "Recommend", value: "poll with sf_apex test.result" }],
    }),
  });
}

function buildTestRunDigest(
  params: SfApexParams,
  runId: string,
  result: ApexNodeTestResult,
  summary: { total: number; passing: number; failing: number },
  artifacts: ApexArtifact[],
  version: string,
  includeCoverage: boolean,
  includesStartCall: boolean,
) {
  const tests = result.tests ?? [];
  const failed = failedTests(tests);
  const classes = new Set(
    tests.map((test) => apexClassName(test)).filter((name): name is string => Boolean(name)),
  );
  const runTimeMs =
    numberValue(result.summary?.testTotalTimeInMs) ??
    numberValue(result.summary?.testExecutionTimeInMs);
  const outcome =
    stringValue(result.summary?.outcome) ?? (summary.failing === 0 ? "Passed" : "Failed");
  return buildApexDigest({
    action: params.action,
    kind: "apex_test",
    status: summary.failing === 0 ? "pass" : "fail",
    icon: "🧪",
    title: `Apex Test Run · ${summary.failing === 0 ? "passed" : "failed"}`,
    orgAlias: params.target_org,
    apiVersion: version,
    mode: "API-native · @salesforce/apex-node TestService",
    meta: [`run=${shortId(runId)}`, formatMs(runTimeMs)].filter((item): item is string =>
      Boolean(item),
    ),
    apiCalls: testResultApiCalls(params, runId, tests.length, includeCoverage, includesStartCall),
    sections: [
      {
        icon: "🧾",
        title: "Run Summary",
        rows: [
          {
            icon: summary.failing === 0 ? "✅" : "❌",
            label: "Outcome",
            value:
              summary.failing === 0
                ? `${summary.passing}/${summary.total} passing`
                : `${summary.passing}/${summary.total} passing · ${summary.failing} failing`,
          },
          {
            icon: "📦",
            label: "Scope",
            value: `${plural(classes.size || 1, "class", "classes")} · ${plural(summary.total, "method")}`,
          },
          { icon: "🧭", label: "Job", value: outcome },
          coverageSummaryRow(result, includeCoverage),
        ].filter((row): row is { icon: string; label: string; value: string } => Boolean(row)),
      },
      {
        icon: "🧯",
        title: "Failures",
        rows:
          failed.length === 0
            ? [{ icon: "✅", label: "None", value: "all methods passed" }]
            : failed.slice(0, 5).map((test) => ({
                icon: "🔥",
                label: stringValue(test.methodName) ?? stringValue(test.fullName) ?? "method",
                value: stringValue(test.message) ?? stringValue(test.stackTrace) ?? "failed",
              })),
      },
      {
        icon: "🐢",
        title: "Slowest Methods",
        rows: slowestMethodRows(tests),
      },
      ...(includeCoverage ? coverageSections(result) : []),
    ],
    evidenceRows: [
      { icon: "🧾", label: "Run Id", value: runId },
      { icon: "📁", label: "Saved", value: artifactSummary(artifacts) },
    ],
    nextRows: [
      {
        icon: "🧭",
        label: "Recommend",
        value:
          summary.failing === 0
            ? includeCoverage
              ? "review coverage evidence or widen related tests"
              : "widen related tests or request coverage evidence when useful"
            : "inspect failures, fix, and rerun focused tests",
      },
    ],
    artifacts,
  });
}

function testResultApiCalls(
  params: SfApexParams,
  runId: string,
  methodCount: number,
  includeCoverage: boolean,
  includesStartCall: boolean,
) {
  const startCall =
    includesStartCall && params.action !== "test.result"
      ? [
          {
            method: "POST",
            path: "/tooling/runTestsAsynchronous",
            detail: `@salesforce/apex-node TestService · coverage=${includeCoverage ? "yes" : "no"}`,
          },
        ]
      : [];
  return [
    ...startCall,
    { method: "GET", path: "/tooling/query ApexTestRunResult", detail: `run=${shortId(runId)}` },
    {
      method: "GET",
      path: "/tooling/query ApexTestResult",
      detail: `methods=${methodCount}`,
    },
    ...(includeCoverage
      ? [
          {
            method: "GET",
            path: "/tooling/query ApexCodeCoverage*",
            detail: "coverage evidence",
          },
        ]
      : []),
  ];
}

async function waitForTestJob(
  conn: Connection,
  runId: string,
  waitSeconds: number,
): Promise<Record<string, unknown> | undefined> {
  const deadline = Date.now() + waitSeconds * 1000;
  let job: Record<string, unknown> | undefined;
  do {
    job = (
      await toolingQuery<Record<string, unknown>>(
        conn,
        `SELECT Id, Status, JobType, CreatedDate, CompletedDate, NumberOfErrors, JobItemsProcessed, TotalJobItems, ExtendedStatus FROM AsyncApexJob WHERE Id = '${escapeSoql(runId)}' LIMIT 1`,
      )
    ).records[0];
    if (isFinishedStatus(String(job?.Status ?? ""))) return job;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  } while (Date.now() < deadline);
  return job;
}

function isFinishedStatus(status: string): boolean {
  return ["Completed", "Failed", "Aborted"].includes(status);
}

function isRunIdResult(
  value: ApexNodeTestResult | ApexNodeRunIdResult,
): value is ApexNodeRunIdResult {
  return typeof (value as ApexNodeRunIdResult).testRunId === "string" && !("summary" in value);
}

function testRunIdFromResult(result: ApexNodeTestResult): string | undefined {
  return stringValue(result.summary?.testRunId);
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 3)}…${value.slice(-4)}` : value;
}

function slowestMethodRows(tests: Record<string, unknown>[]) {
  const rows = [...tests]
    .filter((test) => typeof test.runTime === "number")
    .sort((a, b) => Number(b.runTime) - Number(a.runTime))
    .slice(0, 3)
    .map((test, index) => ({
      icon: index === 0 ? "🐢" : "⏱️",
      label: `${index + 1}.`,
      value: `${stringValue(test.methodName) ?? stringValue(test.fullName) ?? "method"} · ${formatMs(Number(test.runTime))}`,
    }));
  return rows.length > 0
    ? rows
    : [{ icon: "⚪", label: "None", value: "method runtime unavailable" }];
}

function coverageSummaryRow(result: ApexNodeTestResult, includeCoverage: boolean) {
  if (!includeCoverage) return { icon: "⚪", label: "Coverage", value: "not requested" };
  const testRunCoverage = stringValue(result.summary?.testRunCoverage);
  const orgWideCoverage = stringValue(result.summary?.orgWideCoverage);
  return {
    icon: "📈",
    label: "Coverage",
    value:
      [
        testRunCoverage ? `run ${testRunCoverage}` : undefined,
        orgWideCoverage ? `org ${orgWideCoverage}` : undefined,
      ]
        .filter(Boolean)
        .join(" · ") || "requested",
  };
}

function coverageSections(result: ApexNodeTestResult) {
  const coverage = result.codecoverage ?? [];
  if (!coverage.length) {
    return [
      {
        icon: "📈",
        title: "Coverage Evidence",
        rows: [{ icon: "⚪", label: "Coverage", value: "no coverage rows returned" }],
      },
    ];
  }
  const rows = [...coverage]
    .sort((a, b) => percentageNumber(a.percentage) - percentageNumber(b.percentage))
    .slice(0, 5)
    .map((item) => ({
      icon: percentageNumber(item.percentage) >= 75 ? "🟢" : "🟡",
      label: stringValue(item.name) ?? shortId(String(item.apexId ?? "class")),
      value: `${item.percentage ?? "?"} · ${item.numLinesCovered ?? 0}/${Number(item.numLinesCovered ?? 0) + Number(item.numLinesUncovered ?? 0)} covered`,
    }));
  return [{ icon: "📈", title: "Coverage Evidence", rows }];
}

function artifactSummary(artifacts: ApexArtifact[]): string {
  if (artifacts.length === 0) return "none";
  const kinds = [...new Set(artifacts.map((artifact) => artifact.kind))];
  return `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"} · ${kinds.join(" + ")}`;
}

export function summarizeTestResults(
  tests: Record<string, unknown>[],
  summary?: Record<string, unknown>,
): { total: number; passing: number; failing: number } {
  const summaryTotal = numberValue(summary?.testsRan);
  const summaryPassing = numberValue(summary?.passing);
  const summaryFailing = numberValue(summary?.failing);
  if (summaryTotal !== undefined && summaryPassing !== undefined && summaryFailing !== undefined) {
    return { total: summaryTotal, passing: summaryPassing, failing: summaryFailing };
  }
  const failed = failedTests(tests);
  return {
    total: tests.length,
    passing: tests.length - failed.length,
    failing: failed.length,
  };
}

function renderTestSummary(
  summary: { total: number; passing: number; failing: number },
  tests: Record<string, unknown>[],
): string {
  const failed = failedTests(tests);
  return [
    `Apex tests ${summary.failing === 0 ? "passed" : "failed"}: ${summary.passing}/${summary.total} passing.`,
    ...failed
      .slice(0, 5)
      .map(
        (item) =>
          `${stringValue(item.methodName) ?? stringValue(item.fullName) ?? "method"}: ${stringValue(item.message) ?? stringValue(item.stackTrace) ?? "failed"}`,
      ),
  ].join("\n");
}

function failedTests(tests: Record<string, unknown>[]): Record<string, unknown>[] {
  return tests.filter((test) => {
    const outcome = stringValue(test.outcome) ?? stringValue(test.Outcome);
    return outcome !== "Pass";
  });
}

function apexClassName(test: Record<string, unknown>): string | undefined {
  const apexClass = test.apexClass;
  if (!apexClass || typeof apexClass !== "object") return stringValue(test.TestName);
  return (
    stringValue((apexClass as Record<string, unknown>).fullName) ??
    stringValue((apexClass as Record<string, unknown>).name)
  );
}

function payloadScope(payload: ApexNodePayload): string {
  const tests = Array.isArray(payload.tests) ? payload.tests : [];
  return tests.length ? `${plural(tests.length, "class", "classes")}` : "specified tests";
}

function percentageNumber(value: unknown): number {
  const text = String(value ?? "0").replace("%", "");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
