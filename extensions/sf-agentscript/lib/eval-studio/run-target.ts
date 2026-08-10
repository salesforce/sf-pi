/* SPDX-License-Identifier: Apache-2.0 */
/** Explicit, run-local target review for Studio-owned execution. */

import type { Connection } from "@salesforce/core";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { connFromAlias } from "../../../../lib/common/sf-conn/index.ts";
import {
  resolveAgentIds,
  type AgentVersionResolutionMode,
  type ResolvedAgentIds,
} from "../eval/active-ids.ts";
import type { EvalSpec, TracesMode } from "../eval/types.ts";
import { readEffectiveAgentScriptSettings } from "../settings.ts";
import type { StudioSuiteSummary } from "./types.ts";

export interface StudioRunTarget {
  conn: Connection;
  target_org: string;
  agent_api_name: string;
  version_resolution: AgentVersionResolutionMode;
  version?: number;
  resolved: ResolvedAgentIds;
  traces_mode: TracesMode;
  concurrency: number;
  acknowledge_inactive_version: boolean;
  acknowledge_unverified_evaluators: boolean;
  seed_overrides: Record<string, Record<string, unknown>>;
}

function parseOverrides(value: string): Record<string, Record<string, unknown>> {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Seed overrides must be a JSON object keyed by Scenario id.");
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const [scenario, variables] of Object.entries(parsed as Record<string, unknown>)) {
    if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
      throw new Error(`Seed overrides for '${scenario}' must be an object.`);
    }
    out[scenario] = variables as Record<string, unknown>;
  }
  return out;
}

export async function collectStudioRunTarget(
  ctx: ExtensionCommandContext,
  suite: StudioSuiteSummary,
  historical?: { target_org?: string; version?: number },
): Promise<StudioRunTarget | undefined> {
  if (!suite.agent_api_name) {
    ctx.ui.notify("Assign the Suite to an Agent API name before execution.", "warning");
    return undefined;
  }
  const aliasInput = (
    await ctx.ui.input(
      "Run Target · authenticated org alias",
      historical?.target_org ?? "default target org",
    )
  )?.trim();
  if (aliasInput === undefined) return undefined;
  const alias = aliasInput || historical?.target_org;
  const conn = await connFromAlias(alias || undefined);
  const targetOrg = alias || conn.getUsername() || "<default>";

  let versionResolution: AgentVersionResolutionMode;
  let version = historical?.version;
  if (historical) {
    if (version === undefined) {
      throw new Error("Historical Run has no exact BotVersion number to rerun.");
    }
    versionResolution = "version";
  } else {
    const policyLabel = await ctx.ui.select("Run Target · version policy", [
      "Active",
      "Latest",
      "Pinned version",
    ]);
    if (!policyLabel) return undefined;
    versionResolution =
      policyLabel === "Latest" ? "latest" : policyLabel === "Pinned version" ? "version" : "active";
  }
  if (versionResolution === "version" && version === undefined) {
    const raw = (await ctx.ui.input("Pinned BotVersion.VersionNumber", "1"))?.trim();
    if (!raw) return undefined;
    version = Number(raw);
    if (!Number.isInteger(version) || version < 0)
      throw new Error("Pinned version must be a non-negative integer.");
  }

  const resolved = await resolveAgentIds(conn, suite.agent_api_name, {
    ...(versionResolution === "active" ? { status: "Active" as const } : {}),
    ...(versionResolution === "latest" ? { status: "any" as const } : {}),
    ...(versionResolution === "version" ? { version } : {}),
  });
  let acknowledgeInactiveVersion = false;
  if (resolved.status !== "Active") {
    acknowledgeInactiveVersion = await ctx.ui.confirm(
      "Run a non-Active version?",
      `${suite.agent_api_name} v${resolved.version_number} is ${resolved.status}. This is a one-run acknowledgement.`,
    );
    if (!acknowledgeInactiveVersion) return undefined;
  }

  const settings = readEffectiveAgentScriptSettings(ctx.cwd);
  const tracesChoice = await ctx.ui.select("Run Target · traces", ["failed", "all", "off"]);
  if (!tracesChoice) return undefined;
  const concurrencyRaw = (
    await ctx.ui.input("Run Target · concurrency", String(settings.evalConcurrency))
  )?.trim();
  if (concurrencyRaw === undefined) return undefined;
  const concurrency = Number(concurrencyRaw || settings.evalConcurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new Error("Concurrency must be an integer from 1 to 32.");
  }

  const hasUnverified = suite.projection.scenarios.some((scenario) =>
    scenario.evaluators.some((evaluator) => evaluator.capability !== "live_proven"),
  );
  let acknowledgeUnverifiedEvaluators = false;
  if (hasUnverified) {
    acknowledgeUnverifiedEvaluators = await ctx.ui.confirm(
      "Run Advanced/Unverified evaluators?",
      "Returned evidence remains Unverified and cannot satisfy release readiness. This acknowledgement applies only to this Run.",
    );
    if (!acknowledgeUnverifiedEvaluators) return undefined;
  }

  let seedOverrides: Record<string, Record<string, unknown>> = {};
  if (suite.projection.scenarios.some((scenario) => scenario.seeds.length > 0)) {
    const raw = await ctx.ui.input(
      "Optional one-run Scenario seed overrides",
      '{"scenario_id":{"variable":"value"}} or blank',
    );
    if (raw === undefined) return undefined;
    seedOverrides = parseOverrides(raw);
  }

  const confirmed = await ctx.ui.confirm(
    "Run Agent Script Eval?",
    [
      `Org: ${targetOrg}`,
      `Agent: ${suite.agent_api_name}`,
      `Resolved: v${resolved.version_number} · ${resolved.status} · ${resolved.bot_version_id}`,
      `Planner: ${resolved.planner_id ?? "none"}`,
      `Traces: ${tracesChoice} · Concurrency: ${concurrency}`,
      `Suite: ${suite.path}`,
      `Seed overrides: ${Object.keys(seedOverrides).length} Scenario(s)`,
    ].join("\n"),
  );
  if (!confirmed) return undefined;

  return {
    conn,
    target_org: targetOrg,
    agent_api_name: suite.agent_api_name,
    version_resolution: versionResolution,
    ...(version !== undefined ? { version } : {}),
    resolved,
    traces_mode: tracesChoice as TracesMode,
    concurrency,
    acknowledge_inactive_version: acknowledgeInactiveVersion,
    acknowledge_unverified_evaluators: acknowledgeUnverifiedEvaluators,
    seed_overrides: seedOverrides,
  };
}

