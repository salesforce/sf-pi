/* SPDX-License-Identifier: Apache-2.0 */
/**
 * API-native one-file Metadata API check-only validation.
 *
 * Salesforce applies few semantic checks to Draft Flow versions, so a Draft-only
 * check-only deploy can pass while the saved version is InvalidDraft. Validation
 * therefore runs two lanes: the exact source, then an isolated Active-staged copy.
 * Only the activation lane proves activation readiness.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { analyzeFlowSource, resolveFlowFile } from "./analyzer.ts";
import { artifactTimestamp, writeFlowArtifact } from "./artifacts.ts";
import { buildFlowDigest, row, section, toolResultFromDigest } from "./digest.ts";
import { flowFailureHint } from "./failure-hints.ts";
import { stageActiveFlowSource } from "./lifecycle.ts";
import { resolveFlowWorkspace } from "./project.ts";
import { advanceRepairLoop, type FlowRepairLoopState } from "./repair-loop.ts";
import { groundAnalysis } from "./schema-grounding.ts";
import type { FlowSchemaContext } from "./schema-rules.ts";
import { buildTopologyEvidence } from "./topology.ts";
import type { FlowArtifact, FlowFinding, SfFlowParams, ToolResult } from "./types.ts";

const DEPLOY_START_TIMEOUT_MS = 60_000;
const DEPLOY_POLL_TIMEOUT_MS = 180_000;
const DEPLOY_POLL_FREQUENCY_MS = 1_000;
// The platform usually reports one Flow error per check-only pass, so the budget is larger than
// the edit-feedback loop. A repeated failure signature still stops the loop immediately.
export const VALIDATION_REPAIR_MAX_ROUNDS = 8;

export interface FlowValidationFailure {
  problem: string;
  line_number?: number;
  column_number?: number;
  full_name?: string;
}

export interface FlowValidationResult {
  id?: string;
  success: boolean;
  status?: string;
  component_failures: FlowValidationFailure[];
  raw: unknown;
}

export interface FlowValidationAdapter {
  run(input: {
    file: string;
    source: string;
    session: SalesforceSession;
    check_only: true;
    signal?: AbortSignal;
  }): Promise<FlowValidationResult>;
}

export interface FlowValidationDependencies {
  adapter?: FlowValidationAdapter;
  writeArtifact?: (kind: string, filename: string, content: unknown) => Promise<FlowArtifact>;
  repairState?: FlowRepairLoopState;
  /** Org-schema grounding; when present, schema findings join the builder_ready gate. */
  schemaContext?: FlowSchemaContext;
}

export type FlowValidationLaneName = "draft" | "activation";

export interface FlowValidationLane {
  lane: FlowValidationLaneName;
  status: "passed" | "failed" | "skipped";
  reason?: string;
  job_id?: string;
  failures: Array<FlowValidationFailure & { rule_id?: string; hint?: string }>;
}

export interface FlowValidationLanes {
  lanes: FlowValidationLane[];
  activation_ready: boolean;
  raw: Partial<Record<FlowValidationLaneName, unknown>>;
}

/** Run the Draft lane and the Active-staged lane against one exact source. */
export async function runValidationLanes(
  adapter: FlowValidationAdapter,
  input: { file: string; source: string; session: SalesforceSession; signal?: AbortSignal },
): Promise<FlowValidationLanes> {
  const lanes: FlowValidationLane[] = [];
  const raw: FlowValidationLanes["raw"] = {};
  const status = flowStatus(input.source);
  let activeSource: string | undefined;
  let activationSkip: string | undefined;
  try {
    activeSource = stageActiveFlowSource(input.source);
  } catch (error) {
    activationSkip = error instanceof Error ? error.message : String(error);
  }

  if (status === "Active") {
    lanes.push({ lane: "draft", status: "skipped", reason: "source is Active", failures: [] });
  } else {
    const draft = await adapter.run({ ...input, check_only: true });
    raw.draft = draft.raw;
    lanes.push(laneFromResult("draft", draft));
    if (!draft.success) {
      lanes.push({
        lane: "activation",
        status: "skipped",
        reason: "Draft lane failed",
        failures: [],
      });
      return { lanes, activation_ready: false, raw };
    }
  }

  if (!activeSource) {
    lanes.push({ lane: "activation", status: "skipped", reason: activationSkip, failures: [] });
    return { lanes, activation_ready: false, raw };
  }
  const activation = await adapter.run({ ...input, source: activeSource, check_only: true });
  raw.activation = activation.raw;
  lanes.push(laneFromResult("activation", activation));
  return { lanes, activation_ready: activation.success, raw };
}

function laneFromResult(lane: FlowValidationLaneName, result: FlowValidationResult) {
  return {
    lane,
    status: result.success ? "passed" : "failed",
    job_id: result.id,
    failures: result.component_failures.map((failure) => ({
      ...failure,
      ...flowFailureHint(failure.problem),
    })),
  } satisfies FlowValidationLane;
}

