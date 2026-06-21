/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Data 360 facade tool.
 *
 * A tiny, deterministic front door inspired by the upstream Data 360 MCP
 * server's search/examples/execute pattern. It keeps the pi tool surface small
 * while giving the LLM stable verbs for registry discovery and repeated
 * observability workflows.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai/base";
import { Type } from "typebox";

import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../../lib/common/sf-environment/shared-runtime.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { connFromAlias } from "../../../lib/common/sf-conn/connection.ts";
import { connRequest } from "../../../lib/common/sf-conn/request.ts";
import { buildApiPath, type QueryParams } from "./path.ts";
import { responseLooksLikeError } from "./api-tool.ts";
import { resolveTargetOrgContext } from "./target-org.ts";
import { facadeResultToLlmText } from "./display/facade-card.ts";
import { renderD360Call, renderD360Result } from "./display/render.ts";
import {
  buildD360Envelope,
  formatD360Output,
  type D360OutputMode,
  writeFullD360Output,
} from "./truncation.ts";
import {
  findCapability,
  findRunbook,
  getD360Capabilities,
  getD360Examples,
  searchRegistry,
  type D360Capability,
  type D360Operation,
} from "./facade/registry.ts";
import { runAgentObservabilityRunbook } from "./facade/agent-observability.ts";
import { isLocalD360Helper, runLocalD360Helper } from "./facade/local-helpers.ts";

export const D360_FACADE_TOOL_NAME = "d360";

const D360FacadeAction = StringEnum(["search", "examples", "execute"] as const, {
  description: "Facade action to run.",
});

export const D360FacadeParams = Type.Object({
  action: D360FacadeAction,
  query: Type.Optional(Type.String({ description: "Search text for action='search'." })),
  capability: Type.Optional(
    Type.String({ description: "D360 capability name for examples/execute." }),
  ),
  variant: Type.Optional(
    Type.String({ description: "Optional payload example variant for action='examples'." }),
  ),
  params: Type.Optional(
    Type.Record(Type.String(), Type.Any(), { description: "Capability parameters." }),
  ),
  target_org: Type.Optional(
    Type.String({ description: "Salesforce org alias or username. Defaults to active sf-pi org." }),
  ),
  dry_run: Type.Optional(
    Type.Boolean({
      description: "Return the resolved capability request without network calls.",
    }),
  ),
  allow_confirmed: Type.Optional(
    Type.Boolean({
      description:
        "Explicitly allow a confirmed/destructive capability to execute after reviewing dry_run output.",
    }),
  ),
  timeout_ms: Type.Optional(Type.Number({ description: "Optional request timeout in ms." })),
  output_mode: Type.Optional(
    StringEnum(["inline", "summary", "file_only"] as const, {
      description: "How to return broad responses.",
    }),
  ),
});

type D360FacadeActionValue = "search" | "examples" | "execute";

export interface D360FacadeInput {
  action: D360FacadeActionValue;
  query?: string;
  capability?: string;
  variant?: string;
  operation?: string;
  runbook?: string;
  params?: Record<string, unknown>;
  target_org?: string;
  dry_run?: boolean;
  allow_confirmed?: boolean;
  timeout_ms?: number;
  output_mode?: D360OutputMode;
}

export function registerD360FacadeTool(pi: ExtensionAPI): void {
  const exec = buildExecFn(pi);

  pi.registerTool({
    name: D360_FACADE_TOOL_NAME,
    label: "Data 360 Facade",
    description: "Facade for Data 360 capability discovery, examples, and deterministic execution.",
    promptSnippet: "Search/examples/execute facade for deterministic Data 360 capabilities",
    promptGuidelines: [
      "Use d360 action='search' to discover Data 360 capabilities without loading large references.",
      "Use d360 action='examples' with a capability before complex or mutating execution.",
      "Use d360 action='execute' for REST, local-helper, and runbook-backed capabilities.",
      "Use d360_api as the raw REST escape hatch when a capability is not in the facade registry.",
    ],
    parameters: D360FacadeParams,
    renderCall: renderD360Call,
    renderResult: renderD360Result,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const input = params as D360FacadeInput;
      const env = await resolveEnvironment(exec, ctx);
      const result = await runFacade(input, env, ctx, signal);
      return buildFacadeResult(result, input.output_mode ?? "summary", {
        ok: result.ok !== false,
        action: input.action,
        targetOrg: result.targetOrg,
        summary: result.summary,
      });
    },
  });
}

