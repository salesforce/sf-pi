/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Live SF Apex hardening harness.
 *
 * Exercises the sf-apex native operation layer against a deployed
 * SfApexHarness fixture in a caller-provided Salesforce project/org. This
 * script intentionally avoids `sf apex` subprocesses: it resolves an
 * @salesforce/core Connection and calls the same operation functions that back
 * the `sf_apex` tool.
 *
 * Usage:
 *   node --experimental-strip-types scripts/e2e/sf-apex-harness-e2e.ts --org <alias> --harness-cwd <project>
 *   SF_APEX_E2E_ORG=<alias> SF_APEX_E2E_HARNESS_CWD=<project> node --experimental-strip-types scripts/e2e/sf-apex-harness-e2e.ts
 *
 * Optional:
 *   --flow <FlowApiName>       Run a Flow.Interview observation smoke.
 *   --require-flow             Treat Flow smoke failure as a run failure.
 *   --skip-failures            Skip controlled failure probes.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { apexConnection } from "../../extensions/sf-apex/lib/api.ts";
import {
  apexSearch,
  coverageSummary,
  diagnoseFile,
  orgPreflight,
  runAnonymous,
  runTest,
  startTrace,
  stopTrace,
  testDiscover,
  testPlan,
  traceStatus,
} from "../../extensions/sf-apex/lib/operations.ts";
import type { SfApexSessionState, ToolResult } from "../../extensions/sf-apex/lib/types.ts";
import { clearConnectionCache } from "../../lib/common/sf-conn/connection.ts";

const args = process.argv.slice(2);
const ORG =
  firstValue(args, ["--org", "--target-org"]) ??
  firstPositional(args) ??
  process.env.SF_APEX_E2E_ORG;
const FLOW = firstValue(args, ["--flow"]) ?? process.env.SF_APEX_E2E_FLOW;
const REQUIRE_FLOW =
  args.includes("--require-flow") || truthy(process.env.SF_APEX_E2E_REQUIRE_FLOW);
const SKIP_FAILURES = args.includes("--skip-failures");
const HARNESS_CWD = firstValue(args, ["--harness-cwd"]) ?? process.env.SF_APEX_E2E_HARNESS_CWD;

if (!ORG || !HARNESS_CWD) {
  console.error(
    "Usage: node --experimental-strip-types scripts/e2e/sf-apex-harness-e2e.ts --org <alias> --harness-cwd <project>",
  );
  console.error(
    "   or: SF_APEX_E2E_ORG=<alias> SF_APEX_E2E_HARNESS_CWD=<project> node --experimental-strip-types ...",
  );
  process.exit(2);
}

let failures = 0;
let traceStarted = false;
const state: SfApexSessionState = {};

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

function ok(name: string, detail?: string) {
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail: string) {
  failures++;
  console.log(`  ✗ ${name} — ${detail}`);
}

function expectText(name: string, result: ToolResult, pattern: RegExp | string) {
  const text = result.content[0]?.text ?? "";
  const matched = typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
  if (matched) ok(name, firstLine(text));
  else fail(name, `expected ${String(pattern)} in: ${clip(text)}`);
}

function expectOk(name: string, result: ToolResult) {
  if (result.details?.ok === false) fail(name, firstLine(result.content[0]?.text ?? "failed"));
  else ok(name, firstLine(result.content[0]?.text ?? "ok"));
}

function expectAnonymousSoapEvidence(name: string, result: ToolResult) {
  const digest = result.details?.digest as { api_calls?: Array<{ path?: string }> } | undefined;
  const logDigest = result.details?.log_digest as { timeline?: unknown[] } | undefined;
  const paths = digest?.api_calls?.map((call) => call.path ?? "") ?? [];
  if (!paths.some((path) => path.includes("/services/Soap/s/"))) {
    fail(name, `missing SOAP API rail: ${JSON.stringify(paths)}`);
    return;
  }
  if (paths.some((path) => path.includes("TraceFlag") || path.includes("ApexLog"))) {
    fail(name, `anon.run should not include trace/log polling rail: ${JSON.stringify(paths)}`);
    return;
  }
  if (!logDigest?.timeline?.length) {
    fail(name, "missing parsed inline debug-log timeline");
    return;
  }
  ok(name, `SOAP rail · ${logDigest.timeline.length} timeline event(s)`);
}

