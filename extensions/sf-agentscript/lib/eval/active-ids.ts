/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolve `$active_*` / `$latest_*` placeholders in an eval spec to live
 * org IDs.
 *
 * Three SOQL hops, all via `Connection.query` (no subprocess):
 *   1. BotDefinition  → bot_id
 *   2. BotVersion (filtered by status, ordered by VersionNumber) → bot_version_id
 *   3. GenAiPlannerDefinition (DeveloperName=`<agent>_v<n>`) → planner_id
 *
 * Two resolution modes — pick based on the workflow:
 *
 *   `Active` (default) — latest BotVersion with Status='Active'. The
 *     version your end users actually see. Use for production smoke
 *     tests and the standard regression loop.
 *
 *   `any`              — latest BotVersion regardless of Status. Use to
 *     regression-test a freshly-published-but-not-yet-activated version
 *     before flipping the activation switch (the "ship → eval → activate"
 *     loop). Surfaced in specs as `$latest_*` placeholders.
 *
 *   Specific `version: N` — a specific historical VersionNumber. Use for
 *     A/B comparisons or pinning regressions to an old-but-known-good
 *     version. Surfaced via `action='resolve_active' version=N`; the
 *     caller bakes the returned ids into the spec directly.
 */

import type { Connection } from "@salesforce/core";

export type StatusFilter = "Active" | "any";

export interface ResolvedAgentIds {
  bot_id: string;
  bot_version_id: string;
  planner_id: string | null;
  version_number: number;
  /**
   * BotVersion.Status of the resolved version. 'Active' means production-
   * serving; anything else (Inactive / InDevelopment / etc) means the
   * regression suite is exercising a non-production version. The orchestrator
   * uses this to enforce the `acknowledge_inactive_version` preflight.
   */
  status: string;
}

export type AgentVersionResolutionMode = "active" | "latest" | "version";

export interface AgentIdInjectionStats {
  create_session_steps: number;
  injected_create_session_steps: number;
  explicit_create_session_steps: number;
}

export interface AgentIdInjectionResult<T> extends AgentIdInjectionStats {
  spec: T;
}

export interface ResolveAgentIdsOptions {
  /**
   * Filter on BotVersion.Status. Default `'Active'` — latest version that
   * end users see. `'any'` returns the latest version regardless of state.
   * Ignored when `version` is set.
   */
  status?: StatusFilter;
  /**
   * Pin to a specific BotVersion.VersionNumber. When set, takes precedence
   * over `status` and surfaces whatever Status that version has.
   */
  version?: number;
}

function soqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Resolve agent ids with explicit filters. The single source of truth for
 * the three placeholder families (`$active_*`, `$latest_*`, and explicit
 * `version` lookups via the resolve_active tool action).
 */
export async function resolveAgentIds(
  conn: Connection,
  agentApiName: string,
  opts: ResolveAgentIdsOptions = {},
): Promise<ResolvedAgentIds> {
  const esc = soqlEscape(agentApiName);

  const bots = await conn.query<{ Id: string }>(
    `SELECT Id FROM BotDefinition WHERE DeveloperName='${esc}'`,
  );
  if (bots.records.length === 0) {
    throw new Error(
      `Agent '${agentApiName}' not found in target org. ` +
        `Suggested fix: verify the DeveloperName via ` +
        `\`sf data query -q "SELECT Id, DeveloperName FROM BotDefinition"\`.`,
    );
  }
  const bot_id = bots.records[0].Id;

  // Build the per-mode WHERE clause + ORDER BY. Specific version pin wins.
  let where: string;
  let mode: "Active" | "any" | "specific";
  if (typeof opts.version === "number") {
    where = `BotDefinitionId='${bot_id}' AND VersionNumber=${opts.version}`;
    mode = "specific";
  } else if (opts.status === "any") {
    where = `BotDefinitionId='${bot_id}'`;
    mode = "any";
  } else {
    where = `BotDefinitionId='${bot_id}' AND Status='Active'`;
    mode = "Active";
  }

  const versions = await conn.query<{ Id: string; VersionNumber: number; Status: string }>(
    `SELECT Id, VersionNumber, Status FROM BotVersion ` +
      `WHERE ${where} ORDER BY VersionNumber DESC LIMIT 1`,
  );
  if (versions.records.length === 0) {
    if (mode === "specific") {
      throw new Error(
        `No BotVersion with VersionNumber=${opts.version} for '${agentApiName}'. ` +
          `Suggested fix: list available versions with ` +
          `\`agentscript_lifecycle action='list_versions' agent_api_name='${agentApiName}'\`.`,
      );
    }
    if (mode === "Active") {
      throw new Error(
        `No Active BotVersion for '${agentApiName}'. ` +
          `Suggested fix: activate a version in Setup → Einstein → Agents → ${agentApiName} ` +
          `OR pass status='any' / a specific version to resolve a non-Active version.`,
      );
    }
    throw new Error(
      `No BotVersion records for '${agentApiName}'. ` +
        `Suggested fix: publish a version first via ` +
        `\`agentscript_lifecycle action='publish' agent_file=<path>\`.`,
    );
  }
  const { Id: bot_version_id, VersionNumber: version_number, Status: status } = versions.records[0];

  const planners = await conn.query<{ Id: string }>(
    `SELECT Id FROM GenAiPlannerDefinition ` +
      `WHERE DeveloperName='${esc}_v${version_number}' LIMIT 1`,
  );

  return {
    bot_id,
    bot_version_id,
    planner_id: planners.records[0]?.Id ?? null,
    version_number,
    status,
  };
}