export async function runFacade(
  input: D360FacadeInput,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  switch (input.action) {
    case "search":
      return runSearch(input);
    case "examples":
      return runExamples(input);
    case "execute":
      return runExecute(input, env, ctx, signal);
    default:
      return assertNever(input.action);
  }
}

function runSearch(input: D360FacadeInput): Record<string, unknown> {
  const query = input.query?.trim() ?? "";
  const results = searchRegistry(query);
  return {
    ok: true,
    action: "search",
    query,
    summary: `${results.length} Data 360 family match(es)`,
    results,
    hint: "Call d360 action='examples' with a capability name, then d360 action='execute'.",
  };
}

function runExamples(input: D360FacadeInput): Record<string, unknown> {
  const name = input.capability;
  if (!name) {
    return {
      ok: true,
      action: "examples",
      summary: "Available D360 capability examples",
      capabilities: getD360Capabilities().map((capability) => ({
        name: capability.name,
        kind: capability.kind,
        family: capability.family,
        phase: capability.phase,
      })),
      examples: Object.keys(getD360Examples()),
    };
  }

  const capability = findCapability(name);
  const example = getD360Examples()[name] ?? null;
  const variants = variantNames(example);
  const selectedVariant = input.variant ? variantExample(example, input.variant) : undefined;
  return {
    ok: Boolean(capability) && (!input.variant || Boolean(selectedVariant)),
    action: "examples",
    summary: capability ? `Example for ${name}` : `Unknown D360 capability ${name}`,
    capability,
    operation: capability?.operation,
    runbook: capability?.runbook,
    variant: input.variant,
    variants,
    example: selectedVariant ?? example,
    hint: capability
      ? input.variant && !selectedVariant
        ? `Unknown variant '${input.variant}'. Available variants: ${variants.join(", ") || "none"}.`
        : undefined
      : "Use d360 action='search' to discover capability names.",
  };
}

function variantNames(example: unknown): string[] {
  const variants = asRecord(asRecord(example)?.variants);
  return variants ? Object.keys(variants).sort() : [];
}

