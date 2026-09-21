/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded live action sweep for advanced SF Flow action authoring. */

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ComponentSet } from "@salesforce/source-deploy-retrieve";
import { analyzeFlowFile } from "../../extensions/sf-flow/lib/analyzer.ts";
import { connectSalesforce, type SalesforceSession } from "../../lib/common/sf-conn/index.ts";

const FIXTURE_ROOT = path.resolve("scripts/e2e/fixtures/sf-flow-actions");
const FORCE_APP = path.join(FIXTURE_ROOT, "force-app");
const AGENT_TEMPLATE = path.join(
  FIXTURE_ROOT,
  "templates/SfPi_Action_Run_Agent.flow-meta.xml.template",
);
export const STATIC_ACTION_FLOWS = [
  "SfPi_Action_Complex_Apex",
  "SfPi_Action_Named_Credential",
  "SfPi_Action_External_Service",
  "SfPi_Action_Quick_Action",
  "SfPi_Action_Email_Alert",
] as const;
export const RUN_AGENT_FLOW = "SfPi_Action_Run_Agent";
const ALL_ACTION_FLOWS = [...STATIC_ACTION_FLOWS, RUN_AGENT_FLOW] as const;
const APEX_TEST_CLASSES = [
  "SfPiComplexFlowActionTest",
  "SfPiNamedCredentialEchoActionTest",
  "SfPiFlowActionsRuntimeTest",
] as const;
const ACCOUNT_MARKER = "SFPI-ACTION-SWEEP";
const QUICK_ACTION_SUBJECT = "SFPI Quick Action follow-up";

interface ActionSweepArgs {
  org?: string;
  runtime: boolean;
  agentAction?: string;
}

