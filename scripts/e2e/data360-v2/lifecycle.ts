/* SPDX-License-Identifier: Apache-2.0 */
/** Fixture-owned confirmed lifecycle for the Data 360 v2 action sweep. */

import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import type {
  Data360V2ActionDefinition,
  Data360V2Input,
} from "../../../extensions/sf-data360/lib/v2/action-types.ts";

export type V2MutationLifecycleName = "dlo";
export type V2LifecycleStage =
  | "lifecycle_preflight"
  | "lifecycle_plan"
  | "lifecycle_execute"
  | "lifecycle_verify"
  | "cleanup_plan"
  | "cleanup_execute"
  | "cleanup_verify";
export type V2LifecycleOutcome = "ok" | "failed" | "reachable" | "confirmed" | "cleaned";

export interface V2LifecycleRecord {
  stage: V2LifecycleStage;
  tool: string;
  action: string;
  capability?: string;
  safety?: string;
  outcome: V2LifecycleOutcome;
  fail: boolean;
  summary: string;
  params: Record<string, unknown>;
  error?: string;
  presentation?: string;
  artifacts?: Array<{ label: string; path: string; kind: string }>;
}

export interface V2LifecycleCheck extends V2LifecycleRecord {
  dryRun?: boolean;
  allowConfirmed?: boolean;
  expected: "ok" | "present" | "absent";
}

export interface V2MutationLifecyclePlan {
  name: V2MutationLifecycleName;
  runId: string;
  resourceName: string;
  checks: V2LifecycleCheck[];
}

export interface V2MutationGateOptions {
  mutate?: boolean;
  targetOrg: string;
  authenticatedTargets: string[];
  orgType: SfEnvironment["org"]["orgType"];
  runId?: string;
  mutationTargetOrg?: string;
  destructiveTargetOrg?: string;
}

export type V2ActionExecutor = (input: Data360V2Input) => Promise<Record<string, unknown>>;

export interface V2LifecycleRunOptions {
  cleanupAttempts?: number;
  cleanupVerifyAttempts?: number;
  retryDelayMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}

export function buildDloV2LifecyclePlan(
  actions: Data360V2ActionDefinition[],
  runId: string,
): V2MutationLifecyclePlan {
  const create = requireLifecycleAction(actions, "dlo.create", "confirmed");
  const get = requireLifecycleAction(actions, "dlo.get", "read");
  const remove = requireLifecycleAction(actions, "dlo.delete", "destructive");
  const resourceName = `PiV2SweepDlo_${runId}__dll`;
  const getParams = { dloName: resourceName };
  const createParams = { body: buildDloCreateBody(resourceName, runId) };
  return {
    name: "dlo",
    runId,
    resourceName,
    checks: [
      lifecycleCheck(get, "lifecycle_preflight", getParams, "absent"),
      lifecycleCheck(create, "lifecycle_plan", createParams, "ok", { dryRun: true }),
      lifecycleCheck(create, "lifecycle_execute", createParams, "ok", {
        allowConfirmed: true,
      }),
      lifecycleCheck(get, "lifecycle_verify", getParams, "present"),
      lifecycleCheck(remove, "cleanup_plan", getParams, "ok", { dryRun: true }),
      lifecycleCheck(remove, "cleanup_execute", getParams, "ok", {
        allowConfirmed: true,
      }),
      lifecycleCheck(get, "cleanup_verify", getParams, "absent"),
    ],
  };
}

export function canRunV2MutationLifecycle(
  options: V2MutationGateOptions,
): { ok: true } | { ok: false; reason: string } {
  if (!options.mutate) return { ok: false, reason: "Pass --mutate to run the v2 lifecycle." };
  if (!options.runId || !/^[A-Za-z0-9]{8,32}$/.test(options.runId)) {
    return {
      ok: false,
      reason: "The v2 lifecycle requires an 8-32 character alphanumeric run id.",
    };
  }
  if (!options.authenticatedTargets.includes(options.targetOrg)) {
    return {
      ok: false,
      reason: "The explicit target org must match the authenticated environment used by the sweep.",
    };
  }
  if (!["sandbox", "scratch", "developer", "trial"].includes(options.orgType)) {
    return {
      ok: false,
      reason: "The v2 mutation lifecycle runs only against a verified non-production org.",
    };
  }
  if (options.mutationTargetOrg !== options.targetOrg) {
    return {
      ok: false,
      reason: "SF_PI_D360_V2_SWEEP_MUTATION_TARGET_ORG must exactly match --target-org.",
    };
  }
  if (options.destructiveTargetOrg !== options.targetOrg) {
    return {
      ok: false,
      reason: "D360_V2_SWEEP_ALLOW_DESTRUCTIVE must exactly match --target-org.",
    };
  }
  return { ok: true };
}