function variantExample(example: unknown, variant: string): unknown {
  const variants = asRecord(asRecord(example)?.variants);
  return variants?.[variant];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function runExecute(
  input: D360FacadeInput,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const capabilityName = requiredName(input.capability, "capability");
  const capability = findCapability(capabilityName);
  if (!capability)
    throw new Error(`Unknown Data 360 capability '${capabilityName}'. Use d360 search first.`);

  if (capability.kind === "runbook") {
    return runRunbookCapability(capability, input, env, signal);
  }

  const operation = capability.operation;
  if (!operation) {
    throw new Error(
      `Capability '${capabilityName}' is not backed by a REST or local helper implementation.`,
    );
  }

  const { targetOrg, apiVersion, targetOrgInfo } = await resolveTargetOrgContext(
    input.target_org,
    env,
  );
  if (!targetOrg) throw new Error("No Salesforce target org is configured.");
  const params = input.params ?? {};

  if (isLocalD360Helper(operation.name)) {
    if (input.dry_run) {
      return {
        ok: true,
        action: "execute",
        dryRun: true,
        targetOrg,
        apiVersion,
        operation,
        request: { method: "LOCAL", path: operation.path, params },
        summary: `Resolved local helper ${operation.name}`,
      };
    }
    return {
      ...runLocalD360Helper(operation.name, params),
      targetOrg,
      apiVersion,
      capability: capability.name,
      capabilityKind: capability.kind,
      operation: operation.name,
    };
  }

  const { path, query, body } = resolveOperationRequest(operation, params);
  const apiPath = buildApiPath(path, apiVersion, query);
  if (input.dry_run) {
    return {
      ok: true,
      action: "execute",
      dryRun: true,
      targetOrg,
      apiVersion,
      operation,
      safety: operation.safety,
      request: { method: operation.method, path: apiPath, body: body ?? null },
      summary: `Resolved ${operation.name}`,
    };
  }

  if (shouldBlockConfirmedOperation(input, operation)) {
    return {
      ok: false,
      action: "execute",
      targetOrg,
      apiVersion,
      operation: operation.name,
      safety: operation.safety,
      summary: `${operation.name} requires dry_run or allow_confirmed`,
      error:
        "Confirmed/destructive operation blocked before network call. Run with dry_run=true first, then pass allow_confirmed=true only if you intentionally want to execute it.",
    };
  }

  const destructiveBlock = evaluateDestructiveExecutionGuard({
    operation,
    targetOrg,
    env,
    targetOrgInfo,
    hasUI: ctx.hasUI,
  });
  if (destructiveBlock.blocked) {
    return {
      ok: false,
      action: "execute",
      targetOrg,
      apiVersion,
      operation: operation.name,
      safety: operation.safety,
      summary: destructiveBlock.summary,
      error: destructiveBlock.error,
    };
  }

  const conn = await connFromAlias(targetOrg);
  const preflight = resolveDestructivePreflightRequest(operation.name, params);
  if (preflight) {
    if (signal?.aborted) throw new Error("d360 execute cancelled before destructive preflight.");
    const preflightResp = await connRequest<unknown>(conn, {
      method: "GET",
      url: buildApiPath(preflight.path, apiVersion, preflight.query),
      timeoutMs: input.timeout_ms ?? 120_000,
    });
    const preflightText = stringify(preflightResp.body);
    if (
      preflightResp.status < 200 ||
      preflightResp.status >= 300 ||
      responseLooksLikeError(preflightText)
    ) {
      return {
        ok: false,
        action: "execute",
        targetOrg,
        apiVersion,
        operation: operation.name,
        safety: operation.safety,
        status: preflightResp.status,
        response: preflightResp.body,
        preflight: {
          method: "GET",
          path: buildApiPath(preflight.path, apiVersion, preflight.query),
        },
        summary: `${operation.name} preflight failed HTTP ${preflightResp.status}`,
        error:
          "Destructive operation blocked because its read preflight failed. Inspect the resource identifier and target org before retrying.",
      };
    }
  }

  await enforceOperationSafety(ctx, operation);
  if (signal?.aborted) throw new Error("d360 execute cancelled before request.");
  const resp = await connRequest<unknown>(conn, {
    method: operation.method,
    url: apiPath,
    body,
    timeoutMs: input.timeout_ms ?? 120_000,
  });
  const responseText = stringify(resp.body);
  const ok = resp.status >= 200 && resp.status < 300 && !responseLooksLikeError(responseText);
  return {
    ok,
    action: "execute",
    targetOrg,
    apiVersion,
    capability: capability.name,
    capabilityKind: capability.kind,
    operation: operation.name,
    safety: operation.safety,
    status: resp.status,
    request: { method: operation.method, path: apiPath, body: body ?? null },
    response: resp.body,
    summary: `${operation.name} HTTP ${resp.status}`,
  };
}

async function runRunbookCapability(
  capability: D360Capability,
  input: D360FacadeInput,
  env: SfEnvironment,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const runbookName = capability.runbook?.name;
  if (!runbookName) throw new Error(`Capability '${capability.name}' is not backed by a runbook.`);
  const result = await runRunbook({ ...input, runbook: runbookName }, env, signal);
  return {
    ...result,
    action: "execute",
    capability: capability.name,
    capabilityKind: capability.kind,
  };
}

async function runRunbook(
  input: D360FacadeInput,
  env: SfEnvironment,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const runbookName = requiredName(input.runbook, "runbook");
  const runbook = findRunbook(runbookName);
  if (!runbook)
    throw new Error(`Unknown Data 360 runbook '${runbookName}'. Use d360 search first.`);
  const { targetOrg, apiVersion } = await resolveTargetOrgContext(input.target_org, env);
  if (!targetOrg) throw new Error("No Salesforce target org is configured.");
  const conn = await connFromAlias(targetOrg);
  const params = input.params ?? {};
  const dataspaceName = typeof params.dataspaceName === "string" ? params.dataspaceName : "default";

  try {
    const result = await runAgentObservabilityRunbook(runbookName, params, async (sql) => {
      if (signal?.aborted) throw new Error("d360 runbook cancelled before query.");
      const resp = await connRequest<unknown>(conn, {
        method: "POST",
        url: buildApiPath("/ssot/query-sql", apiVersion, { dataspaceName }),
        body: { sql },
        timeoutMs: input.timeout_ms ?? 120_000,
      });
      if (resp.status < 200 || resp.status >= 300 || responseLooksLikeError(stringify(resp.body))) {
        throw new Error(`Query failed (${resp.status}): ${stringify(resp.body).slice(0, 1000)}`);
      }
      return resp.body as never;
    });

    return {
      ok: true,
      action: "runbook",
      targetOrg,
      apiVersion,
      dataspaceName,
      runbook: runbookName,
      result,
      summary: result.markdown.split("\n")[0],
    };
  } catch (err) {
    return {
      ok: false,
      action: "runbook",
      targetOrg,
      apiVersion,
      dataspaceName,
      runbook: runbookName,
      error: err instanceof Error ? err.message : String(err),
      summary: `${runbookName} failed`,
    };
  }
}

function resolveOperationRequest(
  operation: D360Operation,
  params: Record<string, unknown>,
): { path: string; query?: QueryParams; body?: unknown } {
  for (const required of operation.requiredParams ?? []) {
    if (params[required] === undefined || params[required] === null || params[required] === "") {
      throw new Error(`Missing required parameter '${required}' for ${operation.name}.`);
    }
  }

  let path = operation.path;
  for (const match of path.matchAll(/\{([^}]+)\}/g)) {
    const key = match[1];
    const value = params[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Missing path parameter '${key}' for ${operation.name}.`);
    }
    path = path.replace(`{${key}}`, encodeURIComponent(value.trim()));
  }

  const pathParamNames = new Set(
    [...operation.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
  );
  const query: QueryParams = {};
  const queryParamNames = [
    ...(operation.requiredParams ?? []),
    ...(operation.optionalParams ?? []),
  ].filter((key) => !pathParamNames.has(key) && key !== "sql" && key !== "body");
  for (const key of queryParamNames) {
    const value = params[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      query[key] = value as QueryParams[string];
    }
  }

  const body = operation.method === "GET" ? undefined : buildOperationBody(operation, params);
  return { path, query: Object.keys(query).length ? query : undefined, body };
}

function buildOperationBody(operation: D360Operation, params: Record<string, unknown>): unknown {
  if (operation.method === "DELETE") return undefined;
  if (operation.name === "d360_query_sql") {
    return { sql: params.sql };
  }
  return params.body ?? {};
}

export function resolveDestructivePreflightRequest(
  operationName: string,
  params: Record<string, unknown>,
): { path: string; query?: QueryParams } | undefined {
  switch (operationName) {
    case "d360_query_sql_cancel":
      return { path: `/ssot/query-sql/${encodePathParam(params.queryId, "queryId")}` };
    case "d360_dmo_delete":
      return { path: `/ssot/data-model-objects/${encodePathParam(params.dmoName, "dmoName")}` };
    case "d360_dlo_delete":
      return { path: `/ssot/data-lake-objects/${encodePathParam(params.dloName, "dloName")}` };
    case "d360_dmo_mapping_delete":
      return {
        path: `/ssot/data-model-object-mappings/${encodePathParam(params.mappingName, "mappingName")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_dmo_field_mapping_delete":
      return {
        path: `/ssot/data-model-object-mappings/${encodePathParam(params.mappingName, "mappingName")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_datastream_delete":
      return {
        path: `/ssot/data-streams/${encodePathParam(params.dataStreamId, "dataStreamId")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_connection_delete":
      return {
        path: `/ssot/connections/${encodePathParam(params.connectionId, "connectionId")}`,
        query: optionalQuery(params, ["connectorType", "dataspace"]),
      };
    case "d360_segment_delete":
      return { path: `/ssot/segments/${encodePathParam(params.segmentApiName, "segmentApiName")}` };
    case "d360_ci_delete":
      return {
        path: `/ssot/calculated-insights/${encodePathParam(params.ciName, "ciName")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_ir_delete":
      return {
        path: `/ssot/identity-resolutions/${encodePathParam(params.identityResolutionId, "identityResolutionId")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_activation_delete":
      return { path: `/ssot/activations/${encodePathParam(params.activationId, "activationId")}` };
    case "d360_activation_target_delete":
      return {
        path: `/ssot/activation-targets/${encodePathParam(params.activationTargetId, "activationTargetId")}`,
      };
    case "d360_dataspace_delete":
      return {
        path: `/ssot/data-spaces/${encodePathParam(params.dataSpaceName, "dataSpaceName")}`,
      };
    case "d360_dataspace_member_remove":
      return {
        path: `/ssot/data-spaces/${encodePathParam(params.dataSpaceName, "dataSpaceName")}/members`,
      };
    case "d360_transform_delete":
      return {
        path: `/ssot/data-transforms/${encodePathParam(params.transformId, "transformId")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_datakit_undeploy":
      return {
        path: `/ssot/data-kits/${encodePathParam(params.dataKitId, "dataKitId")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_dataaction_target_delete":
      return {
        path: `/ssot/data-action-targets/${encodePathParam(params.dataActionTargetId, "dataActionTargetId")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_sdm_delete":
      return {
        path: `/ssot/semantic/models/${encodePathParam(params.modelApiNameOrId, "modelApiNameOrId")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_sdm_data_object_delete":
      return {
        path: `/ssot/semantic/models/${encodePathParam(params.modelApiNameOrId, "modelApiNameOrId")}/data-objects/${encodePathParam(params.dataObjectNameOrId, "dataObjectNameOrId")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_sdm_calc_dim_delete":
      return {
        path: `/ssot/semantic/models/${encodePathParam(params.modelApiNameOrId, "modelApiNameOrId")}/calculated-dimensions/${encodePathParam(params.calculatedDimensionId, "calculatedDimensionId")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_sdm_calc_measure_delete":
      return {
        path: `/ssot/semantic/models/${encodePathParam(params.modelApiNameOrId, "modelApiNameOrId")}/calculated-measurements/${encodePathParam(params.calculatedMeasureId, "calculatedMeasureId")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_sdm_metric_delete":
      return {
        path: `/ssot/semantic/models/${encodePathParam(params.modelApiNameOrId, "modelApiNameOrId")}/metrics/${encodePathParam(params.metricNameOrId, "metricNameOrId")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_sdm_relationship_delete":
      return {
        path: `/ssot/semantic/models/${encodePathParam(params.modelApiNameOrId, "modelApiNameOrId")}/relationships/${encodePathParam(params.relationshipId, "relationshipId")}`,
        query: optionalQuery(params, ["dataspace"]),
      };
    case "d360_search_index_delete":
      return {
        path: `/ssot/search-index/${encodePathParam(params.searchIndexApiNameOrId, "searchIndexApiNameOrId")}`,
      };
    case "d360_retriever_delete":
      return {
        path: `/ssot/machine-learning/retrievers/${encodePathParam(params.retrieverIdOrName, "retrieverIdOrName")}`,
      };
    case "d360_retriever_config_delete":
      return {
        path: `/ssot/machine-learning/retrievers/${encodePathParam(params.retrieverIdOrName, "retrieverIdOrName")}/configurations/${encodePathParam(params.configurationIdOrName, "configurationIdOrName")}`,
      };
    default:
      return undefined;
  }
}

function encodePathParam(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return encodeURIComponent(value.trim());
}

function optionalQuery(params: Record<string, unknown>, keys: string[]): QueryParams | undefined {
  const query: QueryParams = {};
  for (const key of keys) {
    const value = params[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      query[key] = value as QueryParams[string];
    }
  }
  return Object.keys(query).length ? query : undefined;
}

export function shouldBlockConfirmedOperation(
  input: Pick<D360FacadeInput, "dry_run" | "allow_confirmed">,
  operation: Pick<D360Operation, "safety">,
): boolean {
  if (operation.safety === "read" || operation.safety === "safe_post") return false;
  if (input.dry_run) return false;
  return input.allow_confirmed !== true;
}

const DESTRUCTIVE_ALLOWED_TARGET_ORG = "AgentforceSTDM";

interface DestructiveExecutionGuardInput {
  operation: Pick<D360Operation, "name" | "safety">;
  targetOrg: string;
  env: SfEnvironment;
  targetOrgInfo?: SfEnvironment["org"];
  hasUI: boolean;
}

export function evaluateDestructiveExecutionGuard(input: DestructiveExecutionGuardInput): {
  blocked: boolean;
  summary?: string;
  error?: string;
} {
  if (input.operation.safety !== "destructive") return { blocked: false };

  if (!isAgentforceStdmTarget(input.targetOrg, input.env, input.targetOrgInfo)) {
    return {
      blocked: true,
      summary: `${input.operation.name} requires target_org=${DESTRUCTIVE_ALLOWED_TARGET_ORG}`,
      error:
        "Destructive Data 360 operations are only allowed against the AgentforceSTDM org. Re-run the dry-run and execution with target_org='AgentforceSTDM'.",
    };
  }

  if (!input.hasUI) {
    return {
      blocked: true,
      summary: `${input.operation.name} requires interactive confirmation`,
      error:
        "Destructive Data 360 operations require Pi UI human-in-the-loop confirmation and are blocked in headless execution.",
    };
  }

  return { blocked: false };
}

export function isAgentforceStdmTarget(
  targetOrg: string,
  env: SfEnvironment,
  targetOrgInfo?: SfEnvironment["org"],
): boolean {
  return (
    targetOrg === DESTRUCTIVE_ALLOWED_TARGET_ORG ||
    targetOrgInfo?.alias === DESTRUCTIVE_ALLOWED_TARGET_ORG ||
    (targetMatchesEnvironmentForGuard(targetOrg, env) &&
      (env.config.targetOrg === DESTRUCTIVE_ALLOWED_TARGET_ORG ||
        env.org.alias === DESTRUCTIVE_ALLOWED_TARGET_ORG))
  );
}

function targetMatchesEnvironmentForGuard(targetOrg: string, env: SfEnvironment): boolean {
  return (
    targetOrg === env.config.targetOrg ||
    targetOrg === env.org.alias ||
    targetOrg === env.org.username
  );
}

async function enforceOperationSafety(
  ctx: ExtensionContext,
  operation: D360Operation,
): Promise<void> {
  if (operation.safety === "read" || operation.safety === "safe_post") return;
  // The explicit allow_confirmed gate above protects headless / tool-only
  // execution. If a UI is present, ask for an additional human confirmation.
  if (!ctx.hasUI) return;
  const choice = await ctx.ui.select(
    `Confirm Data 360 ${operation.safety} operation\n\n${operation.name}`,
    ["Allow once", "Block"],
    { timeout: 30_000, signal: ctx.signal },
  );
  if (choice !== "Allow once") throw new Error("Blocked by user via d360 facade confirmation.");
}

async function resolveEnvironment(
  exec: ReturnType<typeof buildExecFn>,
  ctx: ExtensionContext,
): Promise<SfEnvironment> {
  return getCachedSfEnvironment(ctx.cwd) ?? (await getSharedSfEnvironment(exec, ctx.cwd));
}

async function buildFacadeResult(
  result: Record<string, unknown>,
  outputMode: D360OutputMode,
  details: Record<string, unknown>,
) {
  const text = JSON.stringify(result, null, 2);
  const ok = details.ok !== false;

  if (outputMode === "inline" || outputMode === "file_only") {
    const formatted = await formatD360Output(text, outputMode);
    return {
      content: [{ type: "text" as const, text: formatted.text }],
      details: {
        ...details,
        outputMode: formatted.outputMode ?? outputMode,
        ...(formatted.truncation ? { truncation: formatted.truncation } : {}),
        ...(formatted.fullOutputPath ? { fullOutputPath: formatted.fullOutputPath } : {}),
        sfPi: buildD360Envelope(D360_FACADE_TOOL_NAME, ok, text, details, formatted),
      },
    };
  }

  const fullOutputPath = await writeFullD360Output(text);
  const { card, text: compactText } = facadeResultToLlmText(result, { fullOutputPath });
  const formatted = { text: compactText, fullOutputPath, outputMode };
  const sfPi = buildD360Envelope(D360_FACADE_TOOL_NAME, ok, compactText, details, formatted);
  sfPi.data = { card };
  sfPi.renderHints = { profile: "balanced", collapsedLines: 48, expandedMaxLines: 120 };

  return {
    content: [{ type: "text" as const, text: compactText }],
    details: {
      ...details,
      outputMode,
      fullOutputPath,
      card,
      sfPi,
    },
  };
}

function requiredName(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`action requires ${label}.`);
  return value.trim();
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled d360 facade action: ${String(value)}`);
}
