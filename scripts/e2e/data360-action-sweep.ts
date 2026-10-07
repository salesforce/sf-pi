/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Data 360 action sweep.
 *
 * The default sweep hardens the public sf_data360 action surface without mutating orgs:
 * - every action is describable through its owning family tool;
 * - required params and safety metadata are present;
 * - dry-run request resolution executes where possible;
 * - required-param omissions produce a useful error/recovery signal.
 *
 * The optional DLO lifecycle uses the same dispatcher with an explicit
 * non-production target, two exact target environment gates, a unique run ID,
 * fixture-ownership preflight, and bounded cleanup/propagation retries.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { connectSalesforce } from "../../lib/common/sf-conn/index.ts";
import { detectEnvironment } from "../../lib/common/sf-environment/detect.ts";
import type { SfEnvironment } from "../../lib/common/sf-environment/types.ts";
import { getPublicData360Actions } from "../../extensions/sf-data360/lib/actions/action-registry.ts";
import { validateConnectLiveResult } from "../lib/d360-connect-openapi.mjs";
import type {
  Data360ActionDefinition,
  SfData360Input,
} from "../../extensions/sf-data360/lib/actions/action-types.ts";
import { runSfData360Action } from "../../extensions/sf-data360/lib/sdk.ts";
import { presentSfData360Result } from "../../extensions/sf-data360/lib/result.ts";
import type { Data360FixtureProfile } from "./data360/fixture-profile.ts";
import {
  buildDloData360LifecyclePlan,
  buildDmoData360LifecyclePlan,
  canRunData360MutationLifecycle,
  runData360LifecyclePlan,
  type Data360LifecycleOutcome,
  type Data360LifecycleStage,
  type Data360MutationLifecycleName,
} from "./data360/lifecycle.ts";

export type Data360SweepStage =
  | "classification"
  | "describe"
  | "metadata"
  | "dry_run"
  | "mutation_gate"
  | "missing_params"
  | "live_read"
  | Data360LifecycleStage;
export type Data360SweepOutcome =
  | "ok"
  | "platform_error"
  | "skipped"
  | "failed"
  | "reachable"
  | "empty"
  | "feature_gated"
  | "not_found_optional"
  | "dependency_missing"
  | "auth_required"
  | "permission_required"
  | Data360LifecycleOutcome;

export interface Data360SweepRecord {
  stage: Data360SweepStage;
  tool: string;
  action: string;
  capability?: string;
  safety?: string;
  outcome: Data360SweepOutcome;
  fail: boolean;
  summary: string;
  params?: Record<string, unknown>;
  error?: string;
  presentation?: string;
  testMode?: string;
  testCapability?: string;
  fixturePolicy?: string;
  artifacts?: Array<{ label: string; path: string; kind: string }>;
  contract?: {
    status: string;
    fail: boolean;
    summary: string;
    operationKey?: string;
    checks?: {
      method: boolean;
      path: boolean;
      responseStatus: boolean;
      requestBody?: string;
      responseBody?: string;
    };
    requestBodyErrors?: string[];
    responseBodyErrors?: string[];
    responseStatusOverride?: { observed: string; declared: string };
    overrideEvidence?: string;
  };
}

interface Data360TestContract {
  action: string;
  mode: string;
  capability: string;
  fixturePolicy: string;
}

export interface Data360SweepOptions {
  targetOrg: string;
  outputDir?: string;
  actions?: string[];
  namespaces?: string[];
  promotionWaves?: string[];
  includeMissingParams?: boolean;
  liveRead?: boolean;
  liveSafePost?: boolean;
  maxLiveRead?: number;
  fixtureProfile?: Data360FixtureProfile;
  contractValidate?: boolean;
  mutationLifecycle?: Data360MutationLifecycleName;
  mutate?: boolean;
  runId?: string;
}

const CONNECT_OPENAPI_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "extensions",
  "sf-data360",
  "registry",
  "connect-openapi-contracts.json",
);
const CONNECT_OPENAPI = JSON.parse(readFileSync(CONNECT_OPENAPI_PATH, "utf8")) as Record<
  string,
  unknown
>;
const CONNECT_OPENAPI_OVERRIDES = JSON.parse(
  readFileSync(
    path.join(path.dirname(CONNECT_OPENAPI_PATH), "connect-openapi-overrides.json"),
    "utf8",
  ),
) as Record<string, unknown>;

