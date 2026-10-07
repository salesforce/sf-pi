/* SPDX-License-Identifier: Apache-2.0 */
/** Pi-independent SDK seam behind the single sf_data360 custom system tool. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import {
  findPublicData360Action,
  getPublicData360Actions,
  searchPublicData360Actions,
  summarizePublicAction,
} from "./actions/action-registry.ts";
import {
  runData360Action,
  type Data360ProgressSink,
  type Data360ExecutionContext,
} from "./actions/dispatcher.ts";
import type { Data360ActionDefinition, SfData360Input } from "./actions/action-types.ts";
import { listData360TenantTokenSessions } from "./actions/ingest/auth.ts";
import { isQueryV3Action, runDirectData360Request, runQueryV3 } from "./query-v3.ts";

export async function runSfData360Action(
  input: SfData360Input,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal?: AbortSignal,
  progress?: Data360ProgressSink,
  executionContext?: Data360ExecutionContext,
): Promise<Record<string, unknown>> {
  const meta = runLocalMetaAction(input);
  if (meta) return meta;
  if (
    input.action === "api.request" &&
    input.params?.api_family !== undefined &&
    input.params.api_family !== "connect"
  ) {
    return runDirectData360Request(input, ctx.cwd, signal);
  }
  let queryV3Failure: string | undefined;
  if (isQueryV3Action(input.action) && input.params?.transport !== "connect") {
    try {
      return await runQueryV3(input, ctx.cwd, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        input.params?.transport === "query_v3" ||
        ["query.sql.metadata", "query.sql.chunk"].includes(input.action)
      ) {
        return {
          ok: false,
          tool: "sf_data360",
          action: input.action,
          namespace: "query",
          transport: "query-v3",
          error: message,
          summary: `${input.action} failed through Query API V3`,
        };
      }
      queryV3Failure = message;
    }
  }
  if (input.action === "discover.action.example") {
    const requested = requiredString(input.params?.action, "params.action");
    const target = findPublicData360Action(requested);
    if (!target) return unknownAction({ ...input, action: requested });
    const result = await runData360Action(
      {
        tool: target.internalOwner,
        action: "examples.get",
        params: {
          action: target.internalAction,
          variant: input.params?.variant,
        },
        target_org: input.target_org,
        output_mode: input.output_mode,
      },
      env,
      ctx,
      signal,
      progress,
      executionContext,
    );
    return normalizePublicResult(target, result);
  }
  const action = findPublicData360Action(input.action);
  if (!action) return unknownAction(input);
  const missing = action.requiredParams.filter((name) => {
    const value = input.params?.[name];
    return value === undefined || value === null || value === "";
  });
  if (missing.length) {
    return {
      ok: false,
      tool: "sf_data360",
      action: action.action,
      namespace: action.namespace,
      error: "MISSING_REQUIRED_PARAMS",
      missing,
      summary: `${action.action} requires: ${missing.join(", ")}`,
      recover_via: {
        tool: "sf_data360",
        action: "discover.action.describe",
        params: { action: action.action },
      },
    };
  }
  const result = await runData360Action(
    {
      tool: action.internalOwner,
      action: action.internalAction,
      params: input.params,
      target_org: input.target_org,
      dry_run: input.dry_run,
      allow_mutation: input.allow_mutation,
      timeout_ms: input.timeout_ms,
      output_mode: input.output_mode,
    },
    env,
    ctx,
    signal,
    progress,
    executionContext,
  );
  const normalized = normalizePublicResult(action, result);
  if (action.action === "discover.readiness.probe" && input.dry_run !== true) {
    return enrichReadiness(input, normalized, ctx.cwd, signal);
  }
  if (!queryV3Failure) return normalized;
  return {
    ...normalized,
    transport: "connect",
    warnings: [
      ...(Array.isArray(normalized.warnings) ? normalized.warnings : []),
      `Query API V3 unavailable; used the Connect API endpoint instead: ${queryV3Failure}`,
    ],
  };
}

async function enrichReadiness(
  input: SfData360Input,
  result: Record<string, unknown>,
  cwd: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const probes = Array.isArray(result.probes)
    ? (result.probes.filter(
        (probe): probe is Record<string, unknown> =>
          Boolean(probe) && typeof probe === "object" && !Array.isArray(probe),
      ) as Record<string, unknown>[])
    : [];
  const probeByName = new Map(probes.map((probe) => [String(probe.name ?? ""), probe]));
  let queryState: "ready" | "blocked" = "ready";
  let queryReason: string | undefined;
  try {
    const query = await runQueryV3(
      {
        action: "query.sql.run",
        target_org: input.target_org,
        timeout_ms: input.timeout_ms,
        params: { sql: "SELECT 1", transferMode: "ADAPTIVE", queryRowLimit: 1 },
      },
      cwd,
      signal,
    );
    if (query.ok === false) {
      queryState = "blocked";
      queryReason = String(query.error ?? query.summary ?? "Query API V3 probe failed");
    }
  } catch (error) {
    queryState = "blocked";
    queryReason = error instanceof Error ? error.message : String(error);
  }
  const ingestSessions = listData360TenantTokenSessions(input.target_org);
  const capabilities = [
    {
      name: "connect_api",
      label: "Connect API",
      state: result.state === "blocked" ? "blocked" : "ready",
    },
    {
      name: "query_api_v3",
      label: "Query API V3",
      state: queryState,
      ...(queryReason ? { reason: queryReason } : {}),
    },
    {
      name: "ingestion_api",
      label: "Ingestion API",
      state: ingestSessions.length ? "ready" : "auth_required",
      ...(ingestSessions.length
        ? {}
        : { reason: "No in-memory Data Cloud tenant auth session is configured." }),
    },
    capabilityFromProbe(
      probeByName.get("agent_platform_tracing_dlo"),
      "agent_platform_tracing",
      "Agent Platform Tracing",
    ),
    capabilityFromProbe(
      probeByName.get("personalization_org"),
      "personalization",
      "Personalization",
    ),
    capabilityFromProbe(probeByName.get("data_kits"), "data_kits", "DataKits"),
  ];
  const missingSurfaces = capabilities
    .filter((capability) => capability.state !== "ready")
    .map((capability) => capability.label);
  const readiness =
    result.state === "blocked" ? "blocked" : missingSurfaces.length ? "partial" : result.state;
  const warnings = capabilities
    .filter((capability) => capability.state !== "ready")
    .map(
      (capability) =>
        `${capability.label}: ${capability.state}${capability.reason ? ` — ${capability.reason}` : ""}`,
    );
  return {
    ...result,
    state: readiness,
    readiness,
    capabilities,
    missingSurfaces,
    ...(warnings.length ? { warnings } : {}),
    summary: `Data 360 readiness: ${readiness}`,
  };
}

function capabilityFromProbe(
  probe: Record<string, unknown> | undefined,
  name: string,
  label: string,
): { name: string; label: string; state: string; reason?: string } {
  const probeState = String(probe?.state ?? "unknown_error");
  const state = ["enabled_populated", "enabled_empty", "ok"].includes(probeState)
    ? "ready"
    : probeState === "feature_gated"
      ? "feature_gated"
      : probeState === "cli_error"
        ? "platform_error"
        : "unavailable";
  const reason =
    typeof probe?.message === "string" ? probe.message : state === "ready" ? undefined : probeState;
  return { name, label, state, ...(reason ? { reason } : {}) };
}

function runLocalMetaAction(input: SfData360Input): Record<string, unknown> | undefined {
  const params = input.params ?? {};
  if (input.action === "discover.route") {
    const intent = requiredString(
      stringParam(params.intent) ?? stringParam(params.query),
      "params.intent",
    );
    const limit = numberParam(params.limit) ?? 8;
    const explicit = explicitIntentRoute(intent);
    const searched = searchPublicData360Actions(intent, { limit });
    const matches = explicit
      ? [explicit, ...searched.filter((action) => action.action !== explicit.action)].slice(
          0,
          limit,
        )
      : searched;
    return {
      ok: true,
      tool: "sf_data360",
      action: input.action,
      namespace: "discover",
      intent,
      summary: matches.length
        ? `Recommended ${matches[0]?.action} for this Data 360 intent`
        : "No Data 360 action matched this intent",
      recommendedAction: matches[0] ? summarizePublicAction(matches[0]) : undefined,
      alternatives: matches.slice(1).map(summarizePublicAction),
    };
  }
  if (input.action === "discover.action.list") {
    const limit = Math.max(1, Math.min(numberParam(params.limit) ?? 50, 500));
    const namespace = stringParam(params.namespace);
    const actions = getPublicData360Actions()
      .filter((action) => !namespace || action.namespace === namespace)
      .slice(0, limit)
      .map(summarizePublicAction);
    return {
      ok: true,
      tool: "sf_data360",
      action: input.action,
      namespace: "discover",
      summary: `${actions.length} Data 360 action(s)`,
      actions,
    };
  }
  if (input.action === "discover.action.search") {
    const query = stringParam(params.query) ?? stringParam(params.intent) ?? "";
    const matches = searchPublicData360Actions(query, { limit: numberParam(params.limit) ?? 12 });
    return {
      ok: true,
      tool: "sf_data360",
      action: input.action,
      namespace: "discover",
      query,
      summary: `${matches.length} matching Data 360 action(s)`,
      results: matches.map(summarizePublicAction),
    };
  }
  if (input.action === "discover.action.describe") {
    const requested = requiredString(params.action, "params.action");
    const action = findPublicData360Action(requested);
    return action
      ? {
          ok: true,
          tool: "sf_data360",
          action: input.action,
          namespace: "discover",
          requestedAction: requested,
          summary: `${action.action}: ${action.description}`,
          contract: summarizePublicAction(action),
        }
      : unknownAction({ ...input, action: requested });
  }
  return undefined;
}

function normalizePublicResult(
  action: Data360ActionDefinition,
  result: Record<string, unknown>,
): Record<string, unknown> {
  const journey = normalizeJourney(result.journey);
  const transport =
    typeof result.transport === "string" ? result.transport : transportForAction(action);
  const targetAction = publicActionFor(
    String(result.targetTool ?? ""),
    String(result.targetAction ?? ""),
  );
  return {
    ...result,
    tool: "sf_data360",
    action: action.action,
    namespace: action.namespace,
    operationId: action.operationId,
    ...(transport ? { transport } : {}),
    next_actions: normalizeActionReferences(result.next_actions),
    steps: normalizeActionReferences(result.steps),
    availableActions: normalizeActionReferences(result.availableActions),
    recover_via: normalizeActionReference(result.recover_via),
    executionChain: normalizeExecutionChain(result.executionChain),
    ...(journey ? { journey } : {}),
    ...(targetAction ? { targetTool: "sf_data360", targetAction } : {}),
  };
}

function normalizeActionReferences(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map(normalizeActionReference);
}

function normalizeActionReference(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  const mapped = publicActionFor(String(row.tool ?? ""), String(row.action ?? ""));
  return mapped ? { ...row, tool: "sf_data360", action: mapped } : row;
}

function normalizeJourney(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const journey = value as Record<string, unknown>;
  return {
    ...journey,
    availableActions: normalizeActionReferences(journey.availableActions),
  };
}

function normalizeExecutionChain(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const row = entry as Record<string, unknown>;
    const mapped = publicActionFor(String(row.tool ?? ""), String(row.action ?? ""));
    return mapped ? { ...row, tool: "sf_data360", action: mapped } : row;
  });
}

function transportForAction(action: Data360ActionDefinition): string | undefined {
  switch (action.implementation?.kind) {
    case "local":
    case "journey":
    case "tenant_ingest_auth":
      return "local";
    case "tenant_ingest":
      return "ingestion";
    default:
      return action.endpoint ? "connect" : undefined;
  }
}

function publicActionFor(owner: string, internalAction: string): string | undefined {
  const publicAction = findPublicData360Action(internalAction);
  if ((!owner || owner === "sf_data360") && publicAction) return publicAction.action;
  return getPublicData360Actions().find(
    (action) =>
      action.internalOwner === owner &&
      (action.internalAction === internalAction || action.aliases?.includes(internalAction)),
  )?.action;
}

function unknownAction(input: SfData360Input): Record<string, unknown> {
  const suggestions = searchPublicData360Actions(input.action.replace(/[._]/g, " "), { limit: 5 });
  return {
    ok: false,
    tool: "sf_data360",
    action: input.action,
    error: "UNKNOWN_ACTION",
    summary: `Unknown sf_data360 action '${input.action}'.`,
    did_you_mean: suggestions.map(summarizePublicAction),
    recover_via: {
      tool: "sf_data360",
      action: "discover.action.search",
      params: { query: input.action },
    },
  };
}

function explicitIntentRoute(intent: string): Data360ActionDefinition | undefined {
  const normalized = intent.toLowerCase();
  if (/\bsql\b/.test(normalized)) return findPublicData360Action("query.sql.run");
  if (
    /\b(exact|unsupported|raw)\b/.test(normalized) &&
    /\b(rest|endpoint|api)\b/.test(normalized)
  ) {
    return findPublicData360Action("api.request");
  }
  const phaseTerms = ["ingest", "harmon", "segment", "activat"].filter((term) =>
    normalized.includes(term),
  ).length;
  if (/\bend\s+to\s+end\b/.test(normalized) || phaseTerms >= 3) {
    return findPublicData360Action("orchestrate.intent.plan");
  }
  return undefined;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function numberParam(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function requiredString(value: unknown, label: string): string {
  const result = stringParam(value);
  if (!result) throw new Error(`${label} is required.`);
  return result;
}