/**
 * Backward-compatible alias. New code should call `resolveAgentIds`
 * directly. Existing imports continue to work.
 */
export async function resolveActiveIds(
  conn: Connection,
  agentApiName: string,
): Promise<ResolvedAgentIds> {
  return resolveAgentIds(conn, agentApiName, { status: "Active" });
}

// -------------------------------------------------------------------------------------------------
// Placeholder substitution
//
// Three families today:
//   $active_bot_id           — BotDefinition.Id (per-agent; same for every version)
//   $active_bot_version_id   — Active BotVersion.Id
//   $active_planner_id       — Active version's GenAiPlannerDefinition.Id
//   $latest_bot_version_id   — Latest BotVersion.Id (any status)
//   $latest_planner_id       — Latest version's planner
//
// Specific-version ids (e.g. `$version_12_*`) are deliberately NOT supported
// as placeholders — they encourage stringly-typed lookups that go stale
// silently when you republish. Use `action='resolve_active' version=12` to
// look the ids up explicitly and bake them into the spec as plain strings.
// -------------------------------------------------------------------------------------------------

export interface PlaceholderSet {
  active?: ResolvedAgentIds;
  latest?: ResolvedAgentIds;
}

/**
 * Substitute placeholders anywhere in a JSON-shaped value. `$active_*` uses
 * the `active` ids; `$latest_*` uses the `latest` ids. Bot id is shared.
 *
 * Unknown placeholders are left as-is so the eval API surfaces a clear
 * error rather than silently substituting an empty string.
 */
export function substitutePlaceholders<T>(value: T, ids: PlaceholderSet): T {
  if (typeof value === "string") {
    if (value === "$active_bot_id") {
      return (ids.active?.bot_id ?? ids.latest?.bot_id ?? value) as unknown as T;
    }
    if (value === "$active_bot_version_id")
      return (ids.active?.bot_version_id ?? value) as unknown as T;
    if (value === "$active_planner_id") return (ids.active?.planner_id ?? value) as unknown as T;
    if (value === "$latest_bot_version_id")
      return (ids.latest?.bot_version_id ?? value) as unknown as T;
    if (value === "$latest_planner_id") return (ids.latest?.planner_id ?? value) as unknown as T;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => substitutePlaceholders(v, ids)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substitutePlaceholders(v, ids);
    }
    return out as T;
  }
  return value;
}

function isAgentCreateSessionStep(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === "agent.create_session",
  );
}

function hasStringId(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasAnyStringId(step: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => hasStringId(step[key]));
}

const AGENT_ID_KEYS = ["agent_id", "agentId"];
const AGENT_VERSION_ID_KEYS = ["agent_version_id", "agentVersionId"];
const PLANNER_ID_KEYS = [
  "planner_id",
  "plannerId",
  "plannerDefinitionId",
  "planner_definition_id",
  "plannerVersionId",
  "planner_version_id",
];