async function main() {
  clearConnectionCache();
  section("1. Resolve native connection");
  const conn = await apexConnection(ORG);
  ok("connection resolved", `${ORG} · API v${conn.getApiVersion()}`);

  section("2. Native discovery and planning");
  expectOk("org.preflight", await orgPreflight(conn, { action: "org.preflight", target_org: ORG }));
  expectText(
    "apex.search harness",
    await apexSearch(conn, {
      action: "apex.search",
      target_org: ORG,
      query: "SfApexHarness",
      limit: 30,
    }),
    /found \d+ result\(s\)/,
  );
  expectText(
    "test.discover service",
    await testDiscover(conn, {
      action: "test.discover",
      target_org: ORG,
      target: "SfApexHarnessService.cls",
      limit: 20,
    }),
    /Discovered \d+ Apex test candidate\(s\)/,
  );
  expectText(
    "test.plan service",
    await testPlan(conn, {
      action: "test.plan",
      target_org: ORG,
      target: "SfApexHarnessService.cls",
      limit: 20,
    }),
    "SfApexHarnessServiceTest",
  );

  section("3. Local diagnostics and native tests");
  expectText(
    "diagnose.file service",
    await diagnoseFile(
      {
        action: "diagnose.file",
        target_org: ORG,
        file: path.join(HARNESS_CWD, "force-app/main/default/classes/SfApexHarnessService.cls"),
      },
      HARNESS_CWD,
    ),
    /Apex diagnostics (clean|unavailable)/,
  );
  expectText(
    "test.run harness suite",
    await runTest(conn, {
      action: "test.run",
      target_org: ORG,
      class_names: [
        "SfApexHarnessServiceTest",
        "SfApexHarnessTriggerHandlerTest",
        "SfApexHarnessQueueableTest",
        "SfApexHarnessBatchTest",
        "SfApexHarnessSchedulableTest",
        "SfApexHarnessInvocableTest",
      ],
      wait_seconds: 240,
    }),
    /Apex tests passed: \d+\/\d+ passing\./,
  );
  expectText(
    "coverage.summary harness",
    await coverageSummary(conn, {
      action: "coverage.summary",
      target_org: ORG,
      class_names: [
        "SfApexHarnessService",
        "SfApexHarnessTriggerHandler",
        "SfApexHarnessQueueable",
        "SfApexHarnessBatch",
        "SfApexHarnessSchedulable",
        "SfApexHarnessInvocable",
      ],
    }),
    /Apex coverage summary: \d+ target\(s\)\./,
  );

  section("4. Trace lifecycle and SOAP Anonymous Apex probes");
  expectOk(
    "trace.start",
    await startTrace(conn, { action: "trace.start", target_org: ORG, duration_minutes: 10 }, state),
  );
  traceStarted = true;
  expectText(
    "trace.status active",
    await traceStatus(conn, { action: "trace.status", target_org: ORG }),
    "Active Apex trace flags:",
  );

  const smoke = await readFile(
    path.join(HARNESS_CWD, "scripts/apex/sfApexHarnessSmoke.apex"),
    "utf8",
  );
  const smokeResult = await runAnonymous(conn, {
    action: "anon.run",
    target_org: ORG,
    body: smoke,
    wait_seconds: 60,
  });
  expectText("anon.run smoke", smokeResult, "Anonymous Apex succeeded.");
  expectAnonymousSoapEvidence("anon.run smoke SOAP evidence", smokeResult);

  const rollback = await readFile(
    path.join(HARNESS_CWD, "scripts/apex/sfApexHarnessMutationRollback.apex"),
    "utf8",
  );
  const rollbackResult = await runAnonymous(conn, {
    action: "anon.run",
    target_org: ORG,
    body: rollback,
    allow_mutation: true,
    wait_seconds: 60,
  });
  expectText("anon.run rollback mutation", rollbackResult, "Anonymous Apex succeeded.");
  expectAnonymousSoapEvidence("anon.run rollback SOAP evidence", rollbackResult);

  if (!SKIP_FAILURES) await runFailureProbes(conn);
  if (FLOW) await runFlowSmoke(conn, FLOW);
  else ok("flow smoke", "skipped; pass --flow <FlowApiName> to run Flow.Interview smoke");

  section("5. Cleanup");
  expectOk("trace.stop", await stopTrace(conn, { action: "trace.stop", target_org: ORG }, state));
  traceStarted = false;
  expectText(
    "trace.status final",
    await traceStatus(conn, { action: "trace.status", target_org: ORG }),
    "Active Apex trace flags: 0.",
  );
}

