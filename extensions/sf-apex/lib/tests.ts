/* SPDX-License-Identifier: Apache-2.0 */
/** Native targeted Apex test execution and result summarization. */

import type { Connection } from "@salesforce/core";
import { apiVersion, requestJson, toolingQuery } from "./api.ts";
import { artifactTimestamp, writeApexArtifact } from "./artifacts.ts";
import { buildApexDigest, formatMs, plural } from "./digest.ts";
import { fail, ok } from "./result.ts";
import { escapeSoql, quoteSoql } from "./soql.ts";
import type { SfApexParams, SfApexSessionState, ToolResult } from "./types.ts";

export async function runTest(
  conn: Connection,
  params: SfApexParams,
  state: SfApexSessionState,
): Promise<ToolResult> {
  const tests = params.tests ?? [];
  const classNames = params.class_names ?? tests.map((test) => test.split(".")[0]);
  if (classNames.length === 0)
    return fail("Provide tests or class_names for test.run.", { kind: "apex_test" });
  const classRows = await resolveApexClasses(conn, [...new Set(classNames)]);
  const payload = {
    tests: classRows.map((klass) => {
      const methods = tests
        .filter((test) => test.startsWith(`${klass.Name}.`) && test.split(".")[1])
        .map((test) => test.split(".")[1]);
      return methods.length > 0
        ? { classId: klass.Id, testMethods: methods }
        : { classId: klass.Id };
    }),
  };
  const v = apiVersion(conn);
  const jobId = await requestJson<string>(
    conn,
    "POST",
    `/services/data/v${v}/tooling/runTestsAsynchronous`,
    payload,
  );
  state.lastTestRunId = jobId;
  state.lastTestSpec = {
    tests: params.tests,
    class_names: params.class_names,
    target_org: params.target_org,
  };

  const waitSeconds = params.wait_seconds ?? 60;
  if (waitSeconds <= 0) {
    return ok(`Apex test run queued: ${jobId}.`, {
      kind: "apex_test",
      async_job_id: jobId,
      payload,
      digest: buildApexDigest({
        action: params.action,
        kind: "apex_test",
        status: "info",
        icon: "🧪",
        title: "Apex Test Report · queued",
        orgAlias: params.target_org,
        apiVersion: v,
        meta: [`run=${jobId.slice(0, 8)}…`],
        apiCalls: [
          {
            method: "POST",
            path: "/tooling/runTestsAsynchronous",
            detail: `tests[{classId}] · classes=${classRows.length}`,
          },
        ],
        summaryRows: [
          { icon: "🔄", label: "Outcome", value: "test run queued" },
          { icon: "📦", label: "Scope", value: `${plural(classRows.length, "class", "classes")}` },
        ],
        evidenceRows: [{ icon: "🧾", label: "Run Id", value: jobId }],
        nextRows: [{ icon: "🧭", label: "Recommend", value: "poll with sf_apex test.result" }],
      }),
    });
  }
  return testResult(conn, { ...params, run_id: jobId }, state);
}

