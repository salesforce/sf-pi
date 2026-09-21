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
}

export function parseAdvancedArgs(argv: string[]): AdvancedArgs {
  const args: AdvancedArgs = { deploy: false, runtime: false };
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
    if (analysis.summary.high || analysis.summary.moderate) {
      throw new Error(
        `${relative} is not ready: high=${analysis.summary.high} moderate=${analysis.summary.moderate}`,
      );
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
    if (name === "SfPi_Advanced_Scheduled_Pipeline") {
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

async function resolveScheduleStart(session: SalesforceSession): Promise<ScheduleStart> {
  const identity = await session.identity();
  const user = await session.query<{ TimeZoneSidKey?: string }>({
    soql: `SELECT TimeZoneSidKey FROM User WHERE Id = '${identity.user_id}' LIMIT 1`,
    api: "rest",
    maxRows: 1,
  });
  const timeZone = user.records[0]?.TimeZoneSidKey;
  if (!timeZone) throw new Error("Could not resolve the activating user's time zone.");
  // Active check-only and deployment each run the targeted Apex suite before the schedule can fire.
  return { ...scheduleWallClock(new Date(Date.now() + 8 * 60_000), timeZone), timeZone };
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
  const response = await session.request({
    method: "DELETE",
    path: `/sobjects/PermissionSetAssignment/${assignmentId}`,
  });
  if (response.status >= 400 && response.status !== 404) {
    throw new Error(
      `Could not remove probe fixture permission assignment: status ${response.status}.`,
    );
  }
  console.log("✅ permission cleanup: removed probe fixture assignment");
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
    soql: "SELECT Id FROM CronTrigger WHERE CronJobDetail.Name LIKE 'SfPi_Advanced_Scheduled_Pipeline%' LIMIT 5",
    api: "rest",
    maxRows: 5,
  });
  if (
    accounts.records.length ||
    opportunities.records.length ||
    tasks.records.length ||
    contacts.records.length ||
    probes.records.length ||
    interviews.records.length ||
    cron.records.length
  ) {
    throw new Error(
      "Advanced Flow cleanup left records, a paused interview, or a scheduled job behind.",
    );
  }
  console.log(
    "✅ verify: all advanced Flows inactive · no records, paused interviews, or scheduled job",
  );
}

async function main(): Promise<void> {
  const args = parseAdvancedArgs(process.argv.slice(2));
  if (!args.org) {
    throw new Error(
      "Usage: npm run e2e:sf-flow-advanced -- --org <non-production-alias> [--deploy | --runtime]",
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
    `Target: ${args.org} · type=${session.target.orgType} · API ${session.target.apiVersion} · mode=${args.runtime ? "runtime" : args.deploy ? "check+deploy" : "check-only"}`,
  );
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

  const scheduleStart = await resolveScheduleStart(session);
  console.log(
    `Schedule: ${scheduleStart.date} ${scheduleStart.time} · activating user timezone=${scheduleStart.timeZone}`,
  );
  const scheduleFixture: ScheduleFixture = { accountIds: [], contactIds: [] };
  const asyncPathFixture: AsyncPathFixture = {};
  const waitResumeFixture: WaitResumeFixture = {
    key: `SFPI-ADVANCED-WAIT-${Date.now()}`,
    interviewLabel: "",
  };
  waitResumeFixture.interviewLabel = `SF Pi Wait ${waitResumeFixture.key}`;
  let stagedRoot: string | undefined;
  let probePermissionSetAssignmentId: string | undefined;
  try {
    probePermissionSetAssignmentId = await assignProbePermissionSet(session);
    await populateScheduleFixture(session, scheduleFixture);
    stagedRoot = await stageRuntimeSource(scheduleStart);
    await deployComponents(session, path.join(stagedRoot, "force-app"), {
      checkOnly: true,
      tests: APEX_TEST_CLASSES,
    });
    await deployComponents(session, path.join(stagedRoot, "force-app"), {
      checkOnly: false,
      tests: APEX_TEST_CLASSES,
    });
    await startWaitResume(session, waitResumeFixture);
    await exerciseAsyncPath(session, asyncPathFixture);
    await waitForScheduleEvidence(session, scheduleFixture);
    await waitForWaitResume(session, waitResumeFixture);
  } finally {
    try {
      await deactivateFixtures(session);
      await cleanupAsyncPathFixture(session, asyncPathFixture);
      await cleanupWaitResumeFixture(session, waitResumeFixture);
      await cleanupScheduleFixture(session, scheduleFixture);
      await verifyInactiveAndClean(session);
    } finally {
      try {
        await removeProbePermissionSetAssignment(session, probePermissionSetAssignmentId);
      } finally {
        if (stagedRoot) await rm(stagedRoot, { recursive: true, force: true });
      }
    }
  }
  console.log("SF Flow advanced runtime sweep passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
