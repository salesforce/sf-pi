/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Bounded advanced runtime sweep for sf-flow.
 *
 * Default: local diagnostics + combined Metadata API check-only.
 * --deploy: retain the public-safe Apex fixtures and Draft Flow fixtures.
 * --runtime: stage temporary Active Flow source, run all targeted Apex integration
 * tests, then deactivate every fixture and verify zero record residue.
 */

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { ComponentSet } from "@salesforce/source-deploy-retrieve";
import { connectSalesforce, type SalesforceSession } from "../../lib/common/sf-conn/index.ts";
import { analyzeFlowFile } from "../../extensions/sf-flow/lib/analyzer.ts";
import {
  ASYNC_BULK_COUNT,
  DEPTH_CORRELATION_PREFIX,
  DEPTH_FLOW_API_NAMES,
  HANDLED_CHAIN_OUTPUT,
  PROBE_OBJECT,
  PROBE_TRIGGERED_DEPTH_FLOWS,
  SCHEDULE_BULK_COUNT,
  SUCCESS_CHAIN_OUTPUT,
  UNORDERED_AFTER_TOKENS,
  UNORDERED_BEFORE_TOKENS,
  assertSingleTransaction,
  compareRecordCoverage,
  generationDiagnosisAccepted,
  hasSameTokens,
  noneTriggerSubflowRejected,
  probeIsolationFailure,
  recordCoverageFailure,
  scheduleWaitSecondsFromFire,
} from "./lib/sf-flow-depth-proofs.ts";

const FIXTURE_ROOT = path.resolve("scripts/e2e/fixtures/sf-flow-advanced");
const FORCE_APP = path.join(FIXTURE_ROOT, "force-app");
export const FLOW_API_NAMES = [
  "SfPi_Advanced_Related_Task",
  "SfPi_Advanced_Prior_Value",
  "SfPi_Advanced_Transform_Contact",
  "SfPi_Advanced_Filter_Sort_Contacts",
  "SfPi_Advanced_Subflow_Child",
  "SfPi_Advanced_Subflow_Parent",
  "SfPi_Advanced_Related_Pipeline",
  "SfPi_Advanced_Autolaunched_Action",
  "SfPi_Advanced_After_Save_Prior",
  "SfPi_Advanced_Before_Delete_Pipeline",
  "SfPi_Advanced_Event_Action",
  "SfPi_Advanced_Scheduled_Pipeline",
  "SfPi_Advanced_Before_Save_Collection",
  "SfPi_Advanced_Trigger_Create_Update",
  "SfPi_Advanced_Conditions_And",
  "SfPi_Advanced_Conditions_Or",
  "SfPi_Advanced_Conditions_Custom",
  "SfPi_Advanced_Conditions_Formula",
  "SfPi_Advanced_Related_Async",
  "SfPi_Advanced_Data_Operations",
  "SfPi_Advanced_Custom_Error",
  "SfPi_Advanced_Email_Action",
  "SfPi_Advanced_Rollback",
  "SfPi_Advanced_Forced_Faults",
  "SfPi_Advanced_Related_Delete",
  "SfPi_Advanced_Record_Variables",
  "SfPi_Advanced_Multi_Sort",
  "SfPi_Advanced_Create_Upsert",
  "SfPi_Advanced_Upsert_Collection",
  "SfPi_Advanced_Transform_Aggregate",
  "SfPi_Advanced_Transform_Nested",
  "SfPi_Advanced_Transform_Join",
  "SfPi_Advanced_Wait_Resume",
  ...DEPTH_FLOW_API_NAMES,
] as const;
const SCHEDULED_FLOW_NAMES = [
  "SfPi_Advanced_Scheduled_Pipeline",
  "SfPi_Advanced_Scheduled_Bulk",
] as const;
const FLOW_FILES = FLOW_API_NAMES.map((name) =>
  path.join(FORCE_APP, `main/default/flows/${name}.flow-meta.xml`),
);
export const APEX_TEST_CLASSES = [
  "SfPiFlowBulkContractActionTest",
  "SfPiFlowAdvancedRuntimeTest",
  "SfPiFlowPriorRuntimeTest",
  "SfPiFlowTransformRuntimeTest",
  "SfPiFlowCollectionRuntimeTest",
  "SfPiFlowSubflowRuntimeTest",
  "SfPiFlowRelatedPipelineRuntimeTest",
  "SfPiFlowAutolaunchedActionRuntimeTest",
  "SfPiFlowAfterSavePriorRuntimeTest",
  "SfPiFlowBeforeDeletePipelineRuntimeTest",
  "SfPiFlowPlatformEventRuntimeTest",
  "SfPiFlowBeforeSaveCollectionRuntimeTest",
  "SfPiFlowEntryConditionRuntimeTest",
  "SfPiFlowTriggerPathRuntimeTest",
  "SfPiFlowDataElementRuntimeTest",
  "SfPiFlowCustomErrorRuntimeTest",
  "SfPiFlowStandardActionRuntimeTest",
  "SfPiFlowSliceOneRuntimeTest",
] as const;

interface AdvancedArgs {
  org?: string;
  deploy: boolean;
  runtime: boolean;
  cleanup: boolean;
}