function flowStatus(source: string): string | undefined {
  const matches = [...source.matchAll(/<status>([^<]+)<\/status>/gu)];
  return matches.length === 1 ? matches[0]?.[1]?.trim() : undefined;
}

export function laneLabel(lane: FlowValidationLane): string {
  if (lane.status === "skipped") return `skipped · ${lane.reason ?? "not run"}`;
  if (lane.status === "passed")
    return lane.lane === "draft" ? "passed" : "passed · activation-ready";
  const count = lane.failures.length;
  return `failed · ${count || 1} error${count === 1 || !count ? "" : "s"}`;
}

export function laneFailureFindings(lanes: FlowValidationLane[]): FlowFinding[] {
  return lanes.flatMap((lane) =>
    lane.failures.map((failure) => ({
      rule_id: failure.rule_id ?? "platform-validation",
      severity: "high" as const,
      message: failure.problem,
      line: failure.line_number ?? 0,
      column: failure.column_number ?? 0,
      // Platform failures rarely carry a line, so the problem text keeps signatures distinct.
      element: `${lane.lane}:${failure.problem}`,
    })),
  );
}

export async function validateFlowCheck(
  params: SfFlowParams,
  cwd: string,
  session: SalesforceSession,
  dependencies: FlowValidationDependencies = {},
  signal?: AbortSignal,
): Promise<ToolResult> {
  if (!params.file) throw new Error("file is required for validate.check");
  const workspace = await resolveFlowWorkspace(params.workspace, cwd);
  const file = await resolveFlowFile(params.file, workspace);
  const source = await readFile(file.absolute, "utf8");
  const local = analyzeFlowSource(source, file.display, { profile: "generation" });
  const analysis = dependencies.schemaContext
    ? (await groundAnalysis(local, source, dependencies.schemaContext)).analysis
    : local;
  if (analysis.status === "failed") {
    const digest = buildFlowDigest({
      action: "validate.check",
      kind: "flow_validation",
      status: "fail",
      icon: "✅",
      title: "Flow Check-Only Validation · blocked locally",
      sections: [
        section(
          "🧯",
          "Local Errors",
          analysis.findings
            .slice(0, 10)
            .map((finding) =>
              row(
                "❌",
                `${finding.line}:${finding.column}`,
                `${finding.rule_id} · ${finding.message}`,
              ),
            ),
        ),
      ],
      next_step: "Fix malformed local Flow metadata before org validation.",
    });
    return toolResultFromDigest(digest, {
      check_only: true,
      deployment_performed: false,
      local_analysis: analysis,
    });
  }

  const adapter = dependencies.adapter ?? defaultValidationAdapter;
  const result = await runValidationLanes(adapter, {
    file: file.absolute,
    source,
    session,
    signal,
  });
  const writeArtifact = dependencies.writeArtifact ?? writeFlowArtifact;
  const artifact = await writeArtifact(
    "validation",
    `${artifactTimestamp()}-${path.basename(file.absolute)}.json`,
    { lanes: result.lanes, activation_ready: result.activation_ready, raw: result.raw },
  );
  const repair = dependencies.repairState
    ? advanceRepairLoop(
        dependencies.repairState,
        `validate:${file.absolute}`,
        [
          ...laneFailureFindings(result.lanes),
          ...analysis.findings.filter((finding) => finding.severity === "high"),
        ],
        VALIDATION_REPAIR_MAX_ROUNDS,
      )
    : undefined;
  const draft = result.lanes.find((lane) => lane.lane === "draft");
  const activation = result.lanes.find((lane) => lane.lane === "activation");
  const failed = result.lanes.find((lane) => lane.status === "failed");
  // Some defects are reported only by Flow Builder, never by either check-only lane.
  // Builder parity therefore also requires zero high local findings.
  const localHigh = analysis.findings.filter((finding) => finding.severity === "high");
  const builderReady = result.activation_ready && localHigh.length === 0;
  const outcome = builderReady
    ? "builder-ready"
    : result.activation_ready
      ? "activation-ready · local high findings"
      : draft?.status === "passed"
        ? "draft-ok · not activation-ready"
        : "failed";
  const topology = analysis.model ? buildTopologyEvidence(analysis.model).display : undefined;
  const digest = buildFlowDigest({
    action: "validate.check",
    kind: "flow_validation",
    status: builderReady ? "pass" : "fail",
    icon: "✅",
    title: `Flow Check-Only Validation · ${outcome}`,
    org: { alias: params.target_org, api_version: session.target?.apiVersion },
    meta: [path.basename(file.absolute)],
    rail: [
      { kind: "Local", target: "Flow diagnostics", detail: analysis.status },
      ...result.lanes
        .filter((lane) => lane.status !== "skipped")
        .map((lane) => ({
          kind: "POST",
          target: "/metadata/deploy",
          detail: `checkOnly=true · ${lane.lane} lane${lane.job_id ? ` · ${shortId(lane.job_id)}` : ""}`,
        })),
    ],
    sections: [
      section("🧾", "Readiness", [
        row(laneIcon(draft), "Draft check", draft ? laneLabel(draft) : "not run"),
        row(
          laneIcon(activation),
          "Activation check",
          activation ? laneLabel(activation) : "not run",
        ),
        row(
          localHigh.length ? "❌" : "✅",
          "Local rules",
          localHigh.length
            ? `${localHigh.length} high finding${localHigh.length === 1 ? "" : "s"}`
            : "no high findings",
        ),
        row("🛡️", "Mutation", "none · check-only"),
        ...(repair && repair.status !== "clean"
          ? [row("🔁", "Repair", `${repair.status} · round ${repair.round}/${repair.max_rounds}`)]
          : []),
      ]),
      section(
        "🧯",
        "Component Failures",
        failed
          ? failed.failures.length
            ? failed.failures
                .slice(0, 10)
                .map((failure) =>
                  row(
                    "❌",
                    failure.line_number
                      ? `${failure.line_number}:${failure.column_number ?? 1}`
                      : failed.lane,
                    failure.hint ? `${failure.problem} · fix: ${failure.hint}` : failure.problem,
                  ),
                )
            : [row("❌", failed.lane, "Salesforce rejected the validation without detail")]
          : localHigh.length
            ? localHigh
                .slice(0, 10)
                .map((finding) =>
                  row(
                    "❌",
                    `${finding.line}:${finding.column}`,
                    `${finding.rule_id} · ${finding.message}`,
                  ),
                )
            : [row("✅", "None", "Salesforce accepted both validation lanes")],
      ),
    ],
    topology,
    artifacts: [artifact],
    next_step:
      result.activation_ready && localHigh.length
        ? "Both lanes passed, but Flow Builder reports the listed local findings as errors. Fix the first one and validate again."
        : nextValidationStep(result, repair?.status),
  });
  return toolResultFromDigest(digest, {
    check_only: true,
    deployment_performed: false,
    activation_ready: result.activation_ready,
    builder_ready: builderReady,
    local_high_findings: localHigh.length,
    lanes: result.lanes,
    component_failures: failed?.failures ?? [],
    ...(repair ? { repair_loop: repair } : {}),
    local_analysis: analysis,
    artifacts: [artifact],
  });
}

