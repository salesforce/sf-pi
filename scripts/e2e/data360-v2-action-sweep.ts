/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Data 360 v2 action sweep.
 *
 * Phase 1 hardens the public data360_* action surface without mutating orgs:
 * - every action is describable through its owning family tool;
 * - required params and safety metadata are present;
 * - dry-run request resolution executes where possible;
 * - required-param omissions produce a useful error/recovery signal.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { detectEnvironment } from "../../lib/common/sf-environment/detect.ts";
import type { SfEnvironment } from "../../lib/common/sf-environment/types.ts";
import { getData360Actions } from "../../extensions/sf-data360/lib/v2/action-registry.ts";
import type {
  Data360V2ActionDefinition,
  Data360V2Input,
} from "../../extensions/sf-data360/lib/v2/action-types.ts";
import { runData360V2Action } from "../../extensions/sf-data360/lib/v2/dispatcher.ts";

export type V2SweepStage = "describe" | "metadata" | "dry_run" | "missing_params" | "live_read";
export type V2SweepOutcome =
  | "ok"
  | "skipped"
  | "failed"
  | "reachable"
  | "empty"
  | "feature_gated"
  | "not_found_optional"
  | "dependency_missing";

export interface V2SweepRecord {
  stage: V2SweepStage;
  tool: string;
  action: string;
  capability?: string;
  safety?: string;
  outcome: V2SweepOutcome;
  fail: boolean;
  summary: string;
  params?: Record<string, unknown>;
  error?: string;
}

export interface V2SweepOptions {
  targetOrg: string;
  outputDir?: string;
  actions?: string[];
  tools?: string[];
  includeMissingParams?: boolean;
  liveRead?: boolean;
  maxLiveRead?: number;
}

const SKIP_DRY_RUN_IMPLEMENTATION_KINDS = new Set(["journey"]);
const LOCAL_HELPER_ACTIONS = new Set([
  "event_date_recommend",
  "preview_field_matches",
  "smart_datastream.create",
  "smart_mapping.suggest",
  "standard_mapping.preview",
]);

const SKIP_DRY_RUN_ACTIONS = new Set([
  "csv_schema.infer",
  "manifest.validate",
  "manifest.plan",
  "manifest.run",
  "ingest_csv.run",
  "make_data_usable.run",
]);

export function buildV2SweepPlan(
  actions: Data360V2ActionDefinition[],
  options: Pick<
    V2SweepOptions,
    "actions" | "tools" | "includeMissingParams" | "liveRead" | "maxLiveRead"
  > = {},
): V2SweepRecord[] {
  const selected = actions.filter((action) => matchesFilters(action, options));
  const records: V2SweepRecord[] = [];
  let liveReadCount = 0;
  for (const action of selected) {
    records.push(baseRecord(action, "describe"));
    records.push(baseRecord(action, "metadata"));
    if (canDryRun(action)) {
      records.push({ ...baseRecord(action, "dry_run"), params: paramsForDryRun(action) });
    } else {
      records.push({
        ...baseRecord(action, "dry_run"),
        outcome: "skipped",
        fail: false,
        summary: "Skipped dry-run: action needs a fixture or interactive workflow.",
      });
    }
    if (options.includeMissingParams !== false && (action.requiredParams?.length ?? 0) > 0) {
      records.push(baseRecord(action, "missing_params"));
    }
    if (options.liveRead && action.safety === "read") {
      const params = paramsForLiveRead(action);
      if (!params) {
        records.push({
          ...baseRecord(action, "live_read"),
          outcome: "skipped",
          fail: false,
          summary: "Skipped live read: no public-safe live params are available.",
        });
      } else if (options.maxLiveRead !== undefined && liveReadCount >= options.maxLiveRead) {
        records.push({
          ...baseRecord(action, "live_read"),
          outcome: "skipped",
          fail: false,
          summary: `Skipped after --max-live-read ${options.maxLiveRead}.`,
        });
      } else {
        records.push({ ...baseRecord(action, "live_read"), params });
        liveReadCount++;
      }
    }
  }
  return records;
}

export function paramsForDryRun(action: Data360V2ActionDefinition): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const required of action.requiredParams ?? [])
    params[required] = placeholderForParam(required);
  return { ...params, ...specialDryRunParams(action) };
}