export function parseAdvancedArgs(argv: string[]): AdvancedArgs {
  const args: AdvancedArgs = { deploy: false, runtime: false, cleanup: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--org") {
      const org = argv[++index];
      if (!org) throw new Error("--org requires an alias or username");
      args.org = org;
    } else if (argv[index] === "--deploy") {
      args.deploy = true;
    } else if (argv[index] === "--runtime") {
      args.deploy = true;
      args.runtime = true;
    } else if (argv[index] === "--cleanup") {
      args.cleanup = true;
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  return args;
}

export function stageActiveFlowSource(source: string): string {
  const matches = source.match(/<status>Draft<\/status>/gu) ?? [];
  if (matches.length !== 1) {
    throw new Error(`Expected one Draft status, found ${matches.length}.`);
  }
  return source.replace("<status>Draft</status>", "<status>Active</status>");
}

export function stageScheduleSource(source: string, startDate: string, startTime: string): string {
  const dates = source.match(/<startDate>[^<]+<\/startDate>/gu) ?? [];
  const times = source.match(/<startTime>[^<]+<\/startTime>/gu) ?? [];
  if (dates.length !== 1 || times.length !== 1) {
    throw new Error(
      `Expected one schedule start, found dates=${dates.length} times=${times.length}.`,
    );
  }
  return source
    .replace(dates[0], `<startDate>${startDate}</startDate>`)
    .replace(times[0], `<startTime>${startTime}</startTime>`);
}

export function advancedFlowDefinitionDeactivationSource(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<FlowDefinition xmlns="http://soap.sforce.com/2006/04/metadata">\n    <activeVersionNumber>0</activeVersionNumber>\n</FlowDefinition>\n`;
}

interface DeployOptions {
  checkOnly: boolean;
  tests?: readonly string[];
}

async function deployComponents(
  session: SalesforceSession,
  source: string | string[],
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
    const rawComponents = result.response.details?.componentFailures as unknown;
    const componentFailures = rawComponents
      ? Array.isArray(rawComponents)
        ? rawComponents
        : [rawComponents]
      : [];
    const rawTests = result.response.details?.runTestResult?.failures as unknown;
    const testFailures = rawTests ? (Array.isArray(rawTests) ? rawTests : [rawTests]) : [];
    const rawCoverageWarnings = result.response.details?.runTestResult
      ?.codeCoverageWarnings as unknown;
    const coverageWarnings = rawCoverageWarnings
      ? Array.isArray(rawCoverageWarnings)
        ? rawCoverageWarnings
        : [rawCoverageWarnings]
      : [];
    const messages = [
      ...componentFailures
        .slice(0, 10)
        .map((failure) =>
          String((failure as { problem?: unknown }).problem ?? "unknown component failure"),
        ),
      ...testFailures.slice(0, 10).map((failure) => {
        const value = failure as { name?: unknown; methodName?: unknown; message?: unknown };
        return `${String(value.name ?? "test")}.${String(value.methodName ?? "unknown")}: ${String(value.message ?? "unknown test failure")}`;
      }),
      ...coverageWarnings.slice(0, 10).map((warning) => {
        const value = warning as { name?: unknown; message?: unknown };
        return `${String(value.name ?? "Apex coverage")}: ${String(value.message ?? "coverage requirement not met")}`;
      }),
    ];
    throw new Error(
      `${options.checkOnly ? "check-only" : "deploy"} failed: ${messages.join(" | ") || result.response.status}`,
    );
  }
  const runResult = result.response.details?.runTestResult;
  const testCount = Number(runResult?.numTestsRun ?? 0);
  if (tests) {
    const rawSuccesses = runResult?.successes as unknown;
    const successes = rawSuccesses
      ? Array.isArray(rawSuccesses)
        ? rawSuccesses
        : [rawSuccesses]
      : [];
    const successfulClasses = new Set(
      successes.map((success) => String((success as { name?: unknown }).name ?? "")),
    );
    const missingClasses = tests.filter((name) => !successfulClasses.has(name));
    if (missingClasses.length) {
      throw new Error(
        `Salesforce returned no successful test method for: ${missingClasses.join(", ")}.`,
      );
    }
  }
  console.log(
    `✅ ${options.checkOnly ? "check-only" : "deploy"}: succeeded · components=${result.response.numberComponentsDeployed ?? 0}${tests ? ` · tests=${testCount}` : ""}`,
  );
}

async function diagnoseFixtures(): Promise<void> {
  for (const file of FLOW_FILES) {
    const relative = path.relative(FIXTURE_ROOT, file);
    const analysis = await analyzeFlowFile(relative, FIXTURE_ROOT, { profile: "generation" });
    if (!generationDiagnosisAccepted(path.basename(file), analysis.findings)) {
      const actionable = analysis.findings
        .filter((finding) => finding.severity === "high" || finding.severity === "moderate")
        .map((finding) => `${finding.severity} ${finding.rule_id}`)
        .join(", ");
      throw new Error(`${relative} is not ready: ${actionable || "unexpected diagnosis"}`);
    }
    console.log(`✅ diagnose: ${path.basename(file)} · ${analysis.family}`);
  }
}

interface ScheduleStart {
  date: string;
  time: string;
  timeZone: string;
}

async function stageRuntimeSource(schedule: ScheduleStart): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "sf-flow-advanced-runtime-"));
  const stagedForceApp = path.join(root, "force-app");
  await cp(FORCE_APP, stagedForceApp, { recursive: true });
  for (const name of FLOW_API_NAMES) {
    const file = path.join(stagedForceApp, `main/default/flows/${name}.flow-meta.xml`);
    let source = stageActiveFlowSource(await readFile(file, "utf8"));
    if ((SCHEDULED_FLOW_NAMES as readonly string[]).includes(name)) {
      source = stageScheduleSource(source, schedule.date, schedule.time);
    }
    await writeFile(file, source);
  }
  return root;
}

function scheduleWallClock(date: Date, timeZone: string): Omit<ScheduleStart, "timeZone"> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  if (!year || !month || !day || !hour || !minute) {
    throw new Error(`Could not derive schedule wall clock for ${timeZone}.`);
  }
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}:00.000Z` };
}

async function resolveScheduleStart(
  session: SalesforceSession,
  leadMinutes: number,
): Promise<ScheduleStart> {
  const identity = await session.identity();
  const user = await session.query<{ TimeZoneSidKey?: string }>({
    soql: `SELECT TimeZoneSidKey FROM User WHERE Id = '${identity.user_id}' LIMIT 1`,
    api: "rest",
    maxRows: 1,
  });
  const timeZone = user.records[0]?.TimeZoneSidKey;
  if (!timeZone) throw new Error("Could not resolve the activating user's time zone.");
  return {
    ...scheduleWallClock(new Date(Date.now() + leadMinutes * 60_000), timeZone),
    timeZone,
  };
}

async function restageScheduledStarts(root: string, schedule: ScheduleStart): Promise<void> {
  for (const name of SCHEDULED_FLOW_NAMES) {
    const file = path.join(root, "force-app", `main/default/flows/${name}.flow-meta.xml`);
    const source = stageScheduleSource(await readFile(file, "utf8"), schedule.date, schedule.time);
    await writeFile(file, source);
  }
}

interface ScheduleFixture {
  accountIds: string[];
  contactIds: string[];
}

interface AsyncPathFixture {
  accountId?: string;
  contactId?: string;
}

interface WaitResumeFixture {
  key: string;
  interviewLabel: string;
}

interface PermissionSetAssignmentRecord {
  Id?: string;
}

async function assignProbePermissionSet(session: SalesforceSession): Promise<string | undefined> {
  const identity = await session.identity();
  const permissionSets = await session.query<{ Id?: string }>({
    soql: "SELECT Id FROM PermissionSet WHERE Name = 'SfPi_Flow_Probe_Access' LIMIT 1",
    api: "rest",
    maxRows: 1,
  });
  const permissionSetId = permissionSets.records[0]?.Id;
  if (!permissionSetId) throw new Error("The probe fixture permission set was not deployed.");
  const existing = await session.query<PermissionSetAssignmentRecord>({
    soql: `SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '${identity.user_id}' AND PermissionSetId = '${permissionSetId}' LIMIT 1`,
    api: "rest",
    maxRows: 1,
  });
  if (existing.records[0]?.Id) {
    console.log("✅ permission: existing probe fixture assignment");
    return undefined;
  }
  const response = await session.request<{ id?: string; success?: boolean; errors?: unknown }>({
    method: "POST",
    path: "/sobjects/PermissionSetAssignment",
    body: { AssigneeId: identity.user_id, PermissionSetId: permissionSetId },
  });
  if (response.status >= 400 || response.body.success !== true || !response.body.id) {
    throw new Error(
      `Could not assign probe fixture permission set: ${JSON.stringify(response.body.errors ?? response.body)}`,
    );
  }
  console.log("✅ permission: assigned probe fixture access");
  return response.body.id;
}

