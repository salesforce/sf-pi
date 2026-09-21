/* SPDX-License-Identifier: Apache-2.0 */
/** API-native targeted Flow test discovery, execution, and reporting. */

import { TestLevel, TestService } from "@salesforce/apex-node";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { artifactTimestamp, writeFlowArtifact } from "./artifacts.ts";
import { buildFlowDigest, row, section, toolResultFromDigest } from "./digest.ts";
import type { FlowArtifact, SfFlowParams, SfFlowSessionState, ToolResult } from "./types.ts";

export interface FlowTestCandidate {
  flow_name: string;
  namespace?: string;
  test_names: string[];
}

export interface NormalizedFlowTest {
  flow_name: string;
  test_name: string;
  outcome: string;
  message?: string;
  run_time_ms?: number;
}

export interface FlowTestRunResult {
  run_id: string;
  queued: boolean;
  outcome?: string;
  tests?: NormalizedFlowTest[];
  raw?: unknown;
}

export interface FlowTestAdapter {
  discover(session: SalesforceSession, limit: number): Promise<FlowTestCandidate[]>;
  run(input: {
    session: SalesforceSession;
    category: "Flow";
    flow_names?: string[];
    tests?: string[];
    wait_seconds: number;
    include_coverage: boolean;
  }): Promise<FlowTestRunResult>;
  result(input: {
    session: SalesforceSession;
    run_id: string;
    wait_seconds: number;
    include_coverage: boolean;
  }): Promise<FlowTestRunResult>;
}

interface FlowTestDependencies {
  adapter?: FlowTestAdapter;
  writeArtifact?: (kind: string, filename: string, content: unknown) => Promise<FlowArtifact>;
}

export async function discoverFlowTests(
  params: SfFlowParams,
  session: SalesforceSession,
  dependencies: FlowTestDependencies = {},
): Promise<ToolResult> {
  const limit = boundedLimit(params.limit);
  const adapter = dependencies.adapter ?? defaultFlowTestAdapter;
  const candidates = await adapter.discover(session, limit);
  const digest = buildFlowDigest({
    action: "test.discover",
    kind: "flow_test_discovery",
    status: candidates.length ? "pass" : "warning",
    icon: "🧪",
    title: "Flow Test Discovery",
    org: { alias: params.target_org, api_version: session.target?.apiVersion },
    rail: [
      { kind: "GET", target: "/tooling/query FlowTest", detail: `Flow only · limit=${limit}` },
    ],
    sections: [
      section(
        "🧪",
        "Candidates",
        candidates.length
          ? candidates.map((candidate) =>
              row(
                "🌊",
                candidate.flow_name,
                `${candidate.test_names.length} test${candidate.test_names.length === 1 ? "" : "s"}`,
              ),
            )
          : [row("⚪", "Candidates", "no Flow tests found")],
      ),
    ],
    next_step: candidates.length
      ? "Run the smallest relevant Flow test."
      : "Create a Flow test in Flow Builder before using test.run.",
  });
  return toolResultFromDigest(digest, { candidates, count: candidates.length });
}

export async function planFlowTests(
  params: SfFlowParams,
  session: SalesforceSession,
  dependencies: FlowTestDependencies = {},
): Promise<ToolResult> {
  const adapter = dependencies.adapter ?? defaultFlowTestAdapter;
  const candidates = await adapter.discover(session, boundedLimit(params.limit ?? 10));
  const requested = new Set(params.flow_names ?? []);
  const ranked = requested.size
    ? candidates.filter((candidate) => requested.has(candidate.flow_name))
    : candidates;
  const primary = ranked[0];
  const digest = buildFlowDigest({
    action: "test.plan",
    kind: "flow_test_plan",
    status: primary ? "pass" : "warning",
    icon: "🧭",
    title: "Flow Test Plan",
    org: { alias: params.target_org, api_version: session.target?.apiVersion },
    rail: [{ kind: "GET", target: "/tooling/query FlowTest", detail: "rank Flow tests" }],
    sections: [
      section("🎯", "Plan", [
        row(primary ? "✅" : "⚠️", "Primary", primary?.flow_name ?? "no candidate"),
        row("📦", "Scope", primary ? "one Flow first" : "refine flow_names or add tests"),
        row("📈", "Widen", "only after the focused test passes"),
      ]),
    ],
    next_step: primary
      ? `Run flow_names=["${primary.flow_name}"].`
      : "Run test.discover or create a Flow test.",
  });
  return toolResultFromDigest(digest, { candidates: ranked, primary });
}