export function paramsForLiveRead(
  action: Data360V2ActionDefinition,
): Record<string, unknown> | undefined {
  if (action.safety !== "read") return undefined;
  if ((action.capability ?? "").startsWith("agent_observability.")) return undefined;
  if (action.implementation) return undefined;
  if ((action.requiredParams?.length ?? 0) === 0) return {};
  switch (action.action) {
    case "metadata.entities":
      return { entityType: "DataModelObject" };
    default:
      return undefined;
  }
}

export function canDryRun(action: Data360V2ActionDefinition): boolean {
  if (SKIP_DRY_RUN_ACTIONS.has(action.action)) return false;
  if ((action.capability ?? "").startsWith("agent_observability.")) return false;
  const kind = action.implementation?.kind;
  if (kind && SKIP_DRY_RUN_IMPLEMENTATION_KINDS.has(kind)) return false;
  return true;
}

export function classifyUsefulMissingParamResult(result: unknown): {
  ok: boolean;
  summary: string;
} {
  if (result instanceof Error)
    return {
      ok: /missing required parameter|requires|missing|must be|is required/i.test(result.message),
      summary: result.message,
    };
  const record = asRecord(result);
  if (!record) return { ok: false, summary: "Missing-param result was not structured." };
  if (
    record.ok === false &&
    (record.error || record.suggestion || record.recover_via || record.summary)
  ) {
    return {
      ok: true,
      summary: String(record.error ?? record.summary ?? "Missing params rejected."),
    };
  }
  return { ok: false, summary: "Missing required params did not produce an actionable error." };
}

export async function runV2Sweep(
  actions: Data360V2ActionDefinition[],
  env: SfEnvironment,
  options: V2SweepOptions,
): Promise<V2SweepRecord[]> {
  const ctx = { hasUI: false } as ExtensionContext;
  const plan = buildV2SweepPlan(actions, options);
  const results: V2SweepRecord[] = [];
  for (const record of plan) {
    results.push(await runV2SweepRecord(record, env, ctx, options.targetOrg));
  }
  return results;
}

async function runV2SweepRecord(
  record: V2SweepRecord,
  env: SfEnvironment,
  ctx: ExtensionContext,
  targetOrg: string,
): Promise<V2SweepRecord> {
  if (record.outcome === "skipped") return record;
  try {
    if (record.stage === "describe") {
      const result = await runData360V2Action(
        {
          tool: record.tool as Data360V2Input["tool"],
          action: "action.describe",
          target_org: targetOrg,
          params: { action: record.action },
        },
        env,
        ctx,
        undefined,
      );
      return result.ok === false
        ? fail(record, String(result.summary ?? result.error ?? "action.describe failed"))
        : pass(record, "action.describe ok");
    }
    if (record.stage === "metadata") {
      return metadataOk(record);
    }
    if (record.stage === "dry_run") {
      const result = await runData360V2Action(
        {
          tool: record.tool as Data360V2Input["tool"],
          action: record.action,
          target_org: targetOrg,
          params: record.params,
          dry_run: true,
        },
        env,
        ctx,
        undefined,
      );
      return result.ok === false
        ? fail(record, String(result.summary ?? result.error ?? "dry-run failed"))
        : pass(record, "dry-run ok");
    }
    if (record.stage === "live_read") {
      const result = await runData360V2Action(
        {
          tool: record.tool as Data360V2Input["tool"],
          action: record.action,
          target_org: targetOrg,
          params: record.params,
          output_mode: "summary",
        },
        env,
        ctx,
        undefined,
      );
      return classifyLiveReadResult(record, result);
    }
    if (record.stage === "missing_params") {
      try {
        const result = await runData360V2Action(
          {
            tool: record.tool as Data360V2Input["tool"],
            action: record.action,
            target_org: targetOrg,
            dry_run: !LOCAL_HELPER_ACTIONS.has(record.action),
            params: {},
          },
          env,
          ctx,
          undefined,
        );
        const classified = classifyUsefulMissingParamResult(result);
        return classified.ok ? pass(record, classified.summary) : fail(record, classified.summary);
      } catch (error) {
        const classified = classifyUsefulMissingParamResult(
          error instanceof Error ? error : new Error(String(error)),
        );
        return classified.ok ? pass(record, classified.summary) : fail(record, classified.summary);
      }
    }
    return fail(record, `Unhandled stage ${record.stage}`);
  } catch (error) {
    return fail(record, error instanceof Error ? error.message : String(error));
  }
}