async function removeProbePermissionSetAssignment(
  session: SalesforceSession,
  assignmentId: string | undefined,
): Promise<void> {
  if (!assignmentId) return;
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await session.request({
      method: "DELETE",
      path: `/sobjects/PermissionSetAssignment/${assignmentId}`,
    });
    lastStatus = response.status;
    if (response.status < 400 || response.status === 404) {
      console.log("✅ permission cleanup: removed probe fixture assignment");
      return;
    }
    await delay(2_000);
  }
  throw new Error(`Could not remove probe fixture permission assignment: status ${lastStatus}.`);
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
    throw new Error(`Could not delete ${object} ${id}: status ${response.status}.`);
  }
}

async function updateRecord(
  session: SalesforceSession,
  object: string,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await session.request({
    method: "PATCH",
    path: `/sobjects/${object}/${id}`,
    body,
  });
  if (response.status >= 400) {
    throw new Error(`Could not update ${object} ${id}: status ${response.status}.`);
  }
}

async function populateScheduleFixture(
  session: SalesforceSession,
  fixture: ScheduleFixture,
): Promise<void> {
  for (let index = 0; index < 2; index++) {
    const accountId = await createRecord(session, "Account", {
      Name: `SF Pi Schedule ${index}`,
      AccountNumber: "SFPI-ADVANCED-SCHEDULE",
    });
    fixture.accountIds.push(accountId);
    fixture.contactIds.push(
      await createRecord(session, "Contact", {
        AccountId: accountId,
        LastName: `SFPI Schedule ${index}`,
        Email: `schedule-${index}@example.test`,
      }),
      await createRecord(session, "Contact", {
        AccountId: accountId,
        LastName: `SFPI Schedule Ignored ${index}`,
      }),
    );
  }
  console.log("✅ schedule fixture: 2 Accounts · 4 Contacts");
}