const TEST_CONTRACTS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "extensions",
  "sf-data360",
  "registry",
  "action-test-contracts.json",
);
const TEST_CONTRACTS = new Map(
  (
    JSON.parse(readFileSync(TEST_CONTRACTS_PATH, "utf8")) as {
      actions: Data360TestContract[];
    }
  ).actions.map((contract) => [contract.action, contract]),
);

const SKIP_DRY_RUN_IMPLEMENTATION_KINDS = new Set(["journey"]);
const LOCAL_HELPER_ACTIONS = new Set([
  "harmonize.event_date_recommend",
  "harmonize.preview_field_matches",
  "harmonize.smart_datastream.create",
  "harmonize.smart_mapping.suggest",
  "harmonize.standard_mapping.preview",
]);

const SKIP_DRY_RUN_ACTIONS = new Set([
  "prepare.csv_schema.infer",
  "orchestrate.manifest.validate",
  "orchestrate.manifest.plan",
  "orchestrate.manifest.run",
  "orchestrate.ingest_csv.run",
  "orchestrate.make_data_usable.run",
  "discover.action.describe",
  "discover.action.example",
]);

export function buildData360SweepPlan(
  actions: Data360ActionDefinition[],
  options: Pick<
    Data360SweepOptions,
    | "actions"
    | "namespaces"
    | "promotionWaves"
    | "includeMissingParams"
    | "liveRead"
    | "liveSafePost"
    | "maxLiveRead"
    | "fixtureProfile"
  > = {},
): Data360SweepRecord[] {
  const selected = actions.filter((action) => matchesFilters(action, options));
  const records: Data360SweepRecord[] = [];
  let liveReadCount = 0;
  for (const action of selected) {
    const contract = TEST_CONTRACTS.get(action.action);
    records.push({
      ...baseRecord(action, "classification"),
      ...(contract
        ? {
            testMode: contract.mode,
            testCapability: contract.capability,
            fixturePolicy: contract.fixturePolicy,
          }
        : {
            outcome: "failed",
            fail: true,
            summary: "Missing recursive test contract.",
          }),
    });
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
    if (canProbeMutationGate(action)) {
      records.push({
        ...baseRecord(action, "mutation_gate"),
        params: paramsForMutationGate(action),
      });
    }
    if (
      options.includeMissingParams !== false &&
      ((action.requiredParams?.length ?? 0) > 0 || (action.requiredAnyOf?.length ?? 0) > 0)
    ) {
      records.push(baseRecord(action, "missing_params"));
    }
    if (
      (options.liveRead && action.safety === "read") ||
      (options.liveSafePost && action.safety === "safe_post")
    ) {
      const params = paramsForLiveRead(action, options.fixtureProfile);
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

export function paramsForDryRun(action: Data360ActionDefinition): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const required of action.requiredParams ?? []) {
    params[required] = placeholderForParam(required);
  }
  for (const required of action.requiredAnyOf?.[0] ?? []) {
    params[required] ??= placeholderForParam(required);
  }
  return { ...params, ...specialDryRunParams(action) };
}

export function paramsForLiveRead(
  action: Data360ActionDefinition,
  fixtureProfile?: Data360FixtureProfile,
): Record<string, unknown> | undefined {
  if (action.safety !== "read" && action.safety !== "safe_post") return undefined;
  const special = specialLiveParams(action);
  const actionFixtures = fixtureProfile?.actions?.[action.action] ?? {};
  const defaults = fixtureProfile?.defaults ?? {};
  const params: Record<string, unknown> = { ...special, ...actionFixtures };
  const supported = new Set([
    ...(action.requiredParams ?? []),
    ...(action.optionalParams ?? []),
    ...(action.requiredAnyOf ?? []).flat(),
  ]);
  for (const name of supported) {
    if (params[name] === undefined && defaults[name] !== undefined) params[name] = defaults[name];
  }
  if ((action.requiredParams ?? []).some((name) => !hasFixtureValue(params[name])))
    return undefined;
  if (
    action.requiredAnyOf?.length &&
    !action.requiredAnyOf.some((group) => group.every((name) => hasFixtureValue(params[name])))
  ) {
    return undefined;
  }
  if (
    action.safety === "safe_post" &&
    !Object.keys(actionFixtures).length &&
    !Object.keys(special).length
  ) {
    return undefined;
  }
  return params;
}

export function canProbeMutationGate(action: Data360ActionDefinition): boolean {
  if (action.action === "api.request") return true;
  if (action.safety !== "confirmed" && action.safety !== "destructive") return false;
  return !["journey", "local"].includes(action.implementation?.kind ?? "");
}

export function paramsForMutationGate(action: Data360ActionDefinition): Record<string, unknown> {
  if (action.action === "api.request") {
    return {
      method: "POST",
      path: "/ssot/data-lake-objects",
      body: { name: "PiData360MutationGate__dll" },
    };
  }
  return paramsForDryRun(action);
}

export function canDryRun(action: Data360ActionDefinition): boolean {
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

export async function runData360Sweep(
  actions: Data360ActionDefinition[],
  env: SfEnvironment,
  options: Data360SweepOptions,
): Promise<Data360SweepRecord[]> {
  const ctx = { cwd: process.cwd(), hasUI: false } as ExtensionContext;
  const results: Data360SweepRecord[] = [];
  if (options.mutationLifecycle) {
    const session = await connectSalesforce({
      cwd: process.cwd(),
      targetOrg: options.targetOrg,
      timeoutMs: 30_000,
    });
    const gate = canRunData360MutationLifecycle({
      mutate: options.mutate,
      targetOrg: options.targetOrg,
      authenticatedTargets: [
        session.target.targetOrg,
        session.target.alias,
        session.target.username,
      ].filter((value): value is string => Boolean(value)),
      orgType: session.target.orgType,
      runId: options.runId,
      mutationTargetOrg: process.env.SF_PI_DATA360_SWEEP_MUTATION_TARGET_ORG,
      destructiveTargetOrg: process.env.SF_PI_DATA360_SWEEP_ALLOW_DESTRUCTIVE,
    });
    if (gate.ok !== true) throw new Error(gate.reason);
  }

  const actionByName = new Map(actions.map((action) => [action.action, action]));
  const plan = buildData360SweepPlan(actions, options);
  for (const record of plan) {
    results.push(
      await runData360SweepRecord(
        record,
        env,
        ctx,
        options.targetOrg,
        options.contractValidate ? actionByName.get(record.action) : undefined,
      ),
    );
  }
  if (options.mutationLifecycle) {
    if (!options.runId) throw new Error("The mutation lifecycle requires --run-id.");
    const lifecycle =
      options.mutationLifecycle === "dlo"
        ? buildDloData360LifecyclePlan(actions, options.runId)
        : buildDmoData360LifecyclePlan(actions, options.runId);
    results.push(
      ...(await runData360LifecyclePlan(lifecycle, async (input) => {
        const targetInput = { ...input, target_org: options.targetOrg };
        const result = await runSfData360Action(targetInput, env, ctx, undefined, undefined, {
          ownedSweepCleanup: {
            runId: lifecycle.runId,
            mutationTargetOrg: process.env.SF_PI_DATA360_SWEEP_MUTATION_TARGET_ORG,
            destructiveTargetOrg: process.env.SF_PI_DATA360_SWEEP_ALLOW_DESTRUCTIVE,
          },
        });
        const presented = await presentSfData360Result(targetInput, result, "summary");
        return {
          ...result,
          sweepPresentation: {
            text: presented.content[0]?.text,
            artifacts: presented.details.artifacts,
          },
        };
      })),
    );
  }
  return results;
}

async function runData360SweepRecord(
  record: Data360SweepRecord,
  env: SfEnvironment,
  ctx: ExtensionContext,
  targetOrg: string,
  contractAction?: Data360ActionDefinition,
): Promise<Data360SweepRecord> {
  if (record.outcome === "skipped") return record;
  try {
    if (record.stage === "classification") {
      return record.fail
        ? record
        : pass(record, `${record.testMode} · ${record.testCapability} · ${record.fixturePolicy}`);
    }
    if (record.stage === "describe") {
      const result = await runSfData360Action(
        {
          action: "discover.action.describe",
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
      const result = await runSfData360Action(
        {
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
    if (record.stage === "mutation_gate") {
      const result = await runSfData360Action(
        {
          action: record.action,
          target_org: targetOrg,
          params: record.params,
        },
        env,
        ctx,
        undefined,
      );
      const blob = JSON.stringify(result).toLowerCase();
      return result.ok === false &&
        (result.error === "CONFIRMATION_REQUIRED" ||
          blob.includes("allow_mutation") ||
          blob.includes("dry_run"))
        ? pass(record, "mutation blocked before execution")
        : fail(record, "Mutation gate did not block execution without allow_mutation=true.");
    }
    if (record.stage === "live_read") {
      const input: SfData360Input = {
        action: record.action,
        target_org: targetOrg,
        params: record.params,
        output_mode: "summary",
      };
      const result = await runSfData360Action(input, env, ctx, undefined);
      const presented = await presentSfData360Result(input, result, "summary");
      const classified = attachPresentationEvidence(classifyLiveReadResult(record, result), {
        ...result,
        sweepPresentation: {
          text: presented.content[0]?.text,
          artifacts: presented.details.artifacts,
        },
      });
      return contractAction
        ? attachConnectContractEvidence(classified, contractAction, result)
        : classified;
    }
    if (record.stage === "missing_params") {
      try {
        const result = await runSfData360Action(
          {
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

export function classifyLiveReadResult(
  record: Data360SweepRecord,
  result: unknown,
): Data360SweepRecord {
  const data = asRecord(result);
  if (!data) return fail(record, "Live read returned a non-object result.");
  const blob = JSON.stringify(data).toLowerCase();
  if (data.ok === false) {
    if (
      blob.includes("invalid_scope") ||
      blob.includes("auth_required") ||
      blob.includes("tenant ingest auth")
    ) {
      return {
        ...record,
        outcome: "auth_required",
        fail: false,
        summary: String(data.summary ?? data.error ?? "Authentication prerequisite missing"),
      };
    }
    if (
      blob.includes("no access") ||
      blob.includes("access denied") ||
      blob.includes("insufficient access")
    ) {
      return {
        ...record,
        outcome: "permission_required",
        fail: false,
        summary: String(data.summary ?? data.error ?? "Permission prerequisite missing"),
      };
    }
    if (data.status === 404) {
      return {
        ...record,
        outcome: "not_found_optional",
        fail: false,
        summary: String(data.summary ?? "Optional surface not found"),
      };
    }
    if (
      blob.includes("functionality_not_enabled") ||
      blob.includes("not currently enabled") ||
      blob.includes("is not enabled")
    ) {
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
    if (typeof data.status === "number" && data.status >= 500) {
      return {
        ...record,
        outcome: "platform_error",
        fail: false,
        summary: String(data.summary ?? data.error ?? "Salesforce platform error"),
      };
    }
    if (
      blob.includes("missing") ||
      blob.includes("required") ||
      blob.includes("dependency") ||
      blob.includes("no enum constant")
    ) {
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

function metadataOk(record: Data360SweepRecord): Data360SweepRecord {
  const errors: string[] = [];
  if (!record.safety) errors.push("missing safety");
  if (!record.action) errors.push("missing action");
  if (!record.tool) errors.push("missing tool");
  return errors.length ? fail(record, errors.join(", ")) : pass(record, "metadata ok");
}

function baseRecord(action: Data360ActionDefinition, stage: Data360SweepStage): Data360SweepRecord {
  return {
    stage,
    tool: "sf_data360",
    action: action.action,
    capability: action.capability,
    safety: action.safety,
    outcome: "ok",
    fail: false,
    summary: `${stage} planned`,
  };
}

function matchesFilters(
  action: Data360ActionDefinition,
  options: Pick<Data360SweepOptions, "actions" | "namespaces" | "promotionWaves">,
): boolean {
  if (options.namespaces?.length && !options.namespaces.includes(action.namespace)) return false;
  if (
    options.promotionWaves?.length &&
    (!action.promotionWave || !options.promotionWaves.includes(action.promotionWave))
  ) {
    return false;
  }
  if (
    options.actions?.length &&
    !options.actions.includes(action.action) &&
    !options.actions.includes(`${action.namespace}:${action.action}`)
  )
    return false;
  return true;
}

function specialLiveParams(action: Data360ActionDefinition): Record<string, unknown> {
  switch (action.action) {
    case "discover.route":
      return { intent: "list Data 360 data spaces" };
    case "discover.action.search":
      return { query: "data spaces", limit: 5 };
    case "discover.action.describe":
    case "discover.action.example":
      return { action: "prepare.dataspace.list" };
    case "query.metadata.entities":
      return { entityType: "DataModelObject" };
    case "query.sql.run":
      return { sql: "SELECT 1", queryRowLimit: 1 };
    case "query.sql.v1.query":
    case "query.sql.v2.query":
      return { body: { sql: "SELECT 1" } };
    case "orchestrate.intent.plan":
      return { utterance: "inspect Data 360 readiness" };
    case "orchestrate.journey.describe":
      return { journey: "make_data_usable" };
    case "api.request":
      return { method: "GET", path: "/ssot/data-spaces" };
    default:
      return {};
  }
}

function hasFixtureValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function specialDryRunParams(action: Data360ActionDefinition): Record<string, unknown> {
  switch (action.action) {
    case "query.sql.verify_rows":
      return { dloName: "Placeholder__dll" };
    case "api.request":
      return { method: "GET", path: "/ssot/data-spaces" };
    case "connect.auth.pkce_start":
    case "orchestrate.ingest_auth.pkce_interactive":
      return {
        loginUrl: "https://test.salesforce.com",
        clientId: "public-client-id",
        redirectUri: "http://localhost:1717/OauthRedirect",
      };
    case "connect.auth.exchange":
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
  if (name === "asyncMode") return false;
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

export function attachConnectContractEvidence(
  record: Data360SweepRecord,
  action: Data360ActionDefinition,
  result: Record<string, unknown>,
): Data360SweepRecord {
  const actionOverrides = asRecord(CONNECT_OPENAPI_OVERRIDES.actions);
  const contract = validateConnectLiveResult(
    CONNECT_OPENAPI,
    action,
    result,
    asRecord(actionOverrides?.[action.action]),
  ) as NonNullable<Data360SweepRecord["contract"]>;
  if (!contract.fail) return { ...record, contract };
  return {
    ...record,
    outcome: "failed",
    fail: true,
    error: contract.summary,
    summary: contract.summary,
    contract,
  };
}

function attachPresentationEvidence(
  record: Data360SweepRecord,
  result: Record<string, unknown>,
): Data360SweepRecord {
  const presentation = asRecord(result.sweepPresentation);
  if (!presentation) return record;
  const artifacts = Array.isArray(presentation.artifacts)
    ? presentation.artifacts.filter(
        (artifact): artifact is { label: string; path: string; kind: string } => {
          const candidate = asRecord(artifact);
          return (
            typeof candidate?.label === "string" &&
            typeof candidate.path === "string" &&
            typeof candidate.kind === "string"
          );
        },
      )
    : undefined;
  return {
    ...record,
    ...(typeof presentation.text === "string" ? { presentation: presentation.text } : {}),
    ...(artifacts?.length ? { artifacts } : {}),
  };
}

function pass(record: Data360SweepRecord, summary: string): Data360SweepRecord {
  return { ...record, outcome: "ok", fail: false, summary };
}

function fail(record: Data360SweepRecord, summary: string): Data360SweepRecord {
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
  return mkdtempSync(path.join(os.tmpdir(), "pi-data360-action-sweep-"));
}

function writeReports(records: Data360SweepRecord[], outputDir: string): void {
  const stages = [...new Set(records.map((record) => record.stage))];
  const classifications = records.filter((record) => record.stage === "classification");
  const summary = {
    total: records.length,
    failed: records.filter((record) => record.fail).length,
    skipped: records.filter((record) => record.outcome === "skipped").length,
    classifiedActions: classifications.filter((record) => !record.fail).length,
    byStage: Object.fromEntries(
      stages.map((stage) => [stage, records.filter((record) => record.stage === stage).length]),
    ),
    byTestMode: countBy(classifications, (record) => record.testMode ?? "missing"),
    byCapability: countBy(classifications, (record) => record.testCapability ?? "missing"),
    byConnectContractStatus: countBy(
      records.filter((record) => Boolean(record.contract)),
      (record) => record.contract?.status ?? "missing",
    ),
  };
  writeFileSync(
    path.join(outputDir, "data360-action-sweep.json"),
    JSON.stringify({ summary, records }, null, 2),
  );
  const markdown = [
    "# Data 360 Action Sweep",
    "",
    `- Total checks: ${summary.total}`,
    `- Failed checks: ${summary.failed}`,
    `- Skipped checks: ${summary.skipped}`,
    `- Classified actions: ${summary.classifiedActions}`,
    "",
    "## Test Modes",
    "",
    ...Object.entries(summary.byTestMode).map(([mode, count]) => `- ${mode}: ${count}`),
    "",
    "## Capabilities",
    "",
    ...Object.entries(summary.byCapability).map(
      ([capability, count]) => `- ${capability}: ${count}`,
    ),
    "",
    "## Connect OpenAPI live validation",
    "",
    ...Object.entries(summary.byConnectContractStatus).map(
      ([status, count]) => `- ${status}: ${count}`,
    ),
    "",
    "## Lifecycle",
    "",
    ...records
      .filter(
        (record) => record.stage.startsWith("lifecycle_") || record.stage.startsWith("cleanup_"),
      )
      .map(
        (record) =>
          `- ${record.stage} ${record.tool} ${record.action}: ${record.outcome} — ${record.summary}`,
      ),
    "",
    "## Normal tool artifacts",
    "",
    ...records.flatMap((record) =>
      (record.artifacts ?? []).map(
        (artifact) =>
          `- ${record.stage} ${record.tool} ${record.action}: ${artifact.label} — ${artifact.path}`,
      ),
    ),
    "",
    "## Failures",
    "",
    ...records
      .filter((record) => record.fail)
      .map((record) => `- ${record.stage} ${record.tool} ${record.action}: ${record.summary}`),
  ].join("\n");
  writeFileSync(path.join(outputDir, "data360-action-sweep.md"), markdown);
}

function countBy(
  records: Data360SweepRecord[],
  keyFor: (record: Data360SweepRecord) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const key = keyFor(record);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
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

export function parseData360SweepArgs(argv: string[]): Data360SweepOptions {
  const options: Data360SweepOptions = { targetOrg: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--target-org") options.targetOrg = argv[++i] ?? options.targetOrg;
    else if (arg === "--output-dir") options.outputDir = argv[++i];
    else if (arg === "--namespace") (options.namespaces ??= []).push(argv[++i]);
    else if (arg === "--promotion-wave") (options.promotionWaves ??= []).push(argv[++i]);
    else if (arg === "--action") (options.actions ??= []).push(argv[++i]);
    else if (arg === "--no-missing-params") options.includeMissingParams = false;
    else if (arg === "--live-read") options.liveRead = true;
    else if (arg === "--live-safe-post") options.liveSafePost = true;
    else if (arg === "--fixture-profile") {
      const profilePath = path.resolve(argv[++i] ?? "");
      options.fixtureProfile = JSON.parse(
        readFileSync(profilePath, "utf8"),
      ) as Data360FixtureProfile;
    } else if (arg === "--max-live-read") options.maxLiveRead = Number(argv[++i]);
    else if (arg === "--contract-validate") options.contractValidate = true;
    else if (arg === "--mutation-lifecycle") {
      const lifecycle = argv[++i];
      if (lifecycle !== "dlo" && lifecycle !== "dmo") {
        throw new Error(`Unsupported mutation lifecycle: ${lifecycle}`);
      }
      options.mutationLifecycle = lifecycle;
    } else if (arg === "--mutate") options.mutate = true;
    else if (arg === "--run-id") options.runId = argv[++i];
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseData360SweepArgs(process.argv.slice(2));
  if (!options.targetOrg) {
    console.error(
      "Usage: node --experimental-strip-types scripts/e2e/data360-action-sweep.ts --target-org <alias> [--namespace <name>] [--promotion-wave <id>] [--live-read] [--live-safe-post] [--contract-validate] [--fixture-profile <json>] [--mutation-lifecycle dlo|dmo --mutate --run-id <id>]",
    );
    process.exit(2);
  }
  const env = await detectEnvironment(execForSweep, process.cwd());
  const records = await runData360Sweep(getPublicData360Actions(), env, options);
  const outputDir = resolveOutputDir(options.outputDir);
  writeReports(records, outputDir);
  const failed = records.filter((record) => record.fail);
  console.log(`Data 360 action sweep wrote ${outputDir}`);
  console.log(
    `Checks: ${records.length}; failed: ${failed.length}; skipped: ${records.filter((record) => record.outcome === "skipped").length}`,
  );
  if (failed.length) process.exitCode = 1;
}