export function applyRunSeedOverrides(
  source: EvalSpec,
  overrides: Record<string, Record<string, unknown>>,
): EvalSpec {
  const knownScenarios = new Set(source.tests.map((test) => test.id));
  for (const scenarioId of Object.keys(overrides)) {
    if (!knownScenarios.has(scenarioId)) {
      throw new Error(`Unknown eval Scenario seed override '${scenarioId}'.`);
    }
  }

  const spec = structuredClone(source);
  for (const test of spec.tests) {
    const scenario = overrides[test.id];
    if (!scenario) continue;
    const send = test.steps.find((step) => step.type === "agent.send_message");
    if (!send) throw new Error(`Eval Scenario '${test.id}' has no send step for seed overrides.`);
    const rows = Array.isArray(send.context_variables)
      ? (structuredClone(send.context_variables) as Array<Record<string, unknown>>)
      : [];
    const profile = test.seed_profile ? spec.seed_profiles?.[test.seed_profile] : undefined;
    for (const [name, value] of Object.entries(scenario)) {
      if (!["string", "number", "boolean"].includes(typeof value)) {
        throw new Error(
          `Eval Scenario '${test.id}' seed override '${name}' must be a string, number, or boolean.`,
        );
      }
      const existing = rows.find((row) => row.name === name);
      const binding = profile?.context_variables.find((row) => row.name === name);
      const type = existing?.type ?? binding?.type ?? inferredSeedType(value);
      validateOverrideType(test.id, name, type, value);
      if (existing) {
        existing.value = value;
        existing.type = type;
      } else {
        rows.push({ name, type, value });
      }
    }
    send.context_variables = rows;
  }
  return spec;
}

function inferredSeedType(value: unknown): string {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "string";
}

function validateOverrideType(
  scenarioId: string,
  name: string,
  type: unknown,
  value: unknown,
): void {
  if (typeof type !== "string") return;
  const normalized = type.toLowerCase();
  const expected =
    normalized === "boolean"
      ? "boolean"
      : normalized === "number" || normalized === "integer" || normalized === "long"
        ? "number"
        : normalized === "text" || normalized === "string" || normalized === "id"
          ? "string"
          : undefined;
  if (expected && typeof value !== expected) {
    throw new Error(
      `Eval Scenario '${scenarioId}' seed override '${name}' expected ${type} but received ${typeof value}.`,
    );
  }
}