export function parseActionSweepArgs(argv: string[]): ActionSweepArgs {
  const args: ActionSweepArgs = { runtime: false };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--org") {
      args.org = argv[++index];
      if (!args.org) throw new Error("--org requires an alias or username");
    } else if (value === "--runtime") {
      args.runtime = true;
    } else if (value === "--agent-action") {
      args.agentAction = argv[++index];
      if (!args.agentAction) throw new Error("--agent-action requires an API name");
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

export function stageActionFlowSource(source: string, active: boolean): string {
  const matches = source.match(/<status>Draft<\/status>/gu) ?? [];
  if (matches.length !== 1) throw new Error(`Expected one Draft status, found ${matches.length}.`);
  return active ? source.replace("<status>Draft</status>", "<status>Active</status>") : source;
}

export function renderRunAgentFlow(template: string, actionName: string): string {
  const placeholders = template.match(/__AGENT_ACTION_NAME__/gu) ?? [];
  if (placeholders.length !== 1) {
    throw new Error(`Expected one agent action placeholder, found ${placeholders.length}.`);
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(actionName)) {
    throw new Error("Agent action API name must be alphanumeric with underscores.");
  }
  return template.replace("__AGENT_ACTION_NAME__", actionName);
}

export function flowDefinitionDeactivationSource(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<FlowDefinition xmlns="http://soap.sforce.com/2006/04/metadata">\n    <activeVersionNumber>0</activeVersionNumber>\n</FlowDefinition>\n`;
}

interface DeployOptions {
  checkOnly: boolean;
  tests?: readonly string[];
}

async function deployComponents(
  session: SalesforceSession,
  source: string,
  options: DeployOptions,
): Promise<void> {
  const components = ComponentSet.fromSource(source);
  components.apiVersion = session.target.apiVersion;
  components.sourceApiVersion = session.target.apiVersion;
  const tests = options.tests ? [...options.tests] : undefined;
  const job = await components.deploy({
    usernameOrConnection: session.connection,
    apiOptions: {
      checkOnly: options.checkOnly,
      rollbackOnError: true,
      testLevel: tests ? "RunSpecifiedTests" : "NoTestRun",
      ...(tests ? { runTests: tests } : {}),
    },
  });
  const result = await job.pollStatus(1_000, 300);
  if (result.response.success !== true) {
    const componentFailures = normalize(result.response.details?.componentFailures);
    const testFailures = normalize(result.response.details?.runTestResult?.failures);
    const messages = [
      ...componentFailures.map((failure) => String(failure.problem ?? "component failure")),
      ...testFailures.map(
        (failure) =>
          `${String(failure.name ?? "test")}.${String(failure.methodName ?? "unknown")}: ${String(failure.message ?? "test failure")}`,
      ),
    ];
    throw new Error(
      `${options.checkOnly ? "check-only" : "deploy"} failed: ${messages.join(" | ") || result.response.status}`,
    );
  }
  const testCount = Number(result.response.details?.runTestResult?.numTestsRun ?? 0);
  if (tests && testCount === 0) throw new Error("Salesforce reported zero executed action tests.");
  console.log(
    `✅ ${options.checkOnly ? "check-only" : "deploy"}: components=${result.response.numberComponentsDeployed ?? 0}${tests ? ` · tests=${testCount}` : ""}`,
  );
}

function normalize(value: unknown): Array<Record<string, unknown>> {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]) as Array<Record<string, unknown>>;
}

interface ActionSummary {
  name: string;
  label?: string;
  type?: string;
  url: string;
}

async function discoverAgentAction(
  session: SalesforceSession,
  requested?: string,
): Promise<ActionSummary> {
  const index = await session.request<Record<string, string>>({
    method: "GET",
    path: "/actions/custom",
  });
  const url = index.body.generateAiAgentResponse;
  if (!url) throw new Error("The org exposes no Run Agent action category.");
  const response = await session.continueRequest<{ actions?: ActionSummary[] }>({
    method: "GET",
    path: url,
  });
  const actions = (response.body.actions ?? [])
    .filter((action) => action.type === "GENERATE_AI_AGENT_RESPONSE")
    .sort((left, right) => left.name.localeCompare(right.name));
  const selected = requested ? actions.find((action) => action.name === requested) : actions[0];
  if (!selected) {
    throw new Error(
      requested
        ? "The requested Run Agent action isn't available."
        : "No Run Agent action is available.",
    );
  }
  const detail = await session.continueRequest<{
    inputs?: Array<{ name?: string; required?: boolean }>;
    outputs?: Array<{ name?: string }>;
  }>({ method: "GET", path: selected.url });
  const inputNames = new Set((detail.body.inputs ?? []).map((input) => input.name));
  const outputNames = new Set((detail.body.outputs ?? []).map((output) => output.name));
  if (
    !inputNames.has("userMessage") ||
    !outputNames.has("agentResponse") ||
    !outputNames.has("sessionId")
  ) {
    throw new Error("The selected Run Agent action doesn't expose the expected contract.");
  }
  return selected;
}

async function stageSource(actionName: string, active: boolean): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "sf-flow-actions-stage-"));
  const stagedForceApp = path.join(root, "force-app");
  await cp(FORCE_APP, stagedForceApp, { recursive: true });
  const flowDirectory = path.join(stagedForceApp, "main/default/flows");
  const agentSource = renderRunAgentFlow(await readFile(AGENT_TEMPLATE, "utf8"), actionName);
  await writeFile(
    path.join(flowDirectory, `${RUN_AGENT_FLOW}.flow-meta.xml`),
    stageActionFlowSource(agentSource, active),
  );
  if (active) {
    for (const name of STATIC_ACTION_FLOWS) {
      const file = path.join(flowDirectory, `${name}.flow-meta.xml`);
      await writeFile(file, stageActionFlowSource(await readFile(file, "utf8"), true));
    }
  }
  return root;
}

async function diagnoseFlows(stagedRoot: string): Promise<void> {
  for (const name of ALL_ACTION_FLOWS) {
    const file = `force-app/main/default/flows/${name}.flow-meta.xml`;
    const analysis = await analyzeFlowFile(file, stagedRoot, { profile: "generation" });
    if (analysis.summary.high || analysis.summary.moderate) {
      throw new Error(
        `${name} isn't ready: high=${analysis.summary.high} moderate=${analysis.summary.moderate}`,
      );
    }
    console.log(`✅ diagnose: ${name}`);
  }
}

async function createRecord(
  session: SalesforceSession,
  object: string,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await session.request<{ id?: string; success?: boolean; errors?: unknown }>({
    method: "POST",
    path: `/sobjects/${object}`,
    body,
  });
  if (response.status >= 400 || response.body.success !== true || !response.body.id) {
    throw new Error(
      `Could not create ${object}: ${JSON.stringify(response.body.errors ?? response.body)}`,
    );
  }
  return response.body.id;
}

async function deleteRecord(session: SalesforceSession, object: string, id: string): Promise<void> {
  const response = await session.request({ method: "DELETE", path: `/sobjects/${object}/${id}` });
  if (response.status >= 400 && response.status !== 404) {
    throw new Error(`Could not delete ${object} ${id}: HTTP ${response.status}.`);
  }
}

