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
      if (input.params?.transport === "query_v3" || input.action === "query.sql.metadata") {
        throw error;
      }
      queryV3Failure = error instanceof Error ? error.message : String(error);
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

function runLocalMetaAction(input: SfData360Input): Record<string, unknown> | undefined {
  const params = input.params ?? {};
  if (input.action === "discover.route") {
    const intent = requiredString(
      stringParam(params.intent) ?? stringParam(params.query),
      "params.intent",
    );
    const matches = searchPublicData360Actions(intent, { limit: numberParam(params.limit) ?? 8 });
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
  return {
    ...result,
    tool: "sf_data360",
    action: action.action,
    namespace: action.namespace,
    operationId: action.operationId,
    next_actions: normalizeNextActions(result.next_actions),
    executionChain: normalizeExecutionChain(result.executionChain),
  };
}

function normalizeNextActions(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const row = entry as Record<string, unknown>;
    const mapped = publicActionFor(String(row.tool ?? ""), String(row.action ?? ""));
    return mapped ? { action: mapped, params: row.params } : row;
  });
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

function publicActionFor(owner: string, internalAction: string): string | undefined {
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
    recover_via: { action: "discover.action.search", params: { query: input.action } },
  };
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