export async function runFlowTests(
  params: SfFlowParams,
  session: SalesforceSession,
  state: SfFlowSessionState,
  dependencies: FlowTestDependencies = {},
): Promise<ToolResult> {
  const flowNames = params.flow_names ?? [];
  const tests = params.tests ?? [];
  if (!flowNames.length && !tests.length)
    throw new Error("flow_names or tests is required for test.run");
  if (flowNames.length && tests.length) throw new Error("flow_names and tests cannot be combined");
  const adapter = dependencies.adapter ?? defaultFlowTestAdapter;
  const run = await adapter.run({
    session,
    category: "Flow",
    flow_names: flowNames.length ? flowNames : undefined,
    tests: tests.length ? tests : undefined,
    wait_seconds: boundedWait(params.wait_seconds),
    include_coverage: params.include_coverage === true,
  });
  state.last_test_run_id = run.run_id;
  state.last_test_spec = {
    target_org: params.target_org,
    flow_names: params.flow_names,
    tests: params.tests,
    wait_seconds: params.wait_seconds,
    include_coverage: params.include_coverage,
    report_formats: params.report_formats,
  };
  return formatRun(params, run, dependencies);
}

export async function getFlowTestResult(
  params: SfFlowParams,
  session: SalesforceSession,
  state: SfFlowSessionState,
  dependencies: FlowTestDependencies = {},
): Promise<ToolResult> {
  const runId = params.run_id ?? state.last_test_run_id;
  if (!runId) throw new Error("run_id is required for test.result");
  const adapter = dependencies.adapter ?? defaultFlowTestAdapter;
  const run = await adapter.result({
    session,
    run_id: runId,
    wait_seconds: boundedWait(params.wait_seconds),
    include_coverage: params.include_coverage === true,
  });
  state.last_test_run_id = run.run_id;
  return formatRun(params, run, dependencies);
}

export async function rerunFlowTests(
  params: SfFlowParams,
  session: SalesforceSession,
  state: SfFlowSessionState,
  dependencies: FlowTestDependencies = {},
): Promise<ToolResult> {
  if (!state.last_test_spec) throw new Error("No prior test.run exists in this session.");
  return runFlowTests(
    { ...params, ...state.last_test_spec, action: "test.rerun" },
    session,
    state,
    dependencies,
  );
}

async function formatRun(
  params: SfFlowParams,
  run: FlowTestRunResult,
  dependencies: FlowTestDependencies,
): Promise<ToolResult> {
  const tests = run.tests ?? [];
  const passing = tests.filter((test) => test.outcome === "Pass").length;
  const failing = tests.filter((test) => test.outcome !== "Pass").length;
  const artifacts = run.queued
    ? []
    : await writeTestArtifacts(params, run, dependencies.writeArtifact ?? writeFlowArtifact);
  const failed = tests.filter((test) => test.outcome !== "Pass");
  const noTestsExecuted = !run.queued && tests.length === 0;
  const normalizedOutcome = run.outcome?.toLowerCase();
  const unsuccessfulOutcome =
    !run.queued &&
    normalizedOutcome !== undefined &&
    !["passed", "completed"].includes(normalizedOutcome);
  const runFailed = failing > 0 || noTestsExecuted || unsuccessfulOutcome;
  const status = run.queued ? "info" : runFailed ? "fail" : "pass";
  const digest = buildFlowDigest({
    action: params.action,
    kind: "flow_test_run",
    status,
    icon: "🧪",
    title: `Flow Test Run · ${run.queued ? "queued" : runFailed ? "failed" : "passed"}`,
    org: { alias: params.target_org },
    meta: [`run=${shortId(run.run_id)}`],
    rail: [
      {
        kind: params.action === "test.result" ? "GET" : "POST",
        target:
          params.action === "test.result"
            ? "/tooling/query FlowTestResult"
            : "/tooling/runTestsAsynchronous",
        detail: "category=Flow",
      },
    ],
    sections: [
      section("🧾", "Summary", [
        row(
          run.queued ? "⏳" : failing ? "❌" : "✅",
          "Outcome",
          run.outcome ?? (run.queued ? "Queued" : "Completed"),
        ),
        row("✅", "Passing", passing),
        row("❌", "Failing", failing),
        row("🧾", "Run Id", run.run_id),
      ]),
      section(
        "🧪",
        "Tests",
        tests.length
          ? tests
              .slice(0, Math.min(boundedLimit(params.limit), 25))
              .map((test) =>
                row(
                  test.outcome === "Pass" ? "✅" : "❌",
                  `${test.flow_name}.${test.test_name}`,
                  test.run_time_ms === undefined
                    ? test.outcome
                    : `${test.outcome} · ${test.run_time_ms}ms`,
                ),
              )
          : [row("⏳", "Tests", run.queued ? "results pending" : "none returned")],
      ),
      section(
        "🧯",
        "Failures",
        failed.length
          ? failed
              .slice(0, 8)
              .map((test) =>
                row("❌", `${test.flow_name}.${test.test_name}`, test.message ?? test.outcome),
              )
          : noTestsExecuted
            ? [
                row(
                  "❌",
                  "No Tests Executed",
                  `Salesforce returned ${run.outcome ?? "no terminal outcome"}`,
                ),
              ]
            : [row("✅", "None", run.queued ? "results pending" : "all returned tests passed")],
      ),
    ],
    artifacts,
    next_step: run.queued
      ? "Poll with test.result."
      : failing
        ? "Fix the first failure and rerun the same test."
        : runFailed
          ? "Verify the requested Flow test names and inspect the terminal run outcome before rerunning."
          : "Widen to the next related Flow test when useful.",
  });
  return toolResultFromDigest(digest, {
    run_id: run.run_id,
    queued: run.queued,
    outcome: run.outcome,
    tests,
    passing,
    failing,
    no_tests_executed: noTestsExecuted,
    artifacts,
  });
}