export async function runV2LifecyclePlan(
  plan: V2MutationLifecyclePlan,
  execute: V2ActionExecutor,
  options: V2LifecycleRunOptions = {},
): Promise<V2LifecycleRecord[]> {
  const records: V2LifecycleRecord[] = [];
  const cleanupAttempts = Math.max(1, Math.min(options.cleanupAttempts ?? 3, 5));
  const cleanupVerifyAttempts = Math.max(1, Math.min(options.cleanupVerifyAttempts ?? 5, 10));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 2_000);
  const wait =
    options.wait ?? ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  for (const check of plan.checks) {
    const input: Data360V2Input = {
      tool: check.tool as Data360V2Input["tool"],
      action: check.action,
      params: check.params,
      ...(check.dryRun ? { dry_run: true } : {}),
      ...(check.allowConfirmed ? { allow_confirmed: true } : {}),
    };
    const maxAttempts =
      check.stage === "cleanup_execute"
        ? cleanupAttempts
        : check.stage === "cleanup_verify"
          ? cleanupVerifyAttempts
          : 1;
    let result: Record<string, unknown> | undefined;
    let error: unknown;
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        result = await execute(input);
        error = undefined;
      } catch (caught) {
        error = caught;
      }
      if (attempts >= maxAttempts || !shouldRetryCleanup(check, result, error)) break;
      await wait(retryDelayMs);
    }
    if (!result) {
      records.push(fail(check, error instanceof Error ? error.message : String(error)));
      if (stopsBeforeMutation(check.stage)) break;
      continue;
    }
    const record = attachPresentationEvidence(
      classifyLifecycleResult(check, result, attempts),
      result,
    );
    records.push(record);
    if (record.fail && stopsBeforeMutation(check.stage)) break;
  }
  return records;
}

function stopsBeforeMutation(stage: V2LifecycleStage): boolean {
  return stage === "lifecycle_preflight" || stage === "lifecycle_plan" || stage === "cleanup_plan";
}

function shouldRetryCleanup(
  check: V2LifecycleCheck,
  result: Record<string, unknown> | undefined,
  error: unknown,
): boolean {
  if (check.stage !== "cleanup_execute" && check.stage !== "cleanup_verify") return false;
  if (error) return true;
  if (check.stage === "cleanup_verify" && result) return !isNotFound(result);
  if (result?.ok !== false) return false;
  const status = typeof result.status === "number" ? result.status : undefined;
  return (
    status === 400 ||
    status === 409 ||
    status === 423 ||
    status === 429 ||
    Boolean(status && status >= 500)
  );
}

function classifyLifecycleResult(
  check: V2LifecycleCheck,
  result: Record<string, unknown>,
  attempts: number,
): V2LifecycleRecord {
  if (check.expected === "absent") {
    if (!isNotFound(result)) {
      return fail(check, `${check.action} expected the sweep-owned resource to be absent.`);
    }
    return {
      ...check,
      outcome: check.stage === "cleanup_verify" ? "cleaned" : "ok",
      fail: false,
      summary:
        check.stage === "cleanup_verify"
          ? attempts === 1
            ? "Sweep-owned resource cleanup verified."
            : `Sweep-owned resource cleanup verified after ${attempts} attempts.`
          : "Sweep-owned resource name is available.",
    };
  }
  if (result.ok === false) {
    return fail(check, String(result.summary ?? result.error ?? `${check.action} failed`));
  }
  if (check.expected === "present") {
    return { ...check, outcome: "reachable", fail: false, summary: "Created resource verified." };
  }
  if (check.stage === "lifecycle_execute") {
    return { ...check, outcome: "confirmed", fail: false, summary: "Confirmed create completed." };
  }
  if (check.stage === "cleanup_execute") {
    return {
      ...check,
      outcome: "cleaned",
      fail: false,
      summary:
        attempts === 1
          ? "Destructive cleanup completed."
          : `Destructive cleanup completed after ${attempts} attempts.`,
    };
  }
  return { ...check, outcome: "ok", fail: false, summary: String(result.summary ?? "Plan ok") };
}

function isNotFound(result: Record<string, unknown>): boolean {
  if (result.status === 404) return true;
  if (result.ok !== false) return false;
  const blob = JSON.stringify(result).toLowerCase();
  return (
    blob.includes("not_found") || blob.includes("does not exist") || blob.includes("doesn't exist")
  );
}

function attachPresentationEvidence(
  record: V2LifecycleRecord,
  result: Record<string, unknown>,
): V2LifecycleRecord {
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

function lifecycleCheck(
  action: Data360V2ActionDefinition,
  stage: V2LifecycleStage,
  params: Record<string, unknown>,
  expected: V2LifecycleCheck["expected"],
  flags: Pick<V2LifecycleCheck, "dryRun" | "allowConfirmed"> = {},
): V2LifecycleCheck {
  return {
    stage,
    tool: action.tool,
    action: action.action,
    capability: action.capability,
    safety: action.safety,
    outcome: "ok",
    fail: false,
    summary: `${stage} planned`,
    params,
    expected,
    ...flags,
  };
}

function requireLifecycleAction(
  actions: Data360V2ActionDefinition[],
  actionName: string,
  safety: Data360V2ActionDefinition["safety"],
): Data360V2ActionDefinition {
  const matches = actions.filter((action) => action.action === actionName);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one v2 registry owner for ${actionName}; found ${matches.length}.`,
    );
  }
  const [action] = matches;
  if (!action) throw new Error(`No v2 registry owner found for ${actionName}.`);
  if (action.safety !== safety) {
    throw new Error(`${action.tool} ${actionName} must remain classified as ${safety}.`);
  }
  return action;
}

function buildDloCreateBody(resourceName: string, runId: string): Record<string, unknown> {
  return {
    name: resourceName,
    label: `Pi V2 Sweep DLO ${runId}`,
    category: "Other",
    dataspaceInfo: [{ name: "default" }],
    dataLakeFieldInputRepresentations: [
      { name: "Id__c", label: "Id", dataType: "Text", isPrimaryKey: true },
      { name: "Name__c", label: "Name", dataType: "Text", isPrimaryKey: false },
    ],
  };
}

function fail(check: V2LifecycleCheck, summary: string): V2LifecycleRecord {
  return { ...check, outcome: "failed", fail: true, summary, error: summary };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
