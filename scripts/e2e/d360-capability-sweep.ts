/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Repeatable facade-first Data 360 capability sweep.
 *
 * Phase 1: contract/dry-run request resolution for the capability registry.
 * Phase 2: bounded live checks for read and safe POST capabilities where the
 * required params can be supplied without mutating org state.
 *
 *   node --experimental-strip-types scripts/e2e/d360-capability-sweep.ts AgentforceSTDM
 *   node --experimental-strip-types scripts/e2e/d360-capability-sweep.ts --target-org AgentforceSTDM --family Query
 */

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { detectEnvironment } from "../../lib/common/sf-environment/detect.ts";
import type { SfEnvironment } from "../../lib/common/sf-environment/types.ts";
import { runFacade, type D360FacadeInput } from "../../extensions/sf-data360/lib/facade-tool.ts";
import {
  getD360Capabilities,
  getD360Examples,
  type D360Capability,
  type D360OperationSafety,
} from "../../extensions/sf-data360/lib/facade/registry.ts";

export type SweepStage = "contract" | "dry_run" | "live" | "live_skip";

export type SweepOutcome =
  | "contract_ok"
  | "dry_run_ok"
  | "reachable"
  | "empty"
  | "feature_gated"
  | "not_found_optional"
  | "dependency_missing"
  | "skipped_needs_payload"
  | "failed";

export interface SweepPlanOptions {
  targetOrg: string;
  live?: boolean;
  families?: string[];
  capabilities?: string[];
  maxLive?: number;
}

export interface SweepCheck {
  stage: SweepStage;
  capability: string;
  family?: string;
  kind?: string;
  safety?: D360OperationSafety;
  params?: Record<string, unknown>;
  skipReason?: string;
}

export interface SweepRecord extends SweepCheck {
  outcome: SweepOutcome;
  fail: boolean;
  summary: string;
  status?: number;
  error?: string;
  durationMs?: number;
}

interface CliOptions extends SweepPlanOptions {
  outputDir?: string;
  timeoutMs?: number;
  dryRunOnly?: boolean;
}

export function buildCapabilitySweepPlan(
  capabilities: D360Capability[],
  options: SweepPlanOptions,
): SweepCheck[] {
  const selected = capabilities.filter((capability) => matchesFilters(capability, options));
  const checks: SweepCheck[] = [];
  let liveCount = 0;

  for (const capability of selected) {
    if (capability.kind === "runbook") {
      checks.push(baseCheck(capability, "contract"));
    } else {
      checks.push({ ...baseCheck(capability, "dry_run"), params: paramsForDryRun(capability) });
    }

    if (!options.live || !isLiveEligible(capability.safety)) continue;
    const params = paramsForLiveCheck(capability);
    if (!params) {
      checks.push({
        ...baseCheck(capability, "live_skip"),
        skipReason: "No public-safe live params are available yet.",
      });
      continue;
    }
    if (options.maxLive !== undefined && liveCount >= options.maxLive) {
      checks.push({
        ...baseCheck(capability, "live_skip"),
        skipReason: `Skipped after --max-live ${options.maxLive}.`,
      });
      continue;
    }
    checks.push({ ...baseCheck(capability, "live"), params });
    liveCount++;
  }

  return checks;
}

export function paramsForDryRun(capability: D360Capability): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const required of capability.requiredParams ?? capability.operation?.requiredParams ?? []) {
    params[required] = dryRunValue(required);
  }
  return params;
}

export function paramsForLiveCheck(
  capability: D360Capability,
): Record<string, unknown> | undefined {
  if (!isLiveEligible(capability.safety)) return undefined;

  const special = liveParamOverrides[capability.name];
  if (special) return special;

  const required = capability.requiredParams ?? capability.operation?.requiredParams ?? [];
  const example = exampleParams(capability.name);

  if (required.length === 0) {
    if (example && !containsPlaceholderValue(example)) return example;
    return { limit: 1 };
  }

  if (example && !containsPlaceholderValue(example)) return example;
  return undefined;
}

export function containsPlaceholderValue(value: unknown): boolean {
  if (typeof value === "string") {
    return /(^|[^a-z0-9])(Example|Placeholder|SomeDmo|SomeDlo|Replace|ReviewedReal|Dummy)([^a-z0-9]|$)/i.test(
      value,
    );
  }
  if (Array.isArray(value)) return value.some((entry) => containsPlaceholderValue(entry));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      containsPlaceholderValue(entry),
    );
  }
  return false;
}