async function writeTestArtifacts(
  params: SfFlowParams,
  run: FlowTestRunResult,
  writeArtifact: NonNullable<FlowTestDependencies["writeArtifact"]>,
): Promise<FlowArtifact[]> {
  const stamp = `${artifactTimestamp()}-${run.run_id}`;
  const formats = new Set(["json", ...(params.report_formats ?? ["markdown"])]);
  const artifacts: FlowArtifact[] = [];
  if (formats.has("json"))
    artifacts.push(await writeArtifact("tests", `${stamp}.json`, run.raw ?? run));
  if (formats.has("markdown"))
    artifacts.push(await writeArtifact("test-reports", `${stamp}.md`, markdownReport(run)));
  if (formats.has("junit"))
    artifacts.push(await writeArtifact("test-reports", `${stamp}.xml`, junitReport(run)));
  if (formats.has("tap"))
    artifacts.push(await writeArtifact("test-reports", `${stamp}.tap`, tapReport(run)));
  return artifacts;
}

export const defaultFlowTestAdapter: FlowTestAdapter = {
  async discover(session, limit) {
    const recordLimit = Math.min(limit * 4, 25);
    const result = await session.query<{
      Id?: string;
      DeveloperName?: string;
      MasterLabel?: string;
      NamespacePrefix?: string;
    }>({
      soql: `SELECT Id, DeveloperName, MasterLabel, NamespacePrefix FROM FlowTest ORDER BY DeveloperName LIMIT ${recordLimit}`,
      api: "tooling",
      maxRows: recordLimit,
    });
    const grouped = new Map<string, FlowTestCandidate>();
    for (const record of result.records) {
      if (!record.Id || !/^[A-Za-z0-9]{15,18}$/.test(record.Id)) continue;
      const detail = await session.query<{ Metadata?: { flowApiName?: string } }>({
        soql: `SELECT Metadata FROM FlowTest WHERE Id = '${record.Id}' LIMIT 1`,
        api: "tooling",
        maxRows: 1,
      });
      const flowName = detail.records[0]?.Metadata?.flowApiName;
      const testName = record.DeveloperName;
      if (!flowName || !testName) continue;
      const existing = grouped.get(flowName) ?? {
        flow_name: flowName,
        namespace: record.NamespacePrefix || undefined,
        test_names: [],
      };
      existing.test_names.push(testName);
      grouped.set(flowName, existing);
      if (grouped.size >= limit) break;
    }
    return [...grouped.values()];
  },
  async run(input) {
    const service = new TestService(input.session.connection);
    const tests = input.tests
      ?.map((test) => (test.startsWith("FlowTesting.") ? test : `FlowTesting.${test}`))
      .join(",");
    const flowClassNames = input.flow_names
      ?.map((name) => (name.startsWith("FlowTesting.") ? name : `FlowTesting.${name}`))
      .join(",");
    const payload = await service.buildAsyncPayload(
      TestLevel.RunSpecifiedTests,
      tests,
      flowClassNames,
      undefined,
      "Flow",
      !input.include_coverage,
    );
    const submitted = normalizeServiceResult(
      await service.runTestAsynchronous(payload, input.include_coverage, true),
    );
    if (input.wait_seconds <= 0) return submitted;
    const status = await waitForFlowTestRun(input.session, submitted.run_id, input.wait_seconds);
    if (!isFinishedTestStatus(status)) {
      return { run_id: submitted.run_id, queued: true, outcome: status || "Queued" };
    }
    return normalizeServiceResult(
      await service.reportAsyncResults(submitted.run_id, input.include_coverage),
      submitted.run_id,
    );
  },
  async result(input) {
    const status = await waitForFlowTestRun(input.session, input.run_id, input.wait_seconds);
    if (!isFinishedTestStatus(status)) {
      return {
        run_id: input.run_id,
        queued: true,
        outcome: status || "Queued",
      };
    }
    const service = new TestService(input.session.connection);
    const result = await service.reportAsyncResults(input.run_id, input.include_coverage);
    return normalizeServiceResult(result, input.run_id);
  },
};