function laneIcon(lane: FlowValidationLane | undefined): string {
  if (!lane || lane.status === "skipped") return "⏭️";
  return lane.status === "passed" ? "✅" : "❌";
}

function nextValidationStep(result: FlowValidationLanes, repair?: string): string {
  if (result.activation_ready) {
    return "Builder-ready: both lanes passed with no high local findings. Run the smallest relevant Flow test or runtime proof.";
  }
  if (repair === "stopped") {
    return "Repair budget stopped: report the remaining failures to the user instead of editing further.";
  }
  const activation = result.lanes.find((lane) => lane.lane === "activation");
  if (activation?.status === "skipped" && result.lanes[0]?.status === "passed") {
    return `Activation lane did not run (${activation.reason}); add exactly one <status> element and validate again.`;
  }
  return "Fix the first component failure with the smallest edit, then run validate.check again.";
}

const defaultValidationAdapter: FlowValidationAdapter = {
  async run(input) {
    const root = await mkdtemp(path.join(tmpdir(), "sf-flow-check-"));
    const flows = path.join(root, "flows");
    await mkdir(flows, { recursive: true });
    const staged = path.join(flows, path.basename(input.file));
    await writeFile(staged, input.source, "utf8");
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
              checkOnly: true,
              rollbackOnError: true,
              testLevel: "NoTestRun",
            },
          }),
        DEPLOY_START_TIMEOUT_MS,
        "Flow validation start",
        input.signal,
      );
      const deployed = await withTimeout(
        () => job.pollStatus(DEPLOY_POLL_FREQUENCY_MS, Math.ceil(DEPLOY_POLL_TIMEOUT_MS / 1_000)),
        DEPLOY_POLL_TIMEOUT_MS,
        "Flow validation poll",
        input.signal,
        () => job.cancel?.(),
      );
      const response = deployed.response;
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

function normalizeFailure(value: unknown): FlowValidationFailure {
  const failure = (value ?? {}) as Record<string, unknown>;
  return {
    problem: String(failure.problem ?? "Unknown Flow validation failure"),
    line_number: numberValue(failure.lineNumber),
    column_number: numberValue(failure.columnNumber),
    full_name: stringValue(failure.fullName),
  };
}

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

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 3)}…${value.slice(-4)}` : value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
