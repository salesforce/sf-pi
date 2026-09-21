/* SPDX-License-Identifier: Apache-2.0 */
/** API-native one-file Metadata API check-only validation. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { analyzeFlowSource, resolveFlowFile } from "./analyzer.ts";
import { artifactTimestamp, writeFlowArtifact } from "./artifacts.ts";
import { buildFlowDigest, row, section, toolResultFromDigest } from "./digest.ts";
import { resolveFlowWorkspace } from "./project.ts";
import { buildTopologyEvidence } from "./topology.ts";
import type { FlowArtifact, SfFlowParams, ToolResult } from "./types.ts";

const DEPLOY_START_TIMEOUT_MS = 60_000;
const DEPLOY_POLL_TIMEOUT_MS = 180_000;
const DEPLOY_POLL_FREQUENCY_MS = 1_000;

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
  const analysis = analyzeFlowSource(source, file.display, { profile: "generation" });
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
  const result = await adapter.run({
    file: file.absolute,
    source,
    session,
    check_only: true,
    signal,
  });
  const writeArtifact = dependencies.writeArtifact ?? writeFlowArtifact;
  const artifact = await writeArtifact(
    "validation",
    `${artifactTimestamp()}-${path.basename(file.absolute)}.json`,
    result.raw,
  );
  const topology = analysis.model ? buildTopologyEvidence(analysis.model).display : undefined;
  const digest = buildFlowDigest({
    action: "validate.check",
    kind: "flow_validation",
    status: result.success ? "pass" : "fail",
    icon: "✅",
    title: `Flow Check-Only Validation · ${result.success ? "passed" : "failed"}`,
    org: { alias: params.target_org, api_version: session.target?.apiVersion },
    meta: [path.basename(file.absolute), ...(result.id ? [`job=${shortId(result.id)}`] : [])],
    rail: [
      { kind: "Local", target: "Flow diagnostics", detail: analysis.status },
      { kind: "POST", target: "/metadata/deploy", detail: "checkOnly=true · one Flow" },
    ],
    sections: [
      section("🧾", "Validation", [
        row(
          result.success ? "✅" : "❌",
          "Outcome",
          result.status ?? (result.success ? "Succeeded" : "Failed"),
        ),
        row("🧾", "Job", result.id),
        row("🛡️", "Mutation", "none · check-only"),
      ]),
      section(
        "🧯",
        "Component Failures",
        result.component_failures.length
          ? result.component_failures
              .slice(0, 10)
              .map((failure) =>
                row(
                  "❌",
                  failure.line_number
                    ? `${failure.line_number}:${failure.column_number ?? 1}`
                    : "Flow",
                  failure.problem,
                ),
              )
          : [row("✅", "None", "Salesforce accepted the one-file validation")],
      ),
    ],
    topology,
    artifacts: [artifact],
    next_step: result.success
      ? "Run the smallest relevant Flow test when one exists."
      : "Fix the first component failure and validate again.",
  });
  return toolResultFromDigest(digest, {
    check_only: true,
    deployment_performed: false,
    job_id: result.id,
    component_failures: result.component_failures,
    local_analysis: analysis,
    artifacts: [artifact],
  });
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