export async function testResult(
  conn: Connection,
  params: SfApexParams,
  state?: SfApexSessionState,
): Promise<ToolResult> {
  const runId = params.run_id ?? state?.lastTestRunId;
  if (!runId) return fail("run_id is required for test.result.", { kind: "apex_test" });
  const waitSeconds = params.wait_seconds ?? 60;
  const deadline = Date.now() + waitSeconds * 1000;
  let job: Record<string, unknown> | undefined;
  do {
    job = (
      await toolingQuery<Record<string, unknown>>(
        conn,
        `SELECT Id, Status, JobType, CreatedDate, CompletedDate, NumberOfErrors, JobItemsProcessed, TotalJobItems, ExtendedStatus FROM AsyncApexJob WHERE Id = '${escapeSoql(runId)}' LIMIT 1`,
      )
    ).records[0];
    const status = String(job?.Status ?? "");
    if (["Completed", "Failed", "Aborted"].includes(status)) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  } while (Date.now() < deadline);

  const queueItems = (
    await toolingQuery<Record<string, unknown>>(
      conn,
      `SELECT Id, ApexClassId, Status, ExtendedStatus, ParentJobId, TestRunResultId FROM ApexTestQueueItem WHERE ParentJobId = '${escapeSoql(runId)}' ORDER BY CreatedDate DESC LIMIT 50`,
    )
  ).records;
  const testRunIds = [...new Set(queueItems.map((item) => item.TestRunResultId).filter(Boolean))];
  const runResults = testRunIds.length
    ? (
        await toolingQuery<Record<string, unknown>>(
          conn,
          `SELECT Id, AsyncApexJobId, UserId, JobName, StartTime, EndTime, TestTime, Status, ClassesEnqueued, ClassesCompleted, MethodsEnqueued, MethodsCompleted, MethodsFailed FROM ApexTestRunResult WHERE Id IN (${testRunIds.map((id) => quoteSoql(String(id))).join(",")})`,
        )
      ).records
    : [];
  const methodResults = testRunIds.length
    ? (
        await toolingQuery<Record<string, unknown>>(
          conn,
          `SELECT Id, Outcome, ApexClassId, MethodName, TestName, Message, StackTrace, RunTime, QueueItemId, ApexLogId FROM ApexTestResult WHERE ApexTestRunResultId IN (${testRunIds.map((id) => quoteSoql(String(id))).join(",")}) ORDER BY TestTimestamp DESC LIMIT 200`,
        )
      ).records
    : [];
  const summary = summarizeTestResults(methodResults);
  const stamp = artifactTimestamp();
  const artifact = await writeApexArtifact("tests", `${stamp}-${runId}.json`, {
    job,
    queueItems,
    runResults,
    methodResults,
  });
  const text = renderTestSummary(summary, methodResults);
  return ok(text, {
    kind: "apex_test",
    async_job_id: runId,
    job,
    queue_items: queueItems,
    run_results: runResults,
    method_results: methodResults,
    summary,
    artifacts: [artifact],
    digest: buildTestRunDigest(
      params,
      runId,
      job,
      queueItems,
      runResults,
      methodResults,
      summary,
      [artifact],
      apiVersion(conn),
    ),
  });
}

export async function rerunTest(
  conn: Connection,
  params: SfApexParams,
  state: SfApexSessionState,
): Promise<ToolResult> {
  if (!state.lastTestSpec) return fail("No prior test.run in this session.", { kind: "apex_test" });
  return runTest(conn, { ...params, ...state.lastTestSpec, action: "test.rerun" }, state);
}

function buildTestRunDigest(
  params: SfApexParams,
  runId: string,
  job: Record<string, unknown> | undefined,
  queueItems: Record<string, unknown>[],
  runResults: Record<string, unknown>[],
  methodResults: Record<string, unknown>[],
  summary: { total: number; passing: number; failing: number },
  artifacts: Array<{ path: string; kind: string }>,
  version: string,
) {
  const failed = methodResults.filter((result) => result.Outcome !== "Pass");
  const classes = new Set(methodResults.map((result) => result.TestName).filter(Boolean));
  const runTimeMs = runResults
    .map((result) => (typeof result.TestTime === "number" ? result.TestTime : undefined))
    .find((value) => value !== undefined);
  const jobStatus = typeof job?.Status === "string" ? job.Status : "unknown";
  return buildApexDigest({
    action: params.action,
    kind: "apex_test",
    status: summary.failing === 0 ? "pass" : "fail",
    icon: "🧪",
    title: `Apex Test Run · ${summary.failing === 0 ? "passed" : "failed"}`,
    orgAlias: params.target_org,
    apiVersion: version,
    meta: [`run=${runId.slice(0, 8)}…`, formatMs(runTimeMs)].filter((item): item is string =>
      Boolean(item),
    ),
    apiCalls: testResultApiCalls(params, runId, methodResults.length),
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
            value: `${plural(classes.size || queueItems.length, "class", "classes")} · ${plural(summary.total, "method")}`,
          },
          { icon: "🧭", label: "Job", value: jobStatus },
        ],
      },
      {
        icon: "🧯",
        title: "Failures",
        rows:
          failed.length === 0
            ? [{ icon: "✅", label: "None", value: "all methods passed" }]
            : failed.slice(0, 5).map((result) => ({
                icon: "🔥",
                label: String(result.MethodName ?? result.TestName ?? "method"),
                value: String(result.Message ?? result.StackTrace ?? "failed"),
              })),
      },
      {
        icon: "🐢",
        title: "Slowest Methods",
        rows: slowestMethodRows(methodResults),
      },
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
            ? "widen related tests or stop trace"
            : "inspect failures, fix, and rerun focused tests",
      },
    ],
    artifacts,
  });
}