export function classifyLiveReadResult(record: V2SweepRecord, result: unknown): V2SweepRecord {
  const data = asRecord(result);
  if (!data) return fail(record, "Live read returned a non-object result.");
  const blob = JSON.stringify(data).toLowerCase();
  if (data.ok === false) {
    if (blob.includes("functionality_not_enabled") || blob.includes("not currently enabled")) {
      return {
        ...record,
        outcome: "feature_gated",
        fail: false,
        summary: String(data.summary ?? "Feature gated"),
      };
    }
    if (
      blob.includes("not_found") ||
      blob.includes("does not exist") ||
      blob.includes("doesn't exist")
    ) {
      return {
        ...record,
        outcome: "not_found_optional",
        fail: false,
        summary: String(data.summary ?? "Optional surface not found"),
      };
    }
    if (blob.includes("missing") || blob.includes("required") || blob.includes("dependency")) {
      return {
        ...record,
        outcome: "dependency_missing",
        fail: false,
        summary: String(data.summary ?? "Dependency missing"),
      };
    }
    return fail(record, String(data.summary ?? data.error ?? "Live read failed"));
  }
  const response = asRecord(data.response);
  if (response) {
    const count = responseItemCount(response);
    if (count === 0)
      return {
        ...record,
        outcome: "empty",
        fail: false,
        summary: "Live read reachable but empty.",
      };
  }
  return { ...record, outcome: "reachable", fail: false, summary: "Live read reachable." };
}

function responseItemCount(response: Record<string, unknown>): number | undefined {
  if (typeof response.totalSize === "number") return response.totalSize;
  for (const value of Object.values(response)) {
    if (Array.isArray(value)) return value.length;
  }
  return undefined;
}

function metadataOk(record: V2SweepRecord): V2SweepRecord {
  const errors: string[] = [];
  if (!record.safety) errors.push("missing safety");
  if (!record.action) errors.push("missing action");
  if (!record.tool) errors.push("missing tool");
  return errors.length ? fail(record, errors.join(", ")) : pass(record, "metadata ok");
}

function baseRecord(action: Data360V2ActionDefinition, stage: V2SweepStage): V2SweepRecord {
  return {
    stage,
    tool: action.tool,
    action: action.action,
    capability: action.capability,
    safety: action.safety,
    outcome: "ok",
    fail: false,
    summary: `${stage} planned`,
  };
}

function matchesFilters(
  action: Data360V2ActionDefinition,
  options: Pick<V2SweepOptions, "actions" | "tools">,
): boolean {
  if (options.tools?.length && !options.tools.includes(action.tool)) return false;
  if (
    options.actions?.length &&
    !options.actions.includes(action.action) &&
    !options.actions.includes(`${action.tool}:${action.action}`)
  )
    return false;
  return true;
}

function specialDryRunParams(action: Data360V2ActionDefinition): Record<string, unknown> {
  switch (action.action) {
    case "sql.verify_rows":
      return { dloName: "Placeholder__dll" };
    case "rest.request":
      return { method: "GET", path: "/ssot/data-spaces" };
    case "auth.pkce_start":
    case "ingest_auth.pkce_interactive":
      return {
        loginUrl: "https://test.salesforce.com",
        clientId: "public-client-id",
        redirectUri: "http://localhost:1717/OauthRedirect",
      };
    case "auth.exchange":
      return {
        strategy: "pkce",
        loginUrl: "https://test.salesforce.com",
        clientId: "public-client-id",
        redirectUri: "http://localhost:1717/OauthRedirect",
        authorizationCode: "placeholder-code",
        codeVerifier: "placeholder-verifier",
      };
    default:
      return {};
  }
}