async function runFailureProbes(conn: Awaited<ReturnType<typeof apexConnection>>) {
  section("4b. Controlled failure probes");
  expectText(
    "anon.run compile failure",
    await runAnonymous(conn, {
      action: "anon.run",
      target_org: ORG,
      body: "System.debug('SF_APEX_E2E_COMPILE_FAILURE'); SfApexHarnessService.methodThatDoesNotExist();",
      wait_seconds: 30,
    }),
    "Compile problem:",
  );

  const runtimeFailure = await runAnonymous(conn, {
    action: "anon.run",
    target_org: ORG,
    body: "System.debug('SF_APEX_E2E_RUNTIME_FAILURE start'); throw new SfApexHarnessService.HarnessProcessingException('SF_APEX_E2E_CONTROLLED_FAILURE');",
    wait_seconds: 60,
  });
  expectText("anon.run runtime failure", runtimeFailure, "SF_APEX_E2E_CONTROLLED_FAILURE");
  expectAnonymousSoapEvidence("anon.run runtime SOAP evidence", runtimeFailure);

  expectText(
    "anon.run mutation guard",
    await runAnonymous(conn, {
      action: "anon.run",
      target_org: ORG,
      body: "insert new SfApexHarness__c(Status__c = SfApexHarnessService.STATUS_NEW);",
      wait_seconds: 30,
    }),
    "appears mutating",
  );
}

async function runFlowSmoke(conn: Awaited<ReturnType<typeof apexConnection>>, flowName: string) {
  section("4c. Flow observation smoke");
  const body = [
    "System.debug('SF_APEX_E2E_FLOW start');",
    "Map<String, Object> inputs = new Map<String, Object>();",
    `Flow.Interview.${flowName} interview = new Flow.Interview.${flowName}(inputs);`,
    "interview.start();",
    "System.debug('SF_APEX_E2E_FLOW finished');",
  ].join("\n");
  const result = await runAnonymous(conn, {
    action: "anon.run",
    target_org: ORG,
    body,
    wait_seconds: 60,
  });
  const text = result.content[0]?.text ?? "";
  if (/Anonymous Apex succeeded/.test(text)) ok("flow observation", flowName);
  else if (REQUIRE_FLOW) fail("flow observation", clip(text));
  else ok("flow observation skipped", clip(text));
}

function firstValue(argv: string[], names: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) if (names.includes(argv[i])) return argv[i + 1];
  return undefined;
}

function firstPositional(argv: string[]): string | undefined {
  return argv.find((arg) => !arg.startsWith("--"));
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0] ?? "";
}

function clip(value: string, max = 400): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

try {
  await main();
} catch (err) {
  fail("fatal", err instanceof Error ? err.message : String(err));
} finally {
  if (traceStarted) {
    try {
      const conn = await apexConnection(ORG);
      await stopTrace(conn, { action: "trace.stop", target_org: ORG }, state);
      ok("trace cleanup after failure");
    } catch (err) {
      fail("trace cleanup after failure", err instanceof Error ? err.message : String(err));
    }
  }
}

if (failures > 0) {
  console.error(`\nSF Apex harness E2E failed with ${failures} failure(s).`);
  process.exit(1);
}
console.log("\nSF Apex harness E2E passed.");