async function invokeFlow(
  session: SalesforceSession,
  flowName: string,
  inputs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await session.request<
    Array<{
      isSuccess?: boolean;
      errors?: Array<{ message?: string }>;
      outputValues?: Record<string, unknown>;
    }>
  >({
    method: "POST",
    path: `/actions/custom/flow/${flowName}`,
    body: { inputs: [inputs] },
  });
  const result = Array.isArray(response.body) ? response.body[0] : undefined;
  if (response.status >= 400 || !result?.isSuccess) {
    throw new Error(
      `${flowName} invocation failed: ${result?.errors?.map((error) => error.message).join(" | ") || JSON.stringify(response.body)}`,
    );
  }
  return result.outputValues ?? {};
}

function requireOutput(
  outputs: Record<string, unknown>,
  name: string,
  predicate: (value: unknown) => boolean,
): void {
  if (!predicate(outputs[name])) throw new Error(`Unexpected ${name} output.`);
}

interface RuntimeFixture {
  accountId?: string;
  taskIds: string[];
}

async function exerciseLiveActions(
  session: SalesforceSession,
  fixture: RuntimeFixture,
): Promise<void> {
  fixture.accountId = await createRecord(session, "Account", {
    Name: "SF Pi Flow Action Sweep",
    AccountNumber: ACCOUNT_MARKER,
  });
  const complex = await invokeFlow(session, "SfPi_Action_Complex_Apex", {
    accountId: fixture.accountId,
    accountRecord: {
      attributes: { type: "Account" },
      Id: fixture.accountId,
      Name: "SF Pi Flow Action Sweep",
    },
    context: "live",
    relatedContactIds: [fixture.accountId],
    requestedScore: 125,
    urgent: true,
  });
  requireOutput(complex, "completed", (value) => value === true);
  requireOutput(complex, "succeeded", (value) => value === true);
  requireOutput(complex, "normalizedScore", (value) => Number(value) === 100);
  console.log("✅ live: complex Invocable Apex contract");

  const namedMarker = `named-${Date.now()}`;
  const named = await invokeFlow(session, "SfPi_Action_Named_Credential", {
    marker: namedMarker,
  });
  requireOutput(named, "completed", (value) => value === true);
  requireOutput(named, "succeeded", (value) => value === true);
  requireOutput(named, "echoedMarker", (value) => value === namedMarker);
  requireOutput(named, "statusCode", (value) => Number(value) === 200);
  console.log("✅ live: Named Credential-backed Apex callout");

  const external = await invokeFlow(session, "SfPi_Action_External_Service", {
    marker: `external-${Date.now()}`,
  });
  requireOutput(external, "completed", (value) => value === true);
  requireOutput(external, "responseCode", (value) => Number(value) === 200);
  console.log("✅ live: OpenAPI External Service callout");

  const quick = await invokeFlow(session, "SfPi_Action_Quick_Action", {
    accountId: fixture.accountId,
  });
  requireOutput(quick, "completed", (value) => value === true);
  const tasks = await session.query<{ Id?: string }>({
    soql: `SELECT Id FROM Task WHERE WhatId = '${fixture.accountId}' AND Subject = '${QUICK_ACTION_SUBJECT}'`,
    api: "rest",
    maxRows: 5,
  });
  fixture.taskIds.push(
    ...tasks.records.map((record) => record.Id).filter((id): id is string => Boolean(id)),
  );
  if (fixture.taskIds.length !== 1) throw new Error("Quick Action didn't create one related Task.");
  console.log("✅ live: object-specific Quick Action");

  const email = await invokeFlow(session, "SfPi_Action_Email_Alert", {
    accountId: fixture.accountId,
  });
  requireOutput(email, "completed", (value) => value === true);
  console.log("✅ live: workflow Email Alert");

  const agent = await invokeFlow(session, RUN_AGENT_FLOW, {
    userMessage: "Reply with the single word READY.",
  });
  requireOutput(
    agent,
    "agentResponse",
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  requireOutput(agent, "sessionId", (value) => typeof value === "string" && value.length > 0);
  requireOutput(agent, "completed", (value) => value === true);
  console.log("✅ live: Run Agent response and session contract");
}

async function deactivateFlows(session: SalesforceSession): Promise<void> {
  const quoted = ALL_ACTION_FLOWS.map((name) => `'${name}'`).join(",");
  const definitions = await session.query<{ ApiName?: string }>({
    soql: `SELECT ApiName FROM FlowDefinitionView WHERE ApiName IN (${quoted})`,
    api: "rest",
    maxRows: ALL_ACTION_FLOWS.length,
  });
  if (!definitions.records.length) return;
  const root = await mkdtemp(path.join(tmpdir(), "sf-flow-actions-deactivate-"));
  try {
    const directory = path.join(root, "flowDefinitions");
    await mkdir(directory, { recursive: true });
    for (const record of definitions.records) {
      if (!record.ApiName) continue;
      await writeFile(
        path.join(directory, `${record.ApiName}.flowDefinition-meta.xml`),
        flowDefinitionDeactivationSource(),
      );
    }
    await deployComponents(session, directory, { checkOnly: true });
    await deployComponents(session, directory, { checkOnly: false });
    console.log(`✅ deactivate: ${definitions.records.length} action Flows`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function cleanupRuntimeFixture(
  session: SalesforceSession,
  fixture: RuntimeFixture,
): Promise<void> {
  for (const id of fixture.taskIds) await deleteRecord(session, "Task", id);
  if (fixture.accountId) await deleteRecord(session, "Account", fixture.accountId);
}

async function verifyCleanup(session: SalesforceSession): Promise<void> {
  const quoted = ALL_ACTION_FLOWS.map((name) => `'${name}'`).join(",");
  const active = await session.query<{ ApiName?: string }>({
    soql: `SELECT ApiName FROM FlowDefinitionView WHERE ApiName IN (${quoted}) AND IsActive = true`,
    api: "rest",
    maxRows: ALL_ACTION_FLOWS.length,
  });
  const accounts = await session.query<{ Id?: string }>({
    soql: `SELECT Id FROM Account WHERE AccountNumber = '${ACCOUNT_MARKER}' LIMIT 1`,
    api: "rest",
    maxRows: 1,
  });
  const tasks = await session.query<{ Id?: string }>({
    soql: `SELECT Id FROM Task WHERE Subject = '${QUICK_ACTION_SUBJECT}' LIMIT 1`,
    api: "rest",
    maxRows: 1,
  });
  if (active.records.length || accounts.records.length || tasks.records.length) {
    throw new Error("Action sweep cleanup left active Flows or fixture records.");
  }
  console.log("✅ verify: all action Flows inactive · no Account or Task residue");
}

async function main(): Promise<void> {
  const args = parseActionSweepArgs(process.argv.slice(2));
  if (!args.org) {
    throw new Error(
      "Usage: npm run e2e:sf-flow-actions -- --org <dedicated-non-production-alias> [--runtime] [--agent-action <api-name>]",
    );
  }
  const session = await connectSalesforce({ cwd: process.cwd(), targetOrg: args.org, fresh: true });
  if (session.target.orgType === "production" || session.target.orgType === "unknown") {
    throw new Error(`Refusing Flow action sweep for org type ${session.target.orgType}.`);
  }
  if (Number.parseFloat(session.target.apiVersion) < 67) {
    throw new Error("The Flow action sweep requires API 67.0 or later.");
  }
  const agentAction = await discoverAgentAction(session, args.agentAction);
  let draftRoot: string | undefined;
  let activeRoot: string | undefined;
  const fixture: RuntimeFixture = { taskIds: [] };
  try {
    draftRoot = await stageSource(agentAction.name, false);
    await diagnoseFlows(draftRoot);
    console.log(
      `Target: ${args.org} · type=${session.target.orgType} · API ${session.target.apiVersion} · mode=${args.runtime ? "runtime" : "check-only"}`,
    );
    await deployComponents(session, path.join(draftRoot, "force-app"), { checkOnly: true });
    if (!args.runtime) {
      console.log("SF Flow action sweep plan complete. Re-run with --runtime.");
      return;
    }
    await deployComponents(session, path.join(draftRoot, "force-app"), { checkOnly: false });
    activeRoot = await stageSource(agentAction.name, true);
    await deployComponents(session, path.join(activeRoot, "force-app"), {
      checkOnly: false,
      tests: APEX_TEST_CLASSES,
    });
    await exerciseLiveActions(session, fixture);
  } finally {
    try {
      if (args.runtime) {
        await deactivateFlows(session);
        await cleanupRuntimeFixture(session, fixture);
      }
      await verifyCleanup(session);
    } finally {
      if (draftRoot) await rm(draftRoot, { recursive: true, force: true });
      if (activeRoot) await rm(activeRoot, { recursive: true, force: true });
    }
  }
  console.log("SF Flow live action sweep passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