async function exerciseAsyncPath(
  session: SalesforceSession,
  fixture: AsyncPathFixture,
  timeoutSeconds = 180,
): Promise<void> {
  fixture.accountId = await createRecord(session, "Account", {
    Name: "SF Pi Async Path",
    AccountNumber: "SFPI-ADVANCED-PATHS-PENDING",
  });
  fixture.contactId = await createRecord(session, "Contact", {
    AccountId: fixture.accountId,
    LastName: "SFPI Async Path Contact",
  });
  await updateRecord(session, "Account", fixture.accountId, {
    Name: "SF Pi Async Path Updated",
    AccountNumber: "SFPI-ADVANCED-PATHS",
  });

  const contacts = await session.query<{ Description?: string }>({
    soql: `SELECT Description FROM Contact WHERE Id = '${fixture.contactId}'`,
    api: "rest",
    maxRows: 1,
  });
  if (contacts.records[0]?.Description !== "SFPI synchronous related update") {
    throw new Error("The immediate path did not update the related Contact.");
  }

  const deadline = Date.now() + timeoutSeconds * 1_000;
  do {
    const tasks = await session.query<{ Id?: string }>({
      soql: `SELECT Id FROM Task WHERE WhatId = '${fixture.accountId}' AND Subject = 'SFPI async-after-commit evidence'`,
      api: "rest",
      maxRows: 2,
    });
    if (tasks.records.length === 1) {
      console.log("✅ async runtime: related Contact updated · after-commit Task created");
      return;
    }
    await delay(2_000);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for asynchronous-after-commit Flow evidence.");
}

async function startWaitResume(
  session: SalesforceSession,
  fixture: WaitResumeFixture,
  timeoutSeconds = 30,
): Promise<void> {
  const response = await session.request<
    Array<{ isSuccess?: boolean; errors?: Array<{ message?: string }> }>
  >({
    method: "POST",
    path: "/actions/custom/flow/SfPi_Advanced_Wait_Resume",
    body: { inputs: [{ inputKey: fixture.key }] },
  });
  const result = response.body[0];
  if (response.status >= 400 || result?.isSuccess !== true) {
    throw new Error(
      `Could not start Wait Flow: ${result?.errors?.map((error) => error.message).join(" | ") || response.status}`,
    );
  }

  const deadline = Date.now() + timeoutSeconds * 1_000;
  do {
    const interviews = await session.query<{
      Id?: string;
      InterviewStatus?: string;
      CurrentElement?: string;
    }>({
      soql: `SELECT Id, InterviewStatus, CurrentElement FROM FlowInterview WHERE InterviewLabel = '${fixture.interviewLabel}'`,
      api: "rest",
      maxRows: 2,
    });
    if (interviews.records.length === 1 && interviews.records[0]?.Id) {
      console.log(
        `✅ wait runtime: persisted interview · status=${interviews.records[0].InterviewStatus ?? "unknown"} · element=${interviews.records[0].CurrentElement ?? "unknown"}`,
      );
      return;
    }
    await delay(1_000);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for the FlowInterview created by the Wait element.");
}

async function waitForWaitResume(
  session: SalesforceSession,
  fixture: WaitResumeFixture,
  timeoutSeconds = 240,
): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  do {
    const probes = await session.query<{ Id?: string; Stage__c?: string }>({
      soql: `SELECT Id, Stage__c FROM SfPi_Flow_Probe__c WHERE CorrelationKey__c = '${fixture.key}'`,
      api: "rest",
      maxRows: 5,
    });
    const fault = probes.records.find((record) => record.Stage__c === "wait-fault");
    if (fault) throw new Error("The Wait element resumed through its fault connector.");
    const resumed = probes.records.filter((record) => record.Stage__c === "resumed");
    if (resumed.length === 1 && resumed[0]?.Id) {
      const interviews = await session.query<{ Id?: string }>({
        soql: `SELECT Id FROM FlowInterview WHERE InterviewLabel = '${fixture.interviewLabel}'`,
        api: "rest",
        maxRows: 2,
      });
      if (interviews.records.length === 0) {
        console.log(
          "✅ wait runtime: interview resumed · one evidence record · no paused interview",
        );
        return;
      }
    }
    await delay(2_000);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for the Wait interview to resume and finish.");
}

async function waitForScheduleEvidence(
  session: SalesforceSession,
  fixture: ScheduleFixture,
  timeoutSeconds = 360,
): Promise<void> {
  const ids = fixture.accountIds.map((id) => `'${id}'`).join(",");
  const deadline = Date.now() + timeoutSeconds * 1_000;
  do {
    const tasks = await session.query<{
      Id?: string;
      WhatId?: string;
      Subject?: string;
      Description?: string;
    }>({
      soql: `SELECT Id, WhatId, Subject, Description FROM Task WHERE WhatId IN (${ids})`,
      api: "rest",
      maxRows: 10,
    });
    if (tasks.records.length === 2) {
      const indexes = new Set<string>();
      const recordKeys = new Set<string>();
      for (const task of tasks.records) {
        if (!task.Subject?.startsWith("SFPI Schedule ")) {
          throw new Error(`Unexpected scheduled Task subject: ${task.Subject ?? "missing"}.`);
        }
        if (!task.Description?.includes("requestCount=2")) {
          throw new Error(
            `Scheduled Apex action did not receive both records: ${task.Description}.`,
          );
        }
        const index = task.Description.match(/requestIndex=(\d+);/u)?.[1];
        const recordKey = task.Description.match(/recordKey=([^;]+)$/u)?.[1];
        if (!index || !recordKey)
          throw new Error(`Incomplete scheduled Task evidence: ${task.Description}.`);
        indexes.add(index);
        recordKeys.add(recordKey);
      }
      if (indexes.size !== 2 || recordKeys.size !== 2) {
        throw new Error("Scheduled Apex outputs did not preserve two distinct indexes and keys.");
      }
      console.log("✅ schedule runtime: 2 related Tasks · Apex batch size/order preserved");
      return;
    }
    await delay(5_000);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for scheduled advanced Flow evidence.");
}

async function cleanupAsyncPathFixture(
  session: SalesforceSession,
  fixture: AsyncPathFixture | undefined,
): Promise<void> {
  if (!fixture) return;
  if (fixture.accountId) {
    const tasks = await session.query<{ Id?: string }>({
      soql: `SELECT Id FROM Task WHERE WhatId = '${fixture.accountId}'`,
      api: "rest",
      maxRows: 10,
    });
    for (const task of tasks.records) {
      if (task.Id) await deleteRecord(session, "Task", task.Id);
    }
  }
  if (fixture.contactId) await deleteRecord(session, "Contact", fixture.contactId);
  if (fixture.accountId) await deleteRecord(session, "Account", fixture.accountId);
  console.log("✅ async cleanup: Task · Contact · Account");
}

async function cleanupWaitResumeFixture(
  session: SalesforceSession,
  fixture: WaitResumeFixture | undefined,
): Promise<void> {
  if (!fixture) return;
  const probes = await session.query<{ Id?: string }>({
    soql: `SELECT Id FROM SfPi_Flow_Probe__c WHERE CorrelationKey__c = '${fixture.key}'`,
    api: "rest",
    maxRows: 10,
  });
  for (const probe of probes.records) {
    if (probe.Id) await deleteRecord(session, "SfPi_Flow_Probe__c", probe.Id);
  }
  const interviews = await session.query<{ Id?: string }>({
    soql: `SELECT Id FROM FlowInterview WHERE InterviewLabel = '${fixture.interviewLabel}'`,
    api: "rest",
    maxRows: 10,
  });
  for (const interview of interviews.records) {
    if (interview.Id) await deleteRecord(session, "FlowInterview", interview.Id);
  }
  console.log("✅ wait cleanup: evidence records · paused interviews");
}

async function cleanupScheduleFixture(
  session: SalesforceSession,
  fixture: ScheduleFixture | undefined,
): Promise<void> {
  if (!fixture) return;
  if (fixture.accountIds.length) {
    const ids = fixture.accountIds.map((id) => `'${id}'`).join(",");
    const tasks = await session.query<{ Id?: string }>({
      soql: `SELECT Id FROM Task WHERE WhatId IN (${ids})`,
      api: "rest",
      maxRows: 20,
    });
    for (const task of tasks.records) {
      if (task.Id) await deleteRecord(session, "Task", task.Id);
    }
  }
  for (const id of fixture.contactIds) await deleteRecord(session, "Contact", id);
  for (const id of fixture.accountIds) await deleteRecord(session, "Account", id);
  console.log("✅ schedule cleanup: Tasks · Contacts · Accounts");
}

async function deactivateFixtures(session: SalesforceSession): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sf-flow-advanced-deactivate-"));
  try {
    const definitions = path.join(root, "flowDefinitions");
    await mkdir(definitions, { recursive: true });
    for (const name of FLOW_API_NAMES) {
      await writeFile(
        path.join(definitions, `${name}.flowDefinition-meta.xml`),
        advancedFlowDefinitionDeactivationSource(),
      );
    }
    await deployComponents(session, definitions, { checkOnly: true });
    await deployComponents(session, definitions, { checkOnly: false });
    console.log(`✅ deactivate: ${FLOW_API_NAMES.length} advanced Flow fixtures`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

interface FixtureFlowDefinition {
  ApiName?: string;
  IsActive?: boolean;
  ActiveVersionId?: string | null;
}

async function verifyInactiveAndClean(session: SalesforceSession): Promise<void> {
  const names = FLOW_API_NAMES.map((name) => `'${name}'`).join(",");
  const definitions = await session.query<FixtureFlowDefinition>({
    soql: `SELECT ApiName, IsActive, ActiveVersionId FROM FlowDefinitionView WHERE ApiName IN (${names})`,
    api: "rest",
    maxRows: FLOW_API_NAMES.length,
  });
  if (definitions.records.length !== FLOW_API_NAMES.length) {
    throw new Error(
      `Expected ${FLOW_API_NAMES.length} advanced Flow definitions, found ${definitions.records.length}.`,
    );
  }
  const active = definitions.records.filter(
    (record) => record.IsActive === true || Boolean(record.ActiveVersionId),
  );
  if (active.length) {
    throw new Error(`Advanced Flow remains active: ${active.map((row) => row.ApiName).join(", ")}`);
  }

  const accounts = await session.query<{ Id?: string }>({
    soql: "SELECT Id FROM Account WHERE AccountNumber IN ('SFPI-ADVANCED-BULK','SFPI-ADVANCED-PRIOR','SFPI-ADVANCED-PIPELINE','SFPI-ADVANCED-PRIOR-AFTER','SFPI-ADVANCED-DELETE','SFPI-ADVANCED-SCHEDULE','SFPI-ADVANCED-BEFORE-COLLECTION','SFPI-ADVANCED-CREATE-UPDATE','SFPI-ADVANCED-PATHS','SFPI-ADVANCED-CUSTOM-ERROR','SFPI-ADVANCED-DATA-OPS') LIMIT 1",
    api: "rest",
    maxRows: 1,
  });
  const opportunities = await session.query<{ Id?: string }>({
    soql: "SELECT Id FROM Opportunity WHERE Name LIKE 'SFPI AND%' OR Name LIKE 'SFPI OR%' OR Name LIKE 'SFPI CUSTOM%' OR Name LIKE 'SFPI FORMULA%' LIMIT 1",
    api: "rest",
    maxRows: 1,
  });
  const tasks = await session.query<{ Id?: string }>({
    soql: "SELECT Id FROM Task WHERE Subject LIKE 'SF Pi related review:%' OR Subject LIKE 'SFPI Delete %' OR Subject LIKE 'SFPI Schedule %' OR Subject LIKE 'prior=%;current=%' OR Subject = 'SFPI async-after-commit evidence' LIMIT 1",
    api: "rest",
    maxRows: 1,
  });
  const contacts = await session.query<{ Id?: string }>({
    soql: "SELECT Id FROM Contact WHERE Email LIKE 'schedule-%@example.test' OR LastName = 'SFPI Async Path Contact' LIMIT 1",
    api: "rest",
    maxRows: 1,
  });
  const probes = await session.query<{ Id?: string }>({
    soql: "SELECT Id FROM SfPi_Flow_Probe__c LIMIT 1",
    api: "rest",
    maxRows: 1,
  });
  const interviews = await session.query<{ Id?: string }>({
    soql: "SELECT Id FROM FlowInterview WHERE InterviewLabel LIKE 'SF Pi Wait SFPI-ADVANCED-WAIT-%' LIMIT 1",
    api: "rest",
    maxRows: 1,
  });
  const cron = await session.query<{ Id?: string }>({
    soql: "SELECT Id FROM CronTrigger WHERE CronJobDetail.Name LIKE 'SfPi_Advanced_Scheduled_Pipeline%' OR CronJobDetail.Name LIKE 'SfPi_Advanced_Scheduled_Bulk%' LIMIT 5",
    api: "rest",
    maxRows: 5,
  });
  const leftovers = [
    accounts.records.length ? "accounts" : "",
    opportunities.records.length ? "opportunities" : "",
    tasks.records.length ? "tasks" : "",
    contacts.records.length ? "contacts" : "",
    probes.records.length ? "probes" : "",
    interviews.records.length ? "interviews" : "",
    cron.records.length ? "scheduled jobs" : "",
  ].filter(Boolean);
  if (leftovers.length) {
    throw new Error(`Advanced Flow cleanup left ${leftovers.join(", ")} behind.`);
  }
  console.log(
    "✅ verify: all advanced Flows inactive · no records, paused interviews, or scheduled job",
  );
}

interface CompositeSaveResult {
  id?: string;
  success?: boolean;
  errors?: Array<{ message?: string }>;
}

interface FlowActionResult {
  isSuccess?: boolean;
  errors?: Array<{ message?: string }>;
  outputValues?: Record<string, unknown>;
  outputText?: string;
  faultMessage?: string;
}

interface DepthSources {
  prefix: string;
  asyncKey: string;
  scheduleKey: string;
  asyncIds: string[];
  asyncKeys: string[];
  scheduleIds: string[];
  scheduleKeys: string[];
}

async function saveProbeRecords(
  session: SalesforceSession,
  method: "POST" | "PATCH",
  records: Array<Record<string, unknown>>,
): Promise<string[]> {
  if (method === "PATCH") assertSingleTransaction(records.length, records);
  const response = await session.request<CompositeSaveResult[] | { message?: string }>({
    method,
    path: "/composite/sobjects",
    body: { allOrNone: true, records },
  });
  if (!Array.isArray(response.body)) {
    throw new Error(`Composite ${method} failed: ${JSON.stringify(response.body)}`);
  }
  const failed = response.body.filter((row) => row.success !== true);
  if (response.status >= 400 || failed.length || response.body.length !== records.length) {
    throw new Error(
      `Composite ${method} failed: ${JSON.stringify(failed.slice(0, 3).map((row) => row.errors))}`,
    );
  }
  return response.body.map((row) => {
    if (method === "POST" && !row.id) throw new Error("Composite create did not return an id.");
    return row.id ?? "";
  });
}

async function deleteProbePrefix(session: SalesforceSession, prefix: string): Promise<void> {
  const rows = await session.query<{ Id?: string }>({
    soql: `SELECT Id FROM SfPi_Flow_Probe__c WHERE CorrelationKey__c LIKE '${prefix}%'`,
    api: "rest",
    maxRows: 2000,
  });
  const ids = rows.records.flatMap((row) => (row.Id ? [row.Id] : []));
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    const response = await session.request({
      method: "DELETE",
      path: "/composite/sobjects",
      query: { ids: batch.join(","), allOrNone: "false" },
    });
    if (response.status >= 400) {
      throw new Error(`Could not delete probe records: status ${response.status}.`);
    }
  }
  if (ids.length) console.log(`✅ depth cleanup: ${ids.length} probe records`);
}

async function assertProbeIsolation(
  session: SalesforceSession,
  requireComplete: boolean,
): Promise<void> {
  const flows = await session.query<{ ApiName?: string }>({
    soql: `SELECT ApiName FROM FlowDefinitionView WHERE TriggerObjectOrEvent.QualifiedApiName = '${PROBE_OBJECT}'`,
    api: "rest",
    maxRows: 50,
  });
  const triggers = await session.query<{ Name?: string }>({
    soql: `SELECT Name FROM ApexTrigger WHERE TableEnumOrId = '${PROBE_OBJECT}'`,
    api: "rest",
    maxRows: 20,
  });
  const failure = probeIsolationFailure({
    flows: flows.records,
    triggers: triggers.records,
    allowed: PROBE_TRIGGERED_DEPTH_FLOWS,
    requireComplete,
  });
  if (failure) throw new Error(`Probe object is not isolated: ${failure}.`);
  console.log(
    `✅ probe isolation: ${flows.records.length} fixture flows · API proof object has no foreign automation`,
  );
}

async function populateDepthSources(
  session: SalesforceSession,
  prefix: string,
): Promise<DepthSources> {
  const sources: DepthSources = {
    prefix,
    asyncKey: `${prefix}async`,
    scheduleKey: `${prefix}schedule`,
    asyncIds: [],
    asyncKeys: [],
    scheduleIds: [],
    scheduleKeys: [],
  };
  const asyncRecords = Array.from({ length: ASYNC_BULK_COUNT }, (_, index) => {
    const key = `${prefix}a${String(index).padStart(3, "0")}`;
    sources.asyncKeys.push(key);
    return {
      attributes: { type: PROBE_OBJECT },
      Name: `Async ${index}`,
      Stage__c: "async-bulk-pending",
      CorrelationKey__c: sources.asyncKey,
      ExternalKey__c: key,
    };
  });
  assertSingleTransaction(ASYNC_BULK_COUNT, asyncRecords);
  sources.asyncIds = await saveProbeRecords(session, "POST", asyncRecords);
  for (let offset = 0; offset < SCHEDULE_BULK_COUNT; offset += 200) {
    const batch = Array.from(
      { length: Math.min(200, SCHEDULE_BULK_COUNT - offset) },
      (_, index) => {
        const key = `${prefix}s${String(offset + index).padStart(3, "0")}`;
        sources.scheduleKeys.push(key);
        return {
          attributes: { type: PROBE_OBJECT },
          Name: `Schedule ${offset + index}`,
          Stage__c: "schedule-bulk-source",
          CorrelationKey__c: sources.scheduleKey,
          ExternalKey__c: key,
        };
      },
    );
    sources.scheduleIds.push(...(await saveProbeRecords(session, "POST", batch)));
  }
  console.log(
    `✅ depth fixture: ${sources.asyncIds.length} async sources · ${sources.scheduleIds.length} schedule sources`,
  );
  return sources;
}

async function waitForProbeEvidence(
  session: SalesforceSession,
  input: {
    correlationKey: string;
    stage: string;
    expectedKeys: readonly string[];
    expectedParents: readonly string[];
    timeoutSeconds: number;
  },
): Promise<void> {
  const deadline = Date.now() + input.timeoutSeconds * 1_000;
  let lastCount: number | undefined;
  do {
    const result = await session.query<{ Parent__c?: string; NullableText__c?: string }>({
      soql: `SELECT Parent__c, NullableText__c FROM ${PROBE_OBJECT} WHERE CorrelationKey__c = '${input.correlationKey}' AND Stage__c = '${input.stage}'`,
      api: "rest",
      maxRows: input.expectedKeys.length + 5,
    });
    lastCount = result.totalSize ?? result.records.length;
    if (lastCount > input.expectedKeys.length) {
      throw new Error(
        `${input.stage} evidence exceeded ${input.expectedKeys.length}: ${lastCount}.`,
      );
    }
    if (result.records.length === input.expectedKeys.length && result.truncated !== true) {
      const keys = recordCoverageFailure(
        compareRecordCoverage(
          input.expectedKeys,
          result.records.map((row) => row.NullableText__c ?? ""),
        ),
      );
      if (keys) throw new Error(`${input.stage} key coverage ${keys}.`);
      const parents = recordCoverageFailure(
        compareRecordCoverage(
          input.expectedParents,
          result.records.map((row) => row.Parent__c ?? ""),
        ),
      );
      if (parents) throw new Error(`${input.stage} parent coverage ${parents}.`);
      return;
    }
    await delay(5_000);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${input.stage} evidence. Last count: ${lastCount ?? 0}.`);
}

async function exerciseAsyncBulk(session: SalesforceSession, sources: DepthSources): Promise<void> {
  const updates = sources.asyncIds.map((id) => ({
    attributes: { type: PROBE_OBJECT },
    id,
    Stage__c: "async-bulk-source",
  }));
  assertSingleTransaction(ASYNC_BULK_COUNT, updates);
  await saveProbeRecords(session, "PATCH", updates);
  await waitForProbeEvidence(session, {
    correlationKey: sources.asyncKey,
    stage: "async-bulk-evidence",
    expectedKeys: sources.asyncKeys,
    expectedParents: sources.asyncIds,
    timeoutSeconds: 900,
  });
  console.log("✅ async runtime: 200 committed updates · 200 unique after-commit outcomes");
}

async function nextScheduleFire(
  session: SalesforceSession,
  flowName: string,
): Promise<number | undefined> {
  const rows = await session.query<{ NextFireTime?: string }>({
    soql: `SELECT NextFireTime FROM CronTrigger WHERE CronJobDetail.Name LIKE '${flowName}%'`,
    api: "rest",
    maxRows: 5,
  });
  const times = rows.records
    .map((row) => (row.NextFireTime ? Date.parse(row.NextFireTime) : Number.NaN))
    .filter((time) => Number.isFinite(time));
  return times.length ? Math.min(...times) : undefined;
}

async function scheduleWaitSeconds(session: SalesforceSession, flowName: string): Promise<number> {
  const nextFire = await nextScheduleFire(session, flowName);
  const seconds = scheduleWaitSecondsFromFire(nextFire, Date.now());
  console.log(
    `Schedule wait: ${flowName} · next=${nextFire ? new Date(nextFire).toISOString() : "none"} · timeout=${seconds}s`,
  );
  return seconds;
}

async function exerciseOrder(session: SalesforceSession, prefix: string): Promise<void> {
  const explicitKey = `${prefix}order-explicit`;
  const equalKey = `${prefix}order-equal`;
  const explicitId = await createRecord(session, PROBE_OBJECT, {
    Name: "Order Explicit",
    Stage__c: "order-pending",
    CorrelationKey__c: explicitKey,
    ExternalKey__c: `${prefix}order-explicit-source`,
  });
  await createRecord(session, PROBE_OBJECT, {
    Name: "Order Explicit Evidence",
    Stage__c: "order-after-evidence",
    CorrelationKey__c: explicitKey,
    ExternalKey__c: `${prefix}order-explicit-evidence`,
    Parent__c: explicitId,
  });
  const equalId = await createRecord(session, PROBE_OBJECT, {
    Name: "Order Equal",
    Stage__c: "order-pending",
    CorrelationKey__c: equalKey,
    ExternalKey__c: `${prefix}order-equal-source`,
  });
  await updateRecord(session, PROBE_OBJECT, explicitId, { Stage__c: "order-explicit" });
  await updateRecord(session, PROBE_OBJECT, equalId, { Stage__c: "order-equal" });

  const explicit = await session.query<{ NullableText__c?: string }>({
    soql: `SELECT NullableText__c FROM ${PROBE_OBJECT} WHERE Id = '${explicitId}'`,
    api: "rest",
    maxRows: 1,
  });
  if (explicit.records[0]?.NullableText__c !== "B10;B20") {
    throw new Error(
      `Explicit before-save order was ${explicit.records[0]?.NullableText__c ?? "missing"}.`,
    );
  }
  const after = await session.query<{ NullableText__c?: string }>({
    soql: `SELECT NullableText__c FROM ${PROBE_OBJECT} WHERE Parent__c = '${explicitId}' AND Stage__c = 'order-after-evidence'`,
    api: "rest",
    maxRows: 5,
  });
  if (after.records.length !== 1 || after.records[0]?.NullableText__c !== "A10;A20") {
    throw new Error(
      `Explicit after-save order was ${after.records.map((row) => row.NullableText__c).join(",") || "missing"}.`,
    );
  }
  const equal = await session.query<{ NullableText__c?: string }>({
    soql: `SELECT NullableText__c FROM ${PROBE_OBJECT} WHERE Id = '${equalId}'`,
    api: "rest",
    maxRows: 1,
  });
  if (!hasSameTokens(equal.records[0]?.NullableText__c, UNORDERED_BEFORE_TOKENS)) {
    throw new Error(
      `Equal or omitted before-save tokens were ${equal.records[0]?.NullableText__c ?? "missing"}.`,
    );
  }
  const equalAfter = await session.query<{ NullableText__c?: string }>({
    soql: `SELECT NullableText__c FROM ${PROBE_OBJECT} WHERE Parent__c = '${equalId}' AND Stage__c = 'order-equal-evidence'`,
    api: "rest",
    maxRows: 5,
  });
  const afterTokens = equalAfter.records.map((row) => row.NullableText__c ?? "").join(";");
  if (!hasSameTokens(afterTokens, UNORDERED_AFTER_TOKENS)) {
    throw new Error(`Equal after-save tokens were ${afterTokens || "missing"}.`);
  }
  console.log(
    "✅ order runtime: explicit B10;B20 and A10;A20 · equal/omitted tokens present without an order assertion",
  );
}

function flowOutput(result: FlowActionResult, name: string): string | undefined {
  const value = result.outputValues?.[name] ?? result[name as keyof FlowActionResult];
  return typeof value === "string" ? value : undefined;
}

async function invokeFlow(
  session: SalesforceSession,
  name: string,
  input: Record<string, unknown>,
): Promise<{ status: number; result: FlowActionResult }> {
  const response = await session.request<FlowActionResult[] | FlowActionResult>({
    method: "POST",
    path: `/actions/custom/flow/${name}`,
    body: { inputs: [input] },
  });
  const result = Array.isArray(response.body) ? (response.body[0] ?? {}) : (response.body ?? {});
  return { status: response.status, result };
}

async function markerCount(session: SalesforceSession, correlationKey: string): Promise<number> {
  const rows = await session.query<{ Id?: string }>({
    soql: `SELECT Id FROM ${PROBE_OBJECT} WHERE CorrelationKey__c = '${correlationKey}' AND Stage__c = 'subflow-marker'`,
    api: "rest",
    maxRows: 5,
  });
  return rows.totalSize ?? rows.records.length;
}

async function exerciseSubflowChain(session: SalesforceSession, prefix: string): Promise<void> {
  const successKey = `${prefix}subflow-success`;
  const handledKey = `${prefix}subflow-handled`;
  const unhandledKey = `${prefix}subflow-unhandled`;
  const noneKey = `${prefix}subflow-none`;
  const success = await invokeFlow(session, "SfPi_Advanced_Subflow_Chain_Parent", {
    inputText: "chain",
    faultMode: "success",
    correlationKey: successKey,
    externalKey: successKey,
  });
  if (
    success.result.isSuccess !== true ||
    flowOutput(success.result, "outputText") !== SUCCESS_CHAIN_OUTPUT
  ) {
    throw new Error(`Success chain returned ${JSON.stringify(success.result)}.`);
  }
  if ((await markerCount(session, successKey)) !== 1) {
    throw new Error("Success chain did not commit its marker.");
  }

  const handled = await invokeFlow(session, "SfPi_Advanced_Subflow_Chain_Parent", {
    inputText: "chain",
    faultMode: "handled",
    correlationKey: handledKey,
    externalKey: handledKey,
  });
  if (
    handled.result.isSuccess !== true ||
    flowOutput(handled.result, "outputText") !== HANDLED_CHAIN_OUTPUT
  ) {
    throw new Error(`Handled chain returned ${JSON.stringify(handled.result)}.`);
  }
  if ((await markerCount(session, handledKey)) !== 1) {
    throw new Error("Handled child fault did not commit the parent marker.");
  }

  const unhandled = await invokeFlow(session, "SfPi_Advanced_Subflow_Chain_Parent", {
    inputText: "chain",
    faultMode: "unhandled",
    correlationKey: unhandledKey,
    externalKey: unhandledKey,
  });
  if (unhandled.result.isSuccess === true) {
    throw new Error(`Unhandled chain unexpectedly succeeded: ${JSON.stringify(unhandled.result)}.`);
  }
  if ((await markerCount(session, unhandledKey)) !== 0) {
    throw new Error("Unhandled child fault did not roll back the parent marker.");
  }

  const none = await invokeFlow(session, "SfPi_Advanced_Subflow_Chain_Parent", {
    inputText: "chain",
    faultMode: "none",
    correlationKey: noneKey,
    externalKey: noneKey,
  });
  const noneResult = {
    isSuccess: none.result.isSuccess,
    outputText: flowOutput(none.result, "outputText"),
    faultMessage: flowOutput(none.result, "faultMessage"),
  };
  if (!noneTriggerSubflowRejected(noneResult)) {
    throw new Error(
      `triggerType None child ran as a normal subflow: ${JSON.stringify(none.result)}.`,
    );
  }
  console.log(
    `✅ subflow runtime: success output propagated · handled fault committed · unhandled fault rolled back · None trigger rejected (${noneResult.faultMessage || noneResult.outputText || none.status})`,
  );
}

async function deleteQueryIds(
  session: SalesforceSession,
  object: string,
  soql: string,
): Promise<number> {
  const rows = await session.query<{ Id?: string }>({ soql, api: "rest", maxRows: 500 });
  const ids = rows.records.flatMap((row) => (row.Id ? [row.Id] : []));
  for (const id of ids) await deleteRecord(session, object, id);
  return ids.length;
}

async function cleanupKnownResidue(session: SalesforceSession): Promise<void> {
  await deleteProbePrefix(session, DEPTH_CORRELATION_PREFIX);
  const tasks = await deleteQueryIds(
    session,
    "Task",
    "SELECT Id FROM Task WHERE Subject LIKE 'SF Pi related review:%' OR Subject LIKE 'SFPI Delete %' OR Subject LIKE 'SFPI Schedule %' OR Subject LIKE 'prior=%;current=%' OR Subject = 'SFPI async-after-commit evidence'",
  );
  const contacts = await deleteQueryIds(
    session,
    "Contact",
    "SELECT Id FROM Contact WHERE Email LIKE 'schedule-%@example.test' OR LastName = 'SFPI Async Path Contact'",
  );
  const accounts = await deleteQueryIds(
    session,
    "Account",
    "SELECT Id FROM Account WHERE AccountNumber IN ('SFPI-ADVANCED-BULK','SFPI-ADVANCED-PRIOR','SFPI-ADVANCED-PIPELINE','SFPI-ADVANCED-PRIOR-AFTER','SFPI-ADVANCED-DELETE','SFPI-ADVANCED-SCHEDULE','SFPI-ADVANCED-BEFORE-COLLECTION','SFPI-ADVANCED-CREATE-UPDATE','SFPI-ADVANCED-PATHS','SFPI-ADVANCED-CUSTOM-ERROR','SFPI-ADVANCED-DATA-OPS')",
  );
  const opportunities = await deleteQueryIds(
    session,
    "Opportunity",
    "SELECT Id FROM Opportunity WHERE Name LIKE 'SFPI AND%' OR Name LIKE 'SFPI OR%' OR Name LIKE 'SFPI CUSTOM%' OR Name LIKE 'SFPI FORMULA%'",
  );
  const waitProbes = await deleteQueryIds(
    session,
    PROBE_OBJECT,
    "SELECT Id FROM SfPi_Flow_Probe__c WHERE Stage__c IN ('resumed','wait-fault') OR CorrelationKey__c LIKE 'SFPI-ADVANCED-WAIT-%'",
  );
  console.log(
    `✅ residue cleanup: probes · tasks=${tasks} · contacts=${contacts} · accounts=${accounts} · opportunities=${opportunities} · wait=${waitProbes}`,
  );
}

async function main(): Promise<void> {
  const args = parseAdvancedArgs(process.argv.slice(2));
  if (!args.org) {
    throw new Error(
      "Usage: npm run e2e:sf-flow-advanced -- --org <non-production-alias> [--deploy | --runtime | --cleanup]",
    );
  }
  await diagnoseFixtures();
  const session = await connectSalesforce({ cwd: process.cwd(), targetOrg: args.org, fresh: true });
  if (session.target.orgType === "production" || session.target.orgType === "unknown") {
    throw new Error(`Refusing advanced Flow sweep for org type ${session.target.orgType}.`);
  }
  if (Number.parseFloat(session.target.apiVersion) < 67) {
    throw new Error("The advanced Flow sweep requires API 67.0 or later.");
  }

  console.log(
    `Target: ${args.org} · type=${session.target.orgType} · API ${session.target.apiVersion} · mode=${args.runtime ? "runtime" : args.cleanup ? "cleanup" : args.deploy ? "check+deploy" : "check-only"}`,
  );
  if (args.cleanup) {
    const assignmentId = await assignProbePermissionSet(session);
    try {
      await deactivateFixtures(session);
      await cleanupKnownResidue(session);
      await verifyInactiveAndClean(session);
    } finally {
      await removeProbePermissionSetAssignment(session, assignmentId);
    }
    console.log("Advanced Flow fixture cleanup passed.");
    return;
  }
  await deployComponents(session, FORCE_APP, { checkOnly: true });
  if (!args.deploy) {
    console.log("Advanced Flow sweep plan complete. Re-run with --deploy or --runtime.");
    return;
  }

  await deployComponents(session, FORCE_APP, { checkOnly: false });
  if (!args.runtime) {
    await deactivateFixtures(session);
    const assignmentId = await assignProbePermissionSet(session);
    try {
      await verifyInactiveAndClean(session);
    } finally {
      await removeProbePermissionSetAssignment(session, assignmentId);
    }
    console.log("Advanced Flow Draft deployment passed.");
    return;
  }

  const farScheduleStart = await resolveScheduleStart(session, 30);
  console.log(
    `Schedule hold: ${farScheduleStart.date} ${farScheduleStart.time} · activating user timezone=${farScheduleStart.timeZone}`,
  );
  const scheduleFixture: ScheduleFixture = { accountIds: [], contactIds: [] };
  const asyncPathFixture: AsyncPathFixture = {};
  const waitResumeFixture: WaitResumeFixture = {
    key: `SFPI-ADVANCED-WAIT-${Date.now()}`,
    interviewLabel: "",
  };
  waitResumeFixture.interviewLabel = `SF Pi Wait ${waitResumeFixture.key}`;
  const depthPrefix = `${DEPTH_CORRELATION_PREFIX}${Date.now()}-`;
  let depthSources: DepthSources | undefined;
  let stagedRoot: string | undefined;
  let probePermissionSetAssignmentId: string | undefined;
  let primaryError: unknown;
  const cleanupErrors: string[] = [];
  try {
    probePermissionSetAssignmentId = await assignProbePermissionSet(session);
    await deleteProbePrefix(session, DEPTH_CORRELATION_PREFIX);
    await assertProbeIsolation(session, false);
    await populateScheduleFixture(session, scheduleFixture);
    depthSources = await populateDepthSources(session, depthPrefix);
    stagedRoot = await stageRuntimeSource(farScheduleStart);
    await deployComponents(session, path.join(stagedRoot, "force-app"), {
      checkOnly: true,
      tests: APEX_TEST_CLASSES,
    });
    const nearScheduleStart = await resolveScheduleStart(session, 20);
    await restageScheduledStarts(stagedRoot, nearScheduleStart);
    console.log(`Schedule fire: ${nearScheduleStart.date} ${nearScheduleStart.time}`);
    await deployComponents(session, path.join(stagedRoot, "force-app"), {
      checkOnly: false,
      tests: APEX_TEST_CLASSES,
    });
    await assertProbeIsolation(session, true);
    await exerciseAsyncBulk(session, depthSources);
    await exerciseOrder(session, depthPrefix);
    await exerciseSubflowChain(session, depthPrefix);
    await startWaitResume(session, waitResumeFixture);
    await exerciseAsyncPath(session, asyncPathFixture);
    await waitForProbeEvidence(session, {
      correlationKey: depthSources.scheduleKey,
      stage: "schedule-bulk-evidence",
      expectedKeys: depthSources.scheduleKeys,
      expectedParents: depthSources.scheduleIds,
      timeoutSeconds: await scheduleWaitSeconds(session, "SfPi_Advanced_Scheduled_Bulk"),
    });
    console.log(
      "✅ schedule runtime: 201 records once · no partition-size or global-index assertion",
    );
    await waitForScheduleEvidence(
      session,
      scheduleFixture,
      await scheduleWaitSeconds(session, "SfPi_Advanced_Scheduled_Pipeline"),
    );
    await waitForWaitResume(session, waitResumeFixture);
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanup = async (label: string, action: () => Promise<void>): Promise<void> => {
      try {
        await action();
      } catch (error) {
        cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    await cleanup("deactivate", () => deactivateFixtures(session));
    await cleanup("async path", () => cleanupAsyncPathFixture(session, asyncPathFixture));
    await cleanup("wait", () => cleanupWaitResumeFixture(session, waitResumeFixture));
    await cleanup("schedule", () => cleanupScheduleFixture(session, scheduleFixture));
    await cleanup("depth probes", () => cleanupKnownResidue(session));
    await cleanup("verify", () => verifyInactiveAndClean(session));
    await cleanup("permission", () =>
      removeProbePermissionSetAssignment(session, probePermissionSetAssignmentId),
    );
    if (stagedRoot) await rm(stagedRoot, { recursive: true, force: true });
  }
  if (primaryError) {
    const primary = primaryError instanceof Error ? primaryError.message : String(primaryError);
    throw new Error(
      cleanupErrors.length ? `${primary} | cleanup: ${cleanupErrors.join(" | ")}` : primary,
    );
  }
  if (cleanupErrors.length) {
    throw new Error(`Advanced Flow cleanup failed: ${cleanupErrors.join(" | ")}`);
  }
  console.log("SF Flow advanced runtime sweep passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
