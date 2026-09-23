/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Bounded live family sweep for sf-flow.
 *
 * Default: local diagnostics + combined Metadata API check-only.
 * --deploy: deploy public-safe Draft fixtures, deactivate any fixture left active,
 * run/rerun the non-committing after-save FlowTest, and verify cleanup.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { ComponentSet } from "@salesforce/source-deploy-retrieve";
import { connectSalesforce, type SalesforceSession } from "../../lib/common/sf-conn/index.ts";
import { analyzeFlowFile } from "../../extensions/sf-flow/lib/analyzer.ts";
import {
  getFlowTestResult,
  rerunFlowTests,
  runFlowTests,
} from "../../extensions/sf-flow/lib/flow-tests.ts";
import type {
  FlowRunDigest,
  SfFlowSessionState,
  ToolResult,
} from "../../extensions/sf-flow/lib/types.ts";

const FIXTURE_ROOT = path.resolve("scripts/e2e/fixtures/sf-flow");
const FLOW_API_NAMES = [
  "SfPi_Hardening_Screen_Intake",
  "SfPi_Hardening_Scheduled_Account",
  "SfPi_Hardening_Event_Handler",
  "SfPi_Hardening_Before_Delete",
  "SfPi_Hardening_After_Save_Task",
  "SfPi_Hardening_Omni_Queue",
  "SfPi_Hardening_Omni_Agent_Availability",
  "SfPi_Hardening_Omni_Skills",
  "SfPi_Hardening_Omni_No_Route",
] as const;
const AFTER_SAVE_FLOW = "SfPi_Hardening_After_Save_Task";
const AFTER_SAVE_TEST = "SfPi_Hardening_After_Save_Task_Happy_Path";
const FLOW_FILES = FLOW_API_NAMES.map((name) =>
  path.join(FIXTURE_ROOT, `force-app/main/default/flows/${name}.flow-meta.xml`),
);
const TEST_FILE = path.join(
  FIXTURE_ROOT,
  "force-app/main/default/flowtests/SfPi_Hardening_After_Save_Task_Happy_Path.flowtest-meta.xml",
);
const EVENT_OBJECT_DIR = path.join(
  FIXTURE_ROOT,
  "force-app/main/default/objects/SfPi_Flow_Test_Event__e",
);