export function classifySweepResult(
  check: Pick<SweepCheck, "stage" | "capability" | "skipReason">,
  result: Record<string, unknown>,
): Pick<SweepRecord, "outcome" | "fail" | "summary" | "status" | "error"> {
  if (check.stage === "contract") {
    return { outcome: "contract_ok", fail: false, summary: "Runbook capability registered" };
  }
  if (check.stage === "live_skip") {
    return {
      outcome: "skipped_needs_payload",
      fail: false,
      summary: check.skipReason ?? "Skipped live execution",
    };
  }

  const ok = result.ok === true;
  const status = typeof result.status === "number" ? result.status : undefined;
  const summary = stringValue(result.summary) ?? `${check.capability} ${ok ? "ok" : "failed"}`;
  const error = stringValue(result.error) ?? extractError(result);

  if (ok && check.stage === "dry_run") {
    return { outcome: "dry_run_ok", fail: false, summary, status, error };
  }
  if (ok) {
    return {
      outcome: looksEmpty(result.response) ? "empty" : "reachable",
      fail: false,
      summary,
      status,
      error,
    };
  }

  const message = [summary, error, JSON.stringify(result.response ?? "")].join(" ").toLowerCase();
  if (status === 404 || message.includes("not_found") || message.includes("does not exist")) {
    return { outcome: "not_found_optional", fail: false, summary, status, error };
  }
  if (
    status === 401 ||
    status === 403 ||
    message.includes("not visible") ||
    message.includes("permission")
  ) {
    return { outcome: "feature_gated", fail: false, summary, status, error };
  }
  if (
    message.includes("requires") ||
    message.includes("dependency") ||
    message.includes("invalid input") ||
    message.includes("provide a valid recordid") ||
    message.includes("not enabled") ||
    message.includes("feature")
  ) {
    return { outcome: "dependency_missing", fail: false, summary, status, error };
  }

  return { outcome: "failed", fail: true, summary, status, error };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.targetOrg) {
    console.error(
      "Usage: node --experimental-strip-types scripts/e2e/d360-capability-sweep.ts --target-org <alias>",
    );
    process.exit(2);
  }

  const env = await loadEnvironment();
  const runId = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const outputDir = path.resolve(
    options.outputDir ?? path.join(os.tmpdir(), "pi-d360-capability-sweeps", runId),
  );
  mkdirSync(outputDir, { recursive: true });

  const plan = buildCapabilitySweepPlan(getD360Capabilities(), {
    ...options,
    live: !options.dryRunOnly,
  });
  const ctx = createHeadlessContext();
  const records: SweepRecord[] = [];

  console.log(`D360 capability sweep`);
  console.log(`  target_org: ${options.targetOrg}`);
  console.log(`  checks: ${plan.length}`);
  console.log(`  output: ${outputDir}`);

  for (const check of plan) {
    const started = Date.now();
    let classified: Pick<SweepRecord, "outcome" | "fail" | "summary" | "status" | "error">;
    try {
      if (check.stage === "contract" || check.stage === "live_skip") {
        classified = classifySweepResult(check, {});
      } else {
        const input: D360FacadeInput = {
          action: "execute",
          capability: check.capability,
          target_org: options.targetOrg,
          params: check.params,
          dry_run: check.stage === "dry_run",
          timeout_ms: options.timeoutMs,
          output_mode: "summary",
        };
        const result = await runFacade(input, env, ctx, ctx.signal);
        classified = classifySweepResult(check, result);
      }
    } catch (err) {
      classified = classifySweepResult(check, {
        ok: false,
        summary: `${check.capability} threw`,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const record: SweepRecord = {
      ...check,
      ...classified,
      durationMs: Date.now() - started,
    };
    records.push(record);
    const marker = record.fail
      ? "✗"
      : record.outcome === "reachable" || record.outcome === "dry_run_ok"
        ? "✓"
        : "•";
    console.log(`  ${marker} ${record.stage.padEnd(8)} ${record.capability} — ${record.outcome}`);
  }

  const summary = summarize(records);
  const result = {
    ok: summary.failed === 0,
    targetOrg: options.targetOrg,
    runId,
    summary,
    records,
  };
  const jsonPath = path.join(outputDir, "d360-capability-sweep.json");
  const mdPath = path.join(outputDir, "d360-capability-sweep.md");
  writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  writeFileSync(mdPath, renderMarkdown(result));

  console.log(`\nSummary: ${summary.failed} failed / ${records.length} checks`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${mdPath}`);
  process.exit(summary.failed === 0 ? 0 : 1);
}

function baseCheck(capability: D360Capability, stage: SweepStage): SweepCheck {
  return {
    stage,
    capability: capability.name,
    family: capability.family,
    kind: capability.kind,
    safety: capability.safety,
  };
}

function matchesFilters(capability: D360Capability, options: SweepPlanOptions): boolean {
  if (options.families?.length && !options.families.includes(capability.family)) return false;
  if (options.capabilities?.length && !options.capabilities.includes(capability.name)) return false;
  return true;
}

function isLiveEligible(safety: D360OperationSafety | undefined): boolean {
  return safety === "read" || safety === "safe_post";
}

function dryRunValue(paramName: string): unknown {
  if (paramName === "body") return {};
  if (paramName === "sql") return 'SELECT COUNT(*) AS n FROM "ssot__AiAgentSession__dlm"';
  return `SweepDryRun${toPascal(paramName)}`;
}

function toPascal(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function exampleParams(capabilityName: string): Record<string, unknown> | undefined {
  const example = getD360Examples()[capabilityName];
  if (!example || typeof example !== "object" || Array.isArray(example)) return undefined;
  const params = (example as Record<string, unknown>).params;
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : undefined;
}

const liveParamOverrides: Record<string, Record<string, unknown>> = {
  d360_query_sql: {
    dataspaceName: "default",
    sql: 'SELECT COUNT(*) AS n FROM "ssot__AiAgentSession__dlm"',
  },
  d360_metadata_entities: { entityType: "DataModelObject" },
  d360_metadata_search: {
    body: {
      query: "AI Agent Interaction",
      pagination: { limit: 5 },
      filters: [{ field: "metadataType", values: ["DataModelObject"] }],
    },
  },
  d360_dmo_describe: { dmoName: "ssot__AiAgentSession__dlm" },
  d360_dmo_get: { dmoName: "ssot__AiAgentSession__dlm" },
  d360_connection_list: { connectorType: "SalesforceDotCom" },
};

function looksEmpty(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.length === 0;
  const record = value as Record<string, unknown>;
  for (const key of ["records", "data", "items", "results", "segments", "activations"]) {
    if (Array.isArray(record[key]) && record[key].length === 0) return true;
  }
  for (const key of ["total", "totalSize", "count"]) {
    if (record[key] === 0) return true;
  }
  return false;
}

function extractError(result: Record<string, unknown>): string | undefined {
  const response = result.response;
  if (response && typeof response === "object" && !Array.isArray(response)) {
    return stringValue((response as Record<string, unknown>).message);
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function summarize(records: SweepRecord[]): Record<string, number> {
  const summary: Record<string, number> = { total: records.length, failed: 0 };
  for (const record of records) {
    if (record.outcome === "failed") {
      summary.failed++;
    } else {
      summary[record.outcome] = (summary[record.outcome] ?? 0) + 1;
      if (record.fail) summary.failed++;
    }
  }
  return summary;
}

function renderMarkdown(result: {
  ok: boolean;
  targetOrg: string;
  runId: string;
  summary: Record<string, number>;
  records: SweepRecord[];
}): string {
  const lines = [
    `# D360 Capability Sweep`,
    "",
    `- Target org: \`${result.targetOrg}\``,
    `- Run id: \`${result.runId}\``,
    `- Failed checks: ${result.summary.failed}`,
    "",
    "## Outcomes",
    "",
    "| Outcome | Count |",
    "| --- | ---: |",
  ];
  for (const [key, value] of Object.entries(result.summary).filter(([key]) => key !== "total")) {
    lines.push(`| ${key} | ${value} |`);
  }
  lines.push(
    "",
    "## Checks",
    "",
    "| Stage | Capability | Family | Outcome | Summary |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const record of result.records) {
    lines.push(
      `| ${record.stage} | ${record.capability} | ${record.family ?? ""} | ${record.outcome} | ${escapeCell(record.summary)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { targetOrg: process.env.D360_E2E_ORG ?? "", live: true };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--target-org":
      case "-o":
        options.targetOrg = requiredArg(args, ++i, arg);
        break;
      case "--family":
        options.families = [...(options.families ?? []), requiredArg(args, ++i, arg)];
        break;
      case "--capability":
        options.capabilities = [...(options.capabilities ?? []), requiredArg(args, ++i, arg)];
        break;
      case "--max-live":
        options.maxLive = Number(requiredArg(args, ++i, arg));
        break;
      case "--output-dir":
        options.outputDir = requiredArg(args, ++i, arg);
        break;
      case "--timeout-ms":
        options.timeoutMs = Number(requiredArg(args, ++i, arg));
        break;
      case "--dry-run-only":
        options.dryRunOnly = true;
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
        if (!options.targetOrg) options.targetOrg = arg;
        break;
    }
  }
  return options;
}

function requiredArg(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

async function loadEnvironment(): Promise<SfEnvironment> {
  return detectEnvironment((cmd, args) => {
    return new Promise((resolve) => {
      const child = spawn(cmd, args);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("close", (code) => resolve({ stdout, stderr, code }));
    });
  }, process.cwd());
}

function createHeadlessContext(): ExtensionContext {
  const controller = new AbortController();
  return {
    hasUI: false,
    signal: controller.signal,
    ui: {
      select: async () => "Block",
    },
  } as unknown as ExtensionContext;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exit(1);
  });
}