function hasExplicitAgentId(step: Record<string, unknown>): boolean {
  return hasAnyStringId(step, AGENT_ID_KEYS);
}

function hasExplicitAgentVersionId(step: Record<string, unknown>): boolean {
  return hasAnyStringId(step, AGENT_VERSION_ID_KEYS);
}

function hasExplicitPlannerId(step: Record<string, unknown>): boolean {
  return hasAnyStringId(step, PLANNER_ID_KEYS);
}

function needsAgentIdInjection(step: Record<string, unknown>, overwrite: boolean): boolean {
  if (overwrite) return true;
  return !hasExplicitAgentId(step) || !hasExplicitAgentVersionId(step);
}

/**
 * Return true when a spec has at least one `agent.create_session` step that
 * should receive agent ids from `agent_api_name`. Explicit `agent_id` +
 * `agent_version_id` pairs are left untouched unless `overwrite=true`.
 */
export function shouldInjectResolvedAgentIds(value: unknown, overwrite = false): boolean {
  if (isAgentCreateSessionStep(value)) return needsAgentIdInjection(value, overwrite);
  if (Array.isArray(value)) return value.some((v) => shouldInjectResolvedAgentIds(v, overwrite));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) =>
      shouldInjectResolvedAgentIds(v, overwrite),
    );
  }
  return false;
}

/**
 * Inject resolved BotDefinition/BotVersion/planner ids into create-session
 * steps. This is the safe, JSON-native equivalent of upstream run-eval's
 * `--api-name` convenience, but it never silently overwrites explicit ids.
 */
export function injectResolvedAgentIds<T>(
  value: T,
  ids: ResolvedAgentIds,
  opts: { overwrite?: boolean } = {},
): AgentIdInjectionResult<T> {
  const overwrite = opts.overwrite ?? false;
  const stats: AgentIdInjectionStats = {
    create_session_steps: 0,
    injected_create_session_steps: 0,
    explicit_create_session_steps: 0,
  };

  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map((v) => visit(v));
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = visit(v);
      if (isAgentCreateSessionStep(out)) {
        stats.create_session_steps++;
        if (needsAgentIdInjection(out, overwrite)) {
          if (overwrite || !hasExplicitAgentId(out)) out.agent_id = ids.bot_id;
          if (overwrite || !hasExplicitAgentVersionId(out)) {
            out.agent_version_id = ids.bot_version_id;
          }
          if (ids.planner_id && (overwrite || !hasExplicitPlannerId(out)))
            out.planner_id = ids.planner_id;
          stats.injected_create_session_steps++;
        } else {
          stats.explicit_create_session_steps++;
        }
      }
      return out;
    }
    return node;
  };

  return { spec: visit(value) as T, ...stats };
}

/**
 * Cheap textual scan: which placeholder families does this spec use?
 * Skip the resolver entirely when neither family is referenced.
 */
export interface PlaceholderUsage {
  active: boolean;
  latest: boolean;
}

export function detectPlaceholderUsage(spec: unknown): PlaceholderUsage {
  const s = JSON.stringify(spec);
  // Note: `$active_bot_id` is deliberately NOT a trigger for the active
  // resolver. It's a BotDefinition lookup — same id for every version —
  // so it can be filled in by either resolver (substitutePlaceholders
  // falls back from active.bot_id to latest.bot_id). Triggering active
  // resolution from $active_bot_id alone would silently misreport
  // metadata.bot_version_id when the spec uses $active_bot_id +
  // $latest_bot_version_id together (the ship→eval→activate flow).
  return {
    active: s.includes("$active_bot_version_id") || s.includes("$active_planner_id"),
    latest: s.includes("$latest_bot_version_id") || s.includes("$latest_planner_id"),
  };
}

/**
 * Backward-compatible: returns true if any active OR latest placeholder is
 * referenced. Existing call sites continue to work; new code should prefer
 * `detectPlaceholderUsage` for the per-family signal.
 */
export function specHasActivePlaceholders(spec: unknown): boolean {
  const u = detectPlaceholderUsage(spec);
  return u.active || u.latest;
}