interface Args {
  org?: string;
  deploy: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { deploy: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--org") {
      const org = argv[++index];
      if (!org) throw new Error("--org requires an alias or username");
      args.org = org;
    } else if (argv[index] === "--deploy") {
      args.deploy = true;
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  return args;
}

export function flowDefinitionDeactivationSource(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<FlowDefinition xmlns="http://soap.sforce.com/2006/04/metadata">\n    <activeVersionNumber>0</activeVersionNumber>\n</FlowDefinition>\n`;
}

function digest(result: ToolResult): FlowRunDigest {
  const value = result.details.digest as FlowRunDigest | undefined;
  if (!value) throw new Error(`Missing Flow Run Digest: ${result.content[0]?.text ?? "unknown"}`);
  return value;
}

function assertPass(label: string, result: ToolResult): FlowRunDigest {
  const value = digest(result);
  if (value.status !== "pass") {
    throw new Error(`${label} expected pass, got ${value.status}: ${result.content[0]?.text}`);
  }
  console.log(`✅ ${label}: pass · ${value.title}`);
  return value;
}

async function deployComponents(
  session: SalesforceSession,
  source: string | string[],
  checkOnly: boolean,
): Promise<void> {
  const components = ComponentSet.fromSource(source);
  components.apiVersion = session.target.apiVersion;
  components.sourceApiVersion = session.target.apiVersion;
  const job = await components.deploy({
    usernameOrConnection: session.connection,
    apiOptions: { checkOnly, rollbackOnError: true, testLevel: "NoTestRun" },
  });
  const result = await job.pollStatus(1_000, 180);
  if (result.response.success !== true) {
    const raw = result.response.details?.componentFailures as unknown;
    const failures = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    const messages = failures
      .slice(0, 10)
      .map((failure) => String((failure as { problem?: unknown }).problem ?? "unknown failure"));
    throw new Error(
      `${checkOnly ? "check-only" : "deploy"} failed: ${messages.join(" | ") || result.response.status}`,
    );
  }
  console.log(
    `✅ ${checkOnly ? "check-only" : "deploy"}: succeeded · components=${result.response.numberComponentsDeployed ?? 0}`,
  );
}

async function diagnoseFixtures(): Promise<void> {
  for (const file of FLOW_FILES) {
    const relative = path.relative(FIXTURE_ROOT, file);
    const analysis = await analyzeFlowFile(relative, FIXTURE_ROOT, { profile: "generation" });
    if (analysis.summary.high || analysis.summary.moderate) {
      throw new Error(
        `${relative} is not ready: high=${analysis.summary.high} moderate=${analysis.summary.moderate}`,
      );
    }
    console.log(`✅ diagnose: ${path.basename(file)} · ${analysis.family}`);
  }
}

interface FixtureFlowDefinition {
  ApiName?: string;
  IsActive?: boolean;
  ActiveVersionId?: string | null;
}

async function queryFixtureDefinitions(
  session: SalesforceSession,
): Promise<FixtureFlowDefinition[]> {
  const names = FLOW_API_NAMES.map((name) => `'${name}'`).join(",");
  const result = await session.query<FixtureFlowDefinition>({
    soql: `SELECT ApiName, IsActive, ActiveVersionId FROM FlowDefinitionView WHERE ApiName IN (${names})`,
    api: "rest",
    maxRows: FLOW_API_NAMES.length,
  });
  return result.records;
}

async function deactivateFixtureFlows(session: SalesforceSession): Promise<void> {
  const current = await queryFixtureDefinitions(session);
  const active = current
    .filter((record) => record.IsActive === true || Boolean(record.ActiveVersionId))
    .map((record) => record.ApiName)
    .filter((name): name is string => Boolean(name));
  if (!active.length) {
    console.log("✅ deactivate: all family fixtures already inactive");
    return;
  }

  const root = await mkdtemp(path.join(tmpdir(), "sf-flow-deactivate-"));
  try {
    const definitions = path.join(root, "flowDefinitions");
    await mkdir(definitions, { recursive: true });
    for (const name of active) {
      await writeFile(
        path.join(definitions, `${name}.flowDefinition-meta.xml`),
        flowDefinitionDeactivationSource(),
      );
    }
    await deployComponents(session, definitions, true);
    await deployComponents(session, definitions, false);
    console.log(`✅ deactivate: ${active.join(", ")}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function verifyInactiveAndClean(session: SalesforceSession): Promise<void> {
  const definitions = await queryFixtureDefinitions(session);
  if (definitions.length !== FLOW_API_NAMES.length) {
    throw new Error(
      `Expected ${FLOW_API_NAMES.length} Flow definitions, found ${definitions.length}.`,
    );
  }
  const stillActive = definitions.filter(
    (record) => record.IsActive === true || Boolean(record.ActiveVersionId),
  );
  if (stillActive.length) {
    throw new Error(
      `Fixture Flow remains active: ${stillActive.map((record) => record.ApiName).join(", ")}`,
    );
  }

  const cron = await session.query<{ Id?: string }>({
    soql: "SELECT Id FROM CronTrigger WHERE CronJobDetail.Name LIKE 'SfPi_Hardening_Scheduled_Account%' LIMIT 5",
    api: "rest",
    maxRows: 5,
  });
  if (cron.records.length) throw new Error("Scheduled fixture CronTrigger cleanup is incomplete.");

  const accounts = await session.query<{ Id?: string }>({
    soql: "SELECT Id FROM Account WHERE AccountNumber = 'SFPI-AFTER-SAVE' LIMIT 1",
    api: "rest",
    maxRows: 1,
  });
  const tasks = await session.query<{ Id?: string }>({
    soql: "SELECT Id FROM Task WHERE Subject = 'SF Pi after-save fixture task' LIMIT 1",
    api: "rest",
    maxRows: 1,
  });
  if (accounts.records.length !== 0 || tasks.records.length !== 0) {
    throw new Error("Non-committing FlowTest left fixture Account or Task data behind.");
  }
  console.log("✅ verify: all fixtures inactive · no CronTrigger · no Account/Task residue");
}

export function flowTestRegistered(
  body: unknown,
  flowName = AFTER_SAVE_FLOW,
  testName = AFTER_SAVE_TEST,
): boolean {
  const classes = (body as { apexTestClasses?: unknown } | undefined)?.apexTestClasses;
  if (!Array.isArray(classes)) return false;
  return classes.some((candidate) => {
    const value = candidate as { name?: unknown; testMethods?: unknown };
    if (value.name !== flowName || !Array.isArray(value.testMethods)) return false;
    return value.testMethods.some((method) => (method as { name?: unknown }).name === testName);
  });
}

async function waitForFlowTestRegistration(
  session: SalesforceSession,
  timeoutSeconds = 60,
): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  do {
    const response = await session.request({
      method: "GET",
      path: "/tooling/tests",
      query: { category: "Flow" },
    });
    if (response.status < 400 && flowTestRegistered(response.body)) {
      console.log(`✅ test registration: ${AFTER_SAVE_FLOW}.${AFTER_SAVE_TEST}`);
      return;
    }
    await delay(2_000);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${AFTER_SAVE_FLOW}.${AFTER_SAVE_TEST} registration.`);
}

async function runAndWaitAfterSaveTest(
  session: SalesforceSession,
  state: SfFlowSessionState,
  attempt: number,
): Promise<ToolResult> {
  const run = await runFlowTests(
    {
      action: "test.run",
      target_org: session.target.alias,
      flow_names: [AFTER_SAVE_FLOW],
      wait_seconds: 0,
      report_formats: ["json", "markdown", "junit", "tap"],
    },
    session,
    state,
  );
  const queued = digest(run);
  if (queued.status !== "info" || !state.last_test_run_id) {
    throw new Error(`Expected queued Flow test run: ${run.content[0]?.text}`);
  }
  const result = await getFlowTestResult(
    {
      action: "test.result",
      target_org: session.target.alias,
      run_id: state.last_test_run_id,
      wait_seconds: 120,
      report_formats: ["json", "markdown", "junit", "tap"],
    },
    session,
    state,
  );
  if (digest(result).status === "pass") return result;
  if (attempt === 1 && result.details.no_tests_executed === true) {
    console.log(
      "⚠️ Flow test registration was visible but execution returned zero tests; retrying once.",
    );
    await delay(5_000);
    await waitForFlowTestRegistration(session);
    return runAndWaitAfterSaveTest(session, state, 2);
  }
  return result;
}

async function runAfterSaveTest(session: SalesforceSession): Promise<void> {
  await waitForFlowTestRegistration(session);
  const state: SfFlowSessionState = {};
  assertPass("test.result", await runAndWaitAfterSaveTest(session, state, 1));

  const rerun = await rerunFlowTests(
    { action: "test.rerun", target_org: session.target.alias },
    session,
    state,
  );
  const rerunDigest = digest(rerun);
  if (rerunDigest.status !== "info" || !state.last_test_run_id) {
    throw new Error(`Expected queued Flow test rerun: ${rerun.content[0]?.text}`);
  }
  assertPass(
    "test.result after rerun",
    await getFlowTestResult(
      {
        action: "test.result",
        target_org: session.target.alias,
        run_id: state.last_test_run_id,
        wait_seconds: 120,
        report_formats: ["json", "markdown", "junit", "tap"],
      },
      session,
      state,
    ),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.org) {
    throw new Error(
      "Usage: npm run e2e:sf-flow-families -- --org <non-production-alias> [--deploy]",
    );
  }
  await diagnoseFixtures();
  const session = await connectSalesforce({ cwd: process.cwd(), targetOrg: args.org, fresh: true });
  if (session.target.orgType === "production" || session.target.orgType === "unknown") {
    throw new Error(`Refusing family sweep for org type ${session.target.orgType}.`);
  }
  if (Number.parseFloat(session.target.apiVersion) < 66) {
    throw new Error("The family sweep requires API 66.0 or later for FlowTest metadata.");
  }

  const sources = [...FLOW_FILES, TEST_FILE, EVENT_OBJECT_DIR];
  console.log(
    `Target: ${args.org} · type=${session.target.orgType} · API ${session.target.apiVersion} · mode=${args.deploy ? "check+deploy+test" : "check-only"}`,
  );
  await deployComponents(session, sources, true);
  if (!args.deploy) {
    console.log("Family sweep plan complete. Re-run with --deploy for Draft deployment and tests.");
    return;
  }

  await deployComponents(session, sources, false);
  await deactivateFixtureFlows(session);
  await runAfterSaveTest(session);
  await verifyInactiveAndClean(session);
  console.log("SF Flow family sweep passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