function testResultApiCalls(params: SfApexParams, runId: string, methodCount: number) {
  const startCall =
    params.action === "test.result"
      ? []
      : [
          {
            method: "POST",
            path: "/tooling/runTestsAsynchronous",
            detail: params.action === "test.rerun" ? "previous spec" : "tests[{classId}]",
          },
        ];
  return [
    ...startCall,
    { method: "GET", path: "/tooling/query AsyncApexJob", detail: `WHERE Id=${shortId(runId)}` },
    {
      method: "GET",
      path: "/tooling/query ApexTestQueueItem",
      detail: `ParentJobId=${shortId(runId)}`,
    },
    { method: "GET", path: "/tooling/query ApexTestRunResult", detail: "run summary" },
    {
      method: "GET",
      path: "/tooling/query ApexTestResult",
      detail: `fields=Outcome,MethodName,Message · methods=${methodCount}`,
    },
  ];
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 3)}…${value.slice(-4)}` : value;
}

function slowestMethodRows(methodResults: Record<string, unknown>[]) {
  const rows = [...methodResults]
    .filter((result) => typeof result.RunTime === "number")
    .sort((a, b) => Number(b.RunTime) - Number(a.RunTime))
    .slice(0, 3)
    .map((result, index) => ({
      icon: index === 0 ? "🐢" : "⏱️",
      label: `${index + 1}.`,
      value: `${result.MethodName ?? result.TestName ?? "method"} · ${formatMs(Number(result.RunTime))}`,
    }));
  return rows.length > 0
    ? rows
    : [{ icon: "⚪", label: "None", value: "method runtime unavailable" }];
}

function artifactSummary(artifacts: Array<{ path: string; kind: string }>): string {
  if (artifacts.length === 0) return "none";
  const kinds = [...new Set(artifacts.map((artifact) => artifact.kind))];
  return `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"} · ${kinds.join(" + ")}`;
}

export function summarizeTestResults(methodResults: Record<string, unknown>[]): {
  total: number;
  passing: number;
  failing: number;
} {
  const failed = methodResults.filter((result) => result.Outcome !== "Pass");
  return {
    total: methodResults.length,
    passing: methodResults.length - failed.length,
    failing: failed.length,
  };
}

function renderTestSummary(
  summary: { total: number; passing: number; failing: number },
  methodResults: Record<string, unknown>[],
): string {
  const failed = methodResults.filter((result) => result.Outcome !== "Pass");
  return [
    `Apex tests ${summary.failing === 0 ? "passed" : "failed"}: ${summary.passing}/${summary.total} passing.`,
    ...failed
      .slice(0, 5)
      .map((item) => `${item.MethodName}: ${item.Message ?? item.StackTrace ?? "failed"}`),
  ].join("\n");
}

async function resolveApexClasses(
  conn: Connection,
  classNames: string[],
): Promise<Array<{ Id: string; Name: string }>> {
  const quoted = classNames.map(quoteSoql).join(",");
  const records = (
    await toolingQuery<{ Id: string; Name: string }>(
      conn,
      `SELECT Id, Name FROM ApexClass WHERE Name IN (${quoted}) AND Status = 'Active'`,
    )
  ).records;
  const found = new Set(records.map((record) => record.Name));
  const missing = classNames.filter((name) => !found.has(name));
  if (missing.length > 0) throw new Error(`Apex test class(es) not found: ${missing.join(", ")}`);
  return records;
}