function normalizeServiceResult(result: unknown, fallbackRunId?: string): FlowTestRunResult {
  const value = (result ?? {}) as Record<string, unknown>;
  if (typeof value.testRunId === "string" && !value.summary) {
    return { run_id: value.testRunId, queued: true };
  }
  const summary = (value.summary ?? {}) as Record<string, unknown>;
  const rawTests = Array.isArray(value.tests)
    ? (value.tests as Array<Record<string, unknown>>)
    : [];
  const runId = stringValue(summary.testRunId) ?? fallbackRunId ?? "unknown";
  return {
    run_id: runId,
    queued: false,
    outcome:
      stringValue(summary.outcome) ??
      (rawTests.every((test) => test.outcome === "Pass") ? "Passed" : "Failed"),
    tests: rawTests.map((test) => {
      const apexClass = (test.apexClass ?? {}) as Record<string, unknown>;
      return {
        flow_name: stringValue(apexClass.name) ?? stringValue(test.flowName) ?? "Flow",
        test_name: stringValue(test.methodName) ?? stringValue(test.fullName) ?? "test",
        outcome: stringValue(test.outcome) ?? "Unknown",
        message: stringValue(test.message) ?? stringValue(test.stackTrace),
        run_time_ms: numberValue(test.runTime),
      };
    }),
    raw: result,
  };
}

async function waitForFlowTestRun(
  session: SalesforceSession,
  runId: string,
  waitSeconds: number,
): Promise<string> {
  if (!/^[A-Za-z0-9]{15,18}$/.test(runId)) throw new Error(`Invalid Flow test run ID: ${runId}`);
  const deadline = Date.now() + waitSeconds * 1_000;
  let status = "";
  do {
    const result = await session.query<{ Status?: string }>({
      soql: `SELECT Status FROM ApexTestRunResult WHERE AsyncApexJobId = '${runId}' LIMIT 1`,
      api: "tooling",
      maxRows: 1,
    });
    status = result.records[0]?.Status ?? status;
    if (isFinishedTestStatus(status) || waitSeconds === 0) return status;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(2_000, Math.max(1, deadline - Date.now()))),
    );
  } while (Date.now() < deadline);
  return status;
}

function isFinishedTestStatus(status: string): boolean {
  return ["Passed", "Failed", "Completed", "Aborted", "Skipped"].includes(status);
}

function markdownReport(run: FlowTestRunResult): string {
  const lines = [`# Flow Test Run ${run.run_id}`, "", `Outcome: ${run.outcome ?? "Unknown"}`, ""];
  for (const test of run.tests ?? [])
    lines.push(
      `- ${test.outcome === "Pass" ? "✅" : "❌"} ${test.flow_name}.${test.test_name}: ${test.outcome}`,
    );
  return `${lines.join("\n")}\n`;
}

function junitReport(run: FlowTestRunResult): string {
  const tests = run.tests ?? [];
  const failures = tests.filter((test) => test.outcome !== "Pass").length;
  const cases = tests.map((test) => {
    const failure =
      test.outcome === "Pass" ? "" : `<failure message="${xml(test.message ?? test.outcome)}"/>`;
    return `<testcase classname="${xml(test.flow_name)}" name="${xml(test.test_name)}">${failure}</testcase>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite tests="${tests.length}" failures="${failures}">${cases.join("")}</testsuite>\n`;
}

function tapReport(run: FlowTestRunResult): string {
  const tests = run.tests ?? [];
  return [
    `TAP version 13`,
    `1..${tests.length}`,
    ...tests.map(
      (test, index) =>
        `${test.outcome === "Pass" ? "ok" : "not ok"} ${index + 1} - ${test.flow_name}.${test.test_name}`,
    ),
    "",
  ].join("\n");
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function boundedLimit(value: number | undefined): number {
  return Math.max(1, Math.min(Math.floor(value ?? 25), 100));
}

function boundedWait(value: number | undefined): number {
  return Math.max(0, Math.min(Math.floor(value ?? 60), 300));
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 3)}…${value.slice(-4)}` : value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
