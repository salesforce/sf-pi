/* SPDX-License-Identifier: Apache-2.0 */
/** API-native Flow activation, deactivation, and resulting-state verification. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { analyzeFlowSource, resolveFlowFile } from "./analyzer.ts";
import { artifactTimestamp, writeFlowArtifact } from "./artifacts.ts";
import { buildFlowDigest, row, section, toolResultFromDigest } from "./digest.ts";
import { resolveFlowWorkspace } from "./project.ts";
import type { FlowArtifact, SfFlowParams, ToolResult } from "./types.ts";

const DEPLOY_START_TIMEOUT_MS = 60_000;
const DEPLOY_POLL_TIMEOUT_MS = 300_000;
const DEPLOY_POLL_FREQUENCY_MS = 1_000;
const STATE_POLL_TIMEOUT_MS = 30_000;
const STATE_POLL_FREQUENCY_MS = 1_000;
const FLOW_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/u;

export interface FlowDefinitionRecord {
  ApiName?: string;
  Label?: string;
  IsActive?: boolean;
  ActiveVersionId?: string | null;
  LatestVersionId?: string | null;
  VersionNumber?: number | null;
  ProcessType?: string | null;
  TriggerType?: string | null;
  RecordTriggerType?: string | null;
}

export interface FlowVersionRecord {
  VersionNumber?: number | null;
  Status?: string | null;
}

export interface FlowScheduledJob {
  Id?: string;
  State?: string;
  CronJobDetail?: { Name?: string };
}

export interface FlowLifecycleDeploymentResult {
  id?: string;
  success: boolean;
  status?: string;
  component_failures: Array<{
    problem: string;
    line_number?: number;
    column_number?: number;
    full_name?: string;
  }>;
  raw: unknown;
}

export interface FlowLifecycleAdapter {
  getDefinition(
    session: SalesforceSession,
    flowName: string,
  ): Promise<FlowDefinitionRecord | undefined>;
  getVersion(
    session: SalesforceSession,
    flowName: string,
    version: number,
  ): Promise<FlowVersionRecord | undefined>;
  getActiveVersion(
    session: SalesforceSession,
    flowName: string,
    activeVersionId?: string,
  ): Promise<FlowVersionRecord | undefined>;
  getScheduledJobs(session: SalesforceSession, flowName: string): Promise<FlowScheduledJob[]>;
  deploy(input: {
    session: SalesforceSession;
    component_type: "Flow" | "FlowDefinition";
    full_name: string;
    source: string;
    check_only: boolean;
    signal?: AbortSignal;
  }): Promise<FlowLifecycleDeploymentResult>;
}

export interface FlowLifecycleDependencies {
  adapter?: FlowLifecycleAdapter;
  writeArtifact?: (kind: string, filename: string, content: unknown) => Promise<FlowArtifact>;
}

export function stageActiveFlowSource(source: string): string {
  const matches = source.match(/<status>([^<]+)<\/status>/gu) ?? [];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Flow status, found ${matches.length}.`);
  }
  return source.replace(/<status>[^<]+<\/status>/u, "<status>Active</status>");
}

export function flowDefinitionSource(activeVersionNumber: number): string {
  if (!Number.isInteger(activeVersionNumber) || activeVersionNumber < 0) {
    throw new Error("activeVersionNumber must be a non-negative integer");
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<FlowDefinition xmlns="http://soap.sforce.com/2006/04/metadata">',
    `    <activeVersionNumber>${activeVersionNumber}</activeVersionNumber>`,
    "</FlowDefinition>",
    "",
  ].join("\n");
}

export async function getFlowLifecycleStatus(
  params: SfFlowParams,
  session: SalesforceSession,
  dependencies: FlowLifecycleDependencies = {},
): Promise<ToolResult> {
  const flowName = requireFlowName(params.flow_name);
  const adapter = dependencies.adapter ?? defaultFlowLifecycleAdapter;
  const state = await readLifecycleState(adapter, session, flowName);
  if (!state.definition) throw new Error(`Flow not found in the target org: ${flowName}`);
  const artifact = await writeLifecycleArtifact(dependencies, flowName, "status", state);
  return lifecycleStatusResult(params, session, flowName, state, artifact);
}

export async function deployAndActivateFlow(
  params: SfFlowParams,
  cwd: string,
  session: SalesforceSession,
  dependencies: FlowLifecycleDependencies = {},
  signal?: AbortSignal,
): Promise<ToolResult> {
  assertMutationAllowed(params, session);
  if (!params.file) throw new Error("file is required for deploy.activate");
  const workspace = await resolveFlowWorkspace(params.workspace, cwd);
  const file = await resolveFlowFile(params.file, workspace);
  const flowName = flowNameFromFile(file.absolute);
  const source = await readFile(file.absolute, "utf8");
  const analysis = analyzeFlowSource(source, file.display, { profile: "generation" });
  if (analysis.status === "failed" || analysis.summary.high > 0) {
    return blockedLocalResult(params, session, flowName, analysis);
  }

  const activeSource = stageActiveFlowSource(source);
  const adapter = dependencies.adapter ?? defaultFlowLifecycleAdapter;
  const deployment = await executeCheckedDeployment(
    adapter,
    {
      session,
      component_type: "Flow",
      full_name: flowName,
      source: activeSource,
      signal,
    },
    params,
    flowName,
    analysis,
  );
  if ("failure" in deployment) return deployment.failure;
  const { check, deployed } = deployment;

  const state = await waitForActiveState(adapter, session, flowName, undefined, signal);
  const artifact = await writeLifecycleArtifact(dependencies, flowName, "deploy-activate", {
    check: check.raw,
    deploy: deployed.raw,
    verification: state,
  });
  return activationResult({
    params,
    session,
    flowName,
    state,
    check,
    deployed,
    artifact,
    sourceChanged: false,
    kind: "local",
  });
}

export async function activateFlowVersion(
  params: SfFlowParams,
  session: SalesforceSession,
  dependencies: FlowLifecycleDependencies = {},
  signal?: AbortSignal,
): Promise<ToolResult> {
  assertMutationAllowed(params, session);
  const flowName = requireFlowName(params.flow_name);
  const version = requireVersion(params.version);
  const adapter = dependencies.adapter ?? defaultFlowLifecycleAdapter;
  const definition = await adapter.getDefinition(session, flowName);
  if (!definition) throw new Error(`Flow not found in the target org: ${flowName}`);
  const candidate = await adapter.getVersion(session, flowName, version);
  if (!candidate) throw new Error(`Flow version not found: ${flowName} v${version}`);
  const current = await adapter.getActiveVersion(
    session,
    flowName,
    definition.ActiveVersionId ?? undefined,
  );
  if (definition.IsActive === true && current?.VersionNumber === version) {
    const state = await readLifecycleState(adapter, session, flowName);
    const artifact = await writeLifecycleArtifact(
      dependencies,
      flowName,
      "activate-idempotent",
      state,
    );
    return idempotentResult(params, session, flowName, state, artifact, "already active");
  }

  const source = flowDefinitionSource(version);
  const deployment = await executeCheckedDeployment(
    adapter,
    {
      session,
      component_type: "FlowDefinition",
      full_name: flowName,
      source,
      signal,
    },
    params,
    flowName,
  );
  if ("failure" in deployment) return deployment.failure;
  const { check, deployed } = deployment;

  const state = await waitForActiveState(adapter, session, flowName, version, signal);
  const artifact = await writeLifecycleArtifact(dependencies, flowName, "activate-version", {
    check: check.raw,
    deploy: deployed.raw,
    verification: state,
  });
  return activationResult({
    params,
    session,
    flowName,
    state,
    check,
    deployed,
    artifact,
    sourceChanged: false,
    kind: "version",
  });
}

export async function deactivateFlow(
  params: SfFlowParams,
  session: SalesforceSession,
  dependencies: FlowLifecycleDependencies = {},
  signal?: AbortSignal,
): Promise<ToolResult> {
  assertMutationAllowed(params, session);
  const flowName = requireFlowName(params.flow_name);
  const adapter = dependencies.adapter ?? defaultFlowLifecycleAdapter;
  const before = await readLifecycleState(adapter, session, flowName);
  if (!before.definition) throw new Error(`Flow not found in the target org: ${flowName}`);
  if (
    !before.definition.IsActive &&
    !before.definition.ActiveVersionId &&
    before.scheduledJobs.length === 0
  ) {
    const artifact = await writeLifecycleArtifact(
      dependencies,
      flowName,
      "deactivate-idempotent",
      before,
    );
    return idempotentResult(params, session, flowName, before, artifact, "already inactive");
  }

  const source = flowDefinitionSource(0);
  const deployment = await executeCheckedDeployment(
    adapter,
    {
      session,
      component_type: "FlowDefinition",
      full_name: flowName,
      source,
      signal,
    },
    params,
    flowName,
  );
  if ("failure" in deployment) return deployment.failure;
  const { check, deployed } = deployment;

  const state = await waitForInactiveState(adapter, session, flowName, signal);
  const artifact = await writeLifecycleArtifact(dependencies, flowName, "deactivate", {
    check: check.raw,
    deploy: deployed.raw,
    verification: state,
  });
  const digest = buildFlowDigest({
    action: "lifecycle.deactivate",
    kind: "flow_lifecycle",
    status: "pass",
    icon: "⏸️",
    title: "Flow Lifecycle · deactivated",
    org: orgDigest(params, session),
    meta: [flowName],
    rail: lifecycleRail(check, deployed),
    sections: [
      section("🌊", "Flow", [
        row("🏷️", "API Name", flowName),
        row("⏸️", "State", "Inactive"),
        row("🔗", "Active Version ID", state.definition?.ActiveVersionId),
        row("⏲️", "Scheduled Jobs", state.scheduledJobs.length),
      ]),
      section("🛡️", "Mutation", [
        row("✅", "Check-only", check.status ?? "Succeeded"),
        row("✅", "Deployment", deployed.status ?? "Succeeded"),
        row("✅", "Verification", "IsActive=false · ActiveVersionId=null"),
      ]),
    ],
    artifacts: [artifact],
    next_step: "The Flow is inactive; edit or validate source before a later activation.",
  });
  return toolResultFromDigest(digest, {
    flow_name: flowName,
    is_active: false,
    active_version: null,
    deployment_performed: true,
    idempotent: false,
    job_id: deployed.id,
    artifacts: [artifact],
  });
}

async function executeCheckedDeployment(
  adapter: FlowLifecycleAdapter,
  input: {
    session: SalesforceSession;
    component_type: "Flow" | "FlowDefinition";
    full_name: string;
    source: string;
    signal?: AbortSignal;
  },
  params: SfFlowParams,
  flowName: string,
  analysis?: ReturnType<typeof analyzeFlowSource>,
): Promise<
  | { check: FlowLifecycleDeploymentResult; deployed: FlowLifecycleDeploymentResult }
  | { failure: ToolResult }
> {
  const deployment = await runCheckedDeployment(adapter, input);
  if (!deployment.check.success) {
    return {
      failure: deploymentFailureResult(
        params,
        input.session,
        flowName,
        deployment.check,
        false,
        analysis,
      ),
    };
  }
  const deployed = deployment.deployed;
  if (!deployed) {
    throw new Error("Flow lifecycle deployment did not start after check-only passed.");
  }
  if (!deployed.success) {
    return {
      failure: deploymentFailureResult(params, input.session, flowName, deployed, true, analysis),
    };
  }
  return { check: deployment.check, deployed };
}

async function runCheckedDeployment(
  adapter: FlowLifecycleAdapter,
  input: {
    session: SalesforceSession;
    component_type: "Flow" | "FlowDefinition";
    full_name: string;
    source: string;
    signal?: AbortSignal;
  },
): Promise<{
  check: FlowLifecycleDeploymentResult;
  deployed?: FlowLifecycleDeploymentResult;
}> {
  const check = await adapter.deploy({ ...input, check_only: true });
  if (!check.success) return { check };
  return {
    check,
    deployed: await adapter.deploy({ ...input, check_only: false }),
  };
}

interface LifecycleState {
  definition?: FlowDefinitionRecord;
  activeVersion?: FlowVersionRecord;
  scheduledJobs: FlowScheduledJob[];
}

async function readLifecycleState(
  adapter: FlowLifecycleAdapter,
  session: SalesforceSession,
  flowName: string,
): Promise<LifecycleState> {
  const definition = await adapter.getDefinition(session, flowName);
  if (!definition) return { scheduledJobs: [] };
  const [activeVersion, scheduledJobs] = await Promise.all([
    adapter.getActiveVersion(session, flowName, definition.ActiveVersionId ?? undefined),
    adapter.getScheduledJobs(session, flowName),
  ]);
  return { definition, activeVersion, scheduledJobs };
}

async function waitForActiveState(
  adapter: FlowLifecycleAdapter,
  session: SalesforceSession,
  flowName: string,
  version: number | undefined,
  signal?: AbortSignal,
): Promise<LifecycleState> {
  const deadline = Date.now() + STATE_POLL_TIMEOUT_MS;
  let state = await readLifecycleState(adapter, session, flowName);
  while (!activeStateMatches(state, version) && Date.now() < deadline) {
    await delay(STATE_POLL_FREQUENCY_MS, signal);
    state = await readLifecycleState(adapter, session, flowName);
  }
  requireActiveState(flowName, state, version);
  requireScheduledActivation(flowName, state);
  return state;
}

async function waitForInactiveState(
  adapter: FlowLifecycleAdapter,
  session: SalesforceSession,
  flowName: string,
  signal?: AbortSignal,
): Promise<LifecycleState> {
  const deadline = Date.now() + STATE_POLL_TIMEOUT_MS;
  let state = await readLifecycleState(adapter, session, flowName);
  while (!inactiveStateMatches(state) && Date.now() < deadline) {
    await delay(STATE_POLL_FREQUENCY_MS, signal);
    state = await readLifecycleState(adapter, session, flowName);
  }
  if (state.definition?.IsActive || state.definition?.ActiveVersionId) {
    throw new Error(`Flow deactivation verification failed: ${flowName} remains active.`);
  }
  if (state.scheduledJobs.length) {
    throw new Error(
      `Flow deactivation verification failed: ${state.scheduledJobs.length} scheduled job(s) remain.`,
    );
  }
  return state;
}

function activeStateMatches(state: LifecycleState, version: number | undefined): boolean {
  if (!state.definition?.IsActive || !state.definition.ActiveVersionId || !state.activeVersion) {
    return false;
  }
  if (version !== undefined && state.activeVersion.VersionNumber !== version) return false;
  return state.definition.TriggerType !== "Scheduled" || state.scheduledJobs.length > 0;
}

function inactiveStateMatches(state: LifecycleState): boolean {
  return (
    state.definition?.IsActive !== true &&
    !state.definition?.ActiveVersionId &&
    state.scheduledJobs.length === 0
  );
}

function lifecycleStatusResult(
  params: SfFlowParams,
  session: SalesforceSession,
  flowName: string,
  state: LifecycleState,
  artifact: FlowArtifact,
): ToolResult {
  const digest = buildFlowDigest({
    action: "lifecycle.status",
    kind: "flow_lifecycle_status",
    status: "pass",
    icon: "🔎",
    title: "Flow Lifecycle Status",
    org: orgDigest(params, session),
    meta: [flowName],
    rail: [{ kind: "REST", target: "FlowDefinitionView + FlowVersionView" }],
    sections: [
      section("🌊", "Flow", [
        row("🏷️", "API Name", flowName),
        row("🟢", "State", state.definition?.IsActive ? "Active" : "Inactive"),
        row("🔢", "Active Version", state.activeVersion?.VersionNumber),
        row("🆕", "Latest Version", state.definition?.VersionNumber),
        row("🔗", "Active Version ID", state.definition?.ActiveVersionId),
        row("⚡", "Trigger", state.definition?.TriggerType ?? "caller launched"),
        row("⏲️", "Scheduled Jobs", state.scheduledJobs.length),
      ]),
      section("🛡️", "Mutation", [row("✅", "Performed", "none · read-only")]),
    ],
    artifacts: [artifact],
    next_step: state.definition?.IsActive
      ? "Use lifecycle.deactivate before making org-side changes that require inactivity."
      : "Use deploy.activate for local source or lifecycle.activate for one exact existing version.",
  });
  return toolResultFromDigest(digest, {
    flow_name: flowName,
    is_active: state.definition?.IsActive === true,
    active_version: state.activeVersion?.VersionNumber ?? null,
    latest_version: state.definition?.VersionNumber ?? null,
    active_version_id: state.definition?.ActiveVersionId ?? null,
    scheduled_jobs: state.scheduledJobs,
    mutation_performed: false,
    artifacts: [artifact],
  });
}

function activationResult(input: {
  params: SfFlowParams;
  session: SalesforceSession;
  flowName: string;
  state: LifecycleState;
  check: FlowLifecycleDeploymentResult;
  deployed: FlowLifecycleDeploymentResult;
  artifact: FlowArtifact;
  sourceChanged: boolean;
  kind: "local" | "version";
}): ToolResult {
  const activeVersion = input.state.activeVersion?.VersionNumber;
  const digest = buildFlowDigest({
    action: input.kind === "local" ? "deploy.activate" : "lifecycle.activate",
    kind: "flow_lifecycle",
    status: "pass",
    icon: "▶️",
    title: "Flow Lifecycle · activated",
    org: orgDigest(input.params, input.session),
    meta: [input.flowName, ...(activeVersion ? [`v${activeVersion}`] : [])],
    rail: lifecycleRail(input.check, input.deployed),
    sections: [
      section("🌊", "Flow", [
        row("🏷️", "API Name", input.flowName),
        row("▶️", "State", "Active"),
        row("🔢", "Active Version", activeVersion),
        row("🆕", "Latest Version", input.state.definition?.VersionNumber),
        row("⏲️", "Scheduled Jobs", input.state.scheduledJobs.length),
      ]),
      section("🛡️", "Mutation", [
        row("✅", "Check-only", input.check.status ?? "Succeeded"),
        row("✅", "Deployment", input.deployed.status ?? "Succeeded"),
        row("✅", "Verification", "IsActive=true · exact active version observed"),
        row("📝", "Local Source", input.sourceChanged ? "changed" : "unchanged"),
      ]),
    ],
    artifacts: [input.artifact],
    next_step: "Run the smallest relevant Flow test or bounded runtime proof.",
  });
  return toolResultFromDigest(digest, {
    flow_name: input.flowName,
    is_active: true,
    active_version: activeVersion ?? null,
    latest_version: input.state.definition?.VersionNumber ?? null,
    scheduled_jobs: input.state.scheduledJobs,
    deployment_performed: true,
    source_changed: input.sourceChanged,
    check_job_id: input.check.id,
    job_id: input.deployed.id,
    artifacts: [input.artifact],
  });
}

function idempotentResult(
  params: SfFlowParams,
  session: SalesforceSession,
  flowName: string,
  state: LifecycleState,
  artifact: FlowArtifact,
  reason: string,
): ToolResult {
  const active = state.definition?.IsActive === true;
  const digest = buildFlowDigest({
    action: params.action,
    kind: "flow_lifecycle",
    status: "pass",
    icon: active ? "▶️" : "⏸️",
    title: `Flow Lifecycle · ${reason}`,
    org: orgDigest(params, session),
    meta: [flowName],
    sections: [
      section("🌊", "Flow", [
        row("🏷️", "API Name", flowName),
        row(active ? "▶️" : "⏸️", "State", active ? "Active" : "Inactive"),
        row("🔢", "Active Version", state.activeVersion?.VersionNumber),
      ]),
      section("🛡️", "Mutation", [row("✅", "Performed", "none · idempotent")]),
    ],
    artifacts: [artifact],
    next_step: active
      ? "Run the smallest relevant Flow test or bounded runtime proof."
      : "The Flow is ready for editing or a later exact activation.",
  });
  return toolResultFromDigest(digest, {
    flow_name: flowName,
    is_active: active,
    active_version: state.activeVersion?.VersionNumber ?? null,
    deployment_performed: false,
    idempotent: true,
    artifacts: [artifact],
  });
}

function blockedLocalResult(
  params: SfFlowParams,
  session: SalesforceSession,
  flowName: string,
  analysis: ReturnType<typeof analyzeFlowSource>,
): ToolResult {
  const findings = analysis.findings.filter((finding) => finding.severity === "high").slice(0, 10);
  const digest = buildFlowDigest({
    action: "deploy.activate",
    kind: "flow_lifecycle",
    status: "fail",
    icon: "🛑",
    title: "Flow Activation · blocked locally",
    org: orgDigest(params, session),
    meta: [flowName],
    sections: [
      section(
        "🧯",
        "Local Errors",
        findings.map((finding) =>
          row("❌", `${finding.line}:${finding.column}`, `${finding.rule_id} · ${finding.message}`),
        ),
      ),
      section("🛡️", "Mutation", [row("✅", "Performed", "none")]),
    ],
    next_step: "Fix the first high-severity local finding, then run deploy.activate again.",
  });
  return toolResultFromDigest(digest, {
    flow_name: flowName,
    deployment_performed: false,
    local_analysis: analysis,
  });
}

function deploymentFailureResult(
  params: SfFlowParams,
  session: SalesforceSession,
  flowName: string,
  deployment: FlowLifecycleDeploymentResult,
  deploymentPerformed: boolean,
  analysis?: ReturnType<typeof analyzeFlowSource>,
): ToolResult {
  const digest = buildFlowDigest({
    action: params.action,
    kind: "flow_lifecycle",
    status: "fail",
    icon: "❌",
    title: `Flow ${deploymentPerformed ? "Deployment" : "Check-Only"} · failed`,
    org: orgDigest(params, session),
    meta: [flowName, ...(deployment.id ? [`job=${shortId(deployment.id)}`] : [])],
    sections: [
      section(
        "🧯",
        "Component Failures",
        deployment.component_failures.length
          ? deployment.component_failures.map((failure) => row("❌", "Flow", failure.problem))
          : [row("❌", "Outcome", deployment.status ?? "Failed")],
      ),
      section("🛡️", "Mutation", [
        row(
          deploymentPerformed ? "⚠️" : "✅",
          "Performed",
          deploymentPerformed
            ? "deployment attempted; resulting state unverified"
            : "none · check-only",
        ),
      ]),
    ],
    next_step: "Fix the first component failure and retry the same lifecycle action.",
  });
  return toolResultFromDigest(digest, {
    flow_name: flowName,
    deployment_performed: deploymentPerformed,
    component_failures: deployment.component_failures,
    local_analysis: analysis,
    job_id: deployment.id,
  });
}

function requireActiveState(flowName: string, state: LifecycleState, version?: number): void {
  if (!state.definition?.IsActive || !state.definition.ActiveVersionId || !state.activeVersion) {
    throw new Error(
      `Flow activation verification failed: ${flowName} did not reach a complete active state ` +
        `(IsActive=${String(state.definition?.IsActive)}, ` +
        `ActiveVersionId=${state.definition?.ActiveVersionId ?? "null"}, ` +
        `ActiveVersion=${state.activeVersion?.VersionNumber ?? "none"}).`,
    );
  }
  if (version !== undefined && state.activeVersion.VersionNumber !== version) {
    throw new Error(
      `Flow activation verification failed: requested v${version}, observed v${state.activeVersion.VersionNumber ?? "unknown"}.`,
    );
  }
}

function requireScheduledActivation(flowName: string, state: LifecycleState): void {
  if (state.definition?.TriggerType === "Scheduled" && state.scheduledJobs.length === 0) {
    throw new Error(`Flow activation verification failed: ${flowName} has no scheduled job.`);
  }
}

function assertMutationAllowed(params: SfFlowParams, session: SalesforceSession): void {
  if (!params.target_org?.trim()) {
    throw new Error("target_org is required for Flow lifecycle mutations");
  }
  if (params.allow_mutation !== true) {
    throw new Error("allow_mutation=true is required for Flow lifecycle mutations");
  }
  if (session.target.orgType === "production" || session.target.orgType === "unknown") {
    throw new Error(`Refusing Flow lifecycle mutation for org type ${session.target.orgType}.`);
  }
}

function requireFlowName(value: string | undefined): string {
  const name = value?.trim();
  if (!name || !FLOW_NAME_RE.test(name)) {
    throw new Error(
      "flow_name must be an exact Flow API name using letters, numbers, and underscores",
    );
  }
  return name;
}

function requireVersion(value: number | undefined): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error("version must be an exact positive Flow version number");
  }
  return Number(value);
}

function flowNameFromFile(file: string): string {
  const base = path.basename(file);
  const name = base.endsWith(".flow-meta.xml")
    ? base.slice(0, -".flow-meta.xml".length)
    : base.endsWith(".flow")
      ? base.slice(0, -".flow".length)
      : "";
  return requireFlowName(name);
}

function orgDigest(params: SfFlowParams, session: SalesforceSession) {
  return {
    alias: session.target.alias ?? params.target_org,
    api_version: session.target.apiVersion,
  };
}

function lifecycleRail(
  check: FlowLifecycleDeploymentResult,
  deploy: FlowLifecycleDeploymentResult,
) {
  return [
    { kind: "POST", target: "/metadata/deploy", detail: `checkOnly=true · ${shortId(check.id)}` },
    { kind: "POST", target: "/metadata/deploy", detail: `checkOnly=false · ${shortId(deploy.id)}` },
    { kind: "REST", target: "FlowDefinitionView + FlowVersionView", detail: "resulting state" },
  ];
}

async function writeLifecycleArtifact(
  dependencies: FlowLifecycleDependencies,
  flowName: string,
  operation: string,
  content: unknown,
): Promise<FlowArtifact> {
  return (dependencies.writeArtifact ?? writeFlowArtifact)(
    "lifecycle",
    `${artifactTimestamp()}-${flowName}-${operation}.json`,
    content,
  );
}

function shortId(value: string | undefined): string {
  if (!value) return "—";
  return value.length > 10 ? `${value.slice(0, 3)}…${value.slice(-4)}` : value;
}

function normalizeFailure(
  value: unknown,
): FlowLifecycleDeploymentResult["component_failures"][number] {
  const failure = (value ?? {}) as Record<string, unknown>;
  return {
    problem: String(failure.problem ?? "Unknown Flow deployment failure"),
    line_number: numberValue(failure.lineNumber),
    column_number: numberValue(failure.columnNumber),
    full_name: stringValue(failure.fullName),
  };
}

const defaultFlowLifecycleAdapter: FlowLifecycleAdapter = {
  async getDefinition(session, flowName) {
    const result = await session.query<FlowDefinitionRecord>({
      soql: `SELECT ApiName, Label, IsActive, ActiveVersionId, LatestVersionId, VersionNumber, ProcessType, TriggerType, RecordTriggerType FROM FlowDefinitionView WHERE ApiName = '${flowName}' LIMIT 1`,
      api: "rest",
      maxRows: 1,
    });
    return result.records[0];
  },
  async getVersion(session, flowName, version) {
    const result = await session.query<FlowVersionRecord>({
      soql: `SELECT VersionNumber, Status FROM FlowVersionView WHERE FlowDefinitionView.ApiName = '${flowName}' AND VersionNumber = ${version} LIMIT 1`,
      api: "rest",
      maxRows: 1,
    });
    return result.records[0];
  },
  async getActiveVersion(session, flowName, activeVersionId) {
    const idFilter =
      activeVersionId && /^[A-Za-z0-9]{15,18}$/u.test(activeVersionId)
        ? `DurableId = '${activeVersionId}'`
        : `FlowDefinitionView.ApiName = '${flowName}' AND Status = 'Active'`;
    const result = await session.query<FlowVersionRecord>({
      soql: `SELECT VersionNumber, Status FROM FlowVersionView WHERE ${idFilter} LIMIT 1`,
      api: "rest",
      maxRows: 1,
    });
    return result.records[0];
  },
  async getScheduledJobs(session, flowName) {
    const result = await session.query<FlowScheduledJob>({
      soql: `SELECT Id, State, CronJobDetail.Name FROM CronTrigger WHERE CronJobDetail.Name LIKE '${flowName}%' LIMIT 20`,
      api: "rest",
      maxRows: 20,
    });
    return result.records;
  },
  async deploy(input) {
    const root = await mkdtemp(path.join(tmpdir(), "sf-flow-lifecycle-"));
    const directory = path.join(
      root,
      input.component_type === "Flow" ? "flows" : "flowDefinitions",
    );
    const filename =
      input.component_type === "Flow"
        ? `${input.full_name}.flow-meta.xml`
        : `${input.full_name}.flowDefinition-meta.xml`;
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), input.source, "utf8");
    try {
      const { ComponentSet } = await import("@salesforce/source-deploy-retrieve");
      const components = ComponentSet.fromSource(root);
      components.apiVersion = input.session.target.apiVersion;
      components.sourceApiVersion = input.session.target.apiVersion;
      const job = await withTimeout(
        () =>
          components.deploy({
            usernameOrConnection: input.session.connection,
            apiOptions: {
              checkOnly: input.check_only,
              rollbackOnError: true,
              testLevel: "NoTestRun",
            },
          }),
        DEPLOY_START_TIMEOUT_MS,
        "Flow lifecycle deployment start",
        input.signal,
      );
      const result = await withTimeout(
        () => job.pollStatus(DEPLOY_POLL_FREQUENCY_MS, Math.ceil(DEPLOY_POLL_TIMEOUT_MS / 1_000)),
        DEPLOY_POLL_TIMEOUT_MS,
        "Flow lifecycle deployment poll",
        input.signal,
        () => job.cancel?.(),
      );
      const response = result.response;
      const rawFailures = response.details?.componentFailures as unknown;
      const failures = rawFailures
        ? Array.isArray(rawFailures)
          ? rawFailures
          : [rawFailures]
        : [];
      return {
        id: response.id,
        success: response.success === true,
        status: response.status,
        component_failures: failures.map(normalizeFailure),
        raw: response,
      };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
};

async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
  cancel?: () => void | Promise<void>,
): Promise<T> {
  if (signal?.aborted) throw new Error(`${label} aborted`);
  let timer: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        const stop = () => {
          void cancel?.();
          reject(new Error(`${label} timed out or was aborted`));
        };
        timer = setTimeout(stop, timeoutMs);
        if (signal) {
          abortHandler = stop;
          signal.addEventListener("abort", stop, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error("Flow lifecycle verification aborted");
  await new Promise<void>((resolve, reject) => {
    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Flow lifecycle verification aborted"));
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