function placeholderForParam(name: string): unknown {
  if (name === "body" || name.endsWith("Body")) return { name: "Placeholder" };
  if (name === "sql") return "SELECT 1";
  if (name === "prefixes") return ["GPS"];
  if (name === "dataStreamIds") return ["PlaceholderStream"];
  if (name === "scopes") return ["api", "cdp_ingest_api"];
  if (name.endsWith("Ids")) return ["placeholder-id"];
  if (name.toLowerCase().includes("limit") || name.toLowerCase().includes("polls")) return 1;
  if (name === "redirectUri") return "http://localhost:1717/OauthRedirect";
  if (name === "loginUrl") return "https://test.salesforce.com";
  if (name === "csvPath") return "/tmp/placeholder.csv";
  if (name === "manifestPath") return "/tmp/placeholder-manifest.json";
  if (/name/i.test(name) || /id/i.test(name)) return `Placeholder${toPascalName(name)}`;
  return `placeholder-${name}`;
}

function toPascalName(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function pass(record: V2SweepRecord, summary: string): V2SweepRecord {
  return { ...record, outcome: "ok", fail: false, summary };
}

function fail(record: V2SweepRecord, summary: string): V2SweepRecord {
  return { ...record, outcome: "failed", fail: true, summary, error: summary };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function resolveOutputDir(outputDir?: string): string {
  if (outputDir) {
    mkdirSync(outputDir, { recursive: true });
    return path.resolve(outputDir);
  }
  return mkdtempSync(path.join(os.tmpdir(), "pi-data360-v2-action-sweep-"));
}

function writeReports(records: V2SweepRecord[], outputDir: string): void {
  const summary = {
    total: records.length,
    failed: records.filter((record) => record.fail).length,
    skipped: records.filter((record) => record.outcome === "skipped").length,
    byStage: Object.fromEntries(
      ["describe", "metadata", "dry_run", "missing_params", "live_read"].map((stage) => [
        stage,
        records.filter((record) => record.stage === stage).length,
      ]),
    ),
  };
  writeFileSync(
    path.join(outputDir, "data360-v2-action-sweep.json"),
    JSON.stringify({ summary, records }, null, 2),
  );
  const markdown = [
    "# Data 360 v2 Action Sweep",
    "",
    `- Total checks: ${summary.total}`,
    `- Failed checks: ${summary.failed}`,
    `- Skipped checks: ${summary.skipped}`,
    "",
    "## Failures",
    "",
    ...records
      .filter((record) => record.fail)
      .map((record) => `- ${record.stage} ${record.tool} ${record.action}: ${record.summary}`),
  ].join("\n");
  writeFileSync(path.join(outputDir, "data360-v2-action-sweep.md"), markdown);
}

async function execForSweep(
  command: string,
  args: string[],
  options?: { timeout?: number; cwd?: string },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options?.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = options?.timeout
      ? setTimeout(() => {
          child.kill();
        }, options.timeout)
      : undefined;
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ stdout, stderr, code });
    });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      resolve({ stdout, stderr: String(error), code: 1 });
    });
  });
}

function parseArgs(argv: string[]): V2SweepOptions {
  const options: V2SweepOptions = { targetOrg: "AgentforceSTDM" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--target-org") options.targetOrg = argv[++i] ?? options.targetOrg;
    else if (arg === "--output-dir") options.outputDir = argv[++i];
    else if (arg === "--tool") (options.tools ??= []).push(argv[++i]);
    else if (arg === "--action") (options.actions ??= []).push(argv[++i]);
    else if (arg === "--no-missing-params") options.includeMissingParams = false;
    else if (arg === "--live-read") options.liveRead = true;
    else if (arg === "--max-live-read") options.maxLiveRead = Number(argv[++i]);
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  const env = await detectEnvironment(execForSweep, process.cwd());
  const records = await runV2Sweep(getData360Actions(), env, options);
  const outputDir = resolveOutputDir(options.outputDir);
  writeReports(records, outputDir);
  const failed = records.filter((record) => record.fail);
  console.log(`Data 360 v2 action sweep wrote ${outputDir}`);
  console.log(
    `Checks: ${records.length}; failed: ${failed.length}; skipped: ${records.filter((record) => record.outcome === "skipped").length}`,
  );
  if (failed.length) process.exitCode = 1;
}
