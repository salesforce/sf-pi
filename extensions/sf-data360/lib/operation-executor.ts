/* SPDX-License-Identifier: Apache-2.0 */
/** Thin operation executor for generated Data 360 endpoint and runbook actions. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import {
  connectSalesforce,
  type SalesforceQueryParams as QueryParams,
} from "../../../lib/common/sf-conn/index.ts";
import { responseLooksLikeError } from "./api-client.ts";
import {
  findCapability,
  findRunbook,
  getD360Capabilities,
  getD360Examples,
  type D360Capability,
  type D360Operation,
} from "./operation-registry.ts";
import { runAgentObservabilityRunbook } from "./agent-observability.ts";
import {
  evaluateDestructiveExecutionGuard,
  shouldBlockMutation,
  type OwnedData360SweepCleanup,
} from "./destructive-guard.ts";
import { isLocalD360Helper, runLocalD360Helper } from "./local-helpers.ts";

export interface Data360OperationInput {
  action: "examples" | "execute";
  capability?: string;
  runbook?: string;
  variant?: string;
  params?: Record<string, unknown>;
  target_org?: string;
  dry_run?: boolean;
  allow_mutation?: boolean;
  timeout_ms?: number;
  output_mode?: "inline" | "summary" | "file_only";
  owned_sweep_cleanup?: OwnedData360SweepCleanup;
}

export async function runData360Operation(
  input: Data360OperationInput,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  return input.action === "examples" ? runExamples(input) : runExecute(input, env, ctx, signal);
}

function runExamples(input: Data360OperationInput): Record<string, unknown> {
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

const DEFAULT_CONNECTION_TIMEOUT_MS = 15_000;
const MAX_CONNECTION_TIMEOUT_MS = 30_000;

function connectionTimeout(input: Pick<Data360OperationInput, "timeout_ms">): number {
  const requested =
    typeof input.timeout_ms === "number" ? input.timeout_ms : DEFAULT_CONNECTION_TIMEOUT_MS;
  return Math.max(1, Math.min(requested, MAX_CONNECTION_TIMEOUT_MS));
}

async function runExecute(
  input: Data360OperationInput,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const capabilityName = requiredName(input.capability, "capability");
  const capability = findCapability(capabilityName);
  if (!capability)
    throw new Error(
      `Unknown Data 360 operation '${capabilityName}'. Use discover.action.search first.`,
    );

  if (capability.kind === "runbook") {
    return runRunbookCapability(capability, input, ctx, signal);
  }

  const operation = capability.operation;
  if (!operation) {
    throw new Error(
      `Capability '${capabilityName}' is not backed by a REST or local helper implementation.`,
    );
  }

  const session = await connectSalesforce({
    cwd: ctx.cwd || process.cwd(),
    targetOrg: input.target_org,
    signal,
    timeoutMs: connectionTimeout(input),
  });
  const targetOrg = session.target.targetOrg;
  const apiVersion = session.target.apiVersion;
  const instanceUrl = session.target.instanceUrl;
  const params = input.params ?? {};

  if (isLocalD360Helper(operation.name)) {
    if (input.dry_run) {
      return {
        ok: true,
        action: "execute",
        dryRun: true,
        targetOrg,
        instanceUrl,
        apiVersion,
        operation,
        request: { method: "LOCAL", path: operation.path, url: operation.path, params },
        summary: `Resolved local helper ${operation.name}`,
      };
    }
    return {
      ...runLocalD360Helper(operation.name, params),
      targetOrg,
      instanceUrl,
      apiVersion,
      capability: capability.name,
      capabilityKind: capability.kind,
      operation: operation.name,
    };
  }

  const { path, query, headers, body } = resolveOperationRequest(operation, params);
  const apiPath = session.path(path, query);
  if (input.dry_run) {
    return {
      ok: true,
      action: "execute",
      dryRun: true,
      targetOrg,
      instanceUrl,
      apiVersion,
      operation,
      safety: operation.safety,
      request: {
        method: operation.method,
        path: apiPath,
        url: `${instanceUrl}${apiPath}`,
        ...(headers ? { headers: sanitizeHeaders(headers) } : {}),
        body: body ?? null,
      },
      summary: `Resolved ${operation.name}`,
    };
  }

  if (shouldBlockMutation(input, operation)) {
    return {
      ok: false,
      action: "execute",
      targetOrg,
      instanceUrl,
      apiVersion,
      operation: operation.name,
      safety: operation.safety,
      summary: `${operation.name} requires dry_run or allow_mutation`,
      error:
        "Mutating operation blocked before the network call. Run with dry_run=true first, then pass allow_mutation=true only for intentional execution.",
    };
  }

  const destructiveBlock = evaluateDestructiveExecutionGuard({
    operation,
    targetOrg,
    env,
    targetOrgInfo: {
      alias: session.target.alias,
      username: session.target.username,
      orgType: session.target.orgType,
    },
    targetResolved: true,
    hasUI: ctx.hasUI,
    params,
    ownedSweepCleanup: input.owned_sweep_cleanup,
  });
  if (destructiveBlock.blocked) {
    return {
      ok: false,
      action: "execute",
      targetOrg,
      instanceUrl,
      apiVersion,
      operation: operation.name,
      safety: operation.safety,
      summary: destructiveBlock.summary,
      error: destructiveBlock.error,
    };
  }

  const preflight = resolveDestructivePreflightRequest(operation.name, params);
  if (preflight) {
    if (signal?.aborted) throw new Error("d360 execute cancelled before destructive preflight.");
    const preflightResp = await session.request<unknown>({
      method: "GET",
      path: preflight.path,
      query: preflight.query,
      timeoutMs: input.timeout_ms ?? 120_000,
      signal,
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
        instanceUrl,
        apiVersion,
        operation: operation.name,
        safety: operation.safety,
        status: preflightResp.status,
        response: preflightResp.body,
        preflight: {
          method: "GET",
          path: session.path(preflight.path, preflight.query),
        },
        summary: `${operation.name} preflight failed HTTP ${preflightResp.status}`,
        error:
          "Destructive operation blocked because its read preflight failed. Inspect the resource identifier and target org before retrying.",
      };
    }
  }

  if (signal?.aborted) throw new Error("d360 execute cancelled before request.");
  const resp = await session.request<unknown>({
    method: operation.method,
    path,
    query,
    headers,
    body,
    timeoutMs: input.timeout_ms ?? 120_000,
    signal,
  });
  const responseText = stringify(resp.body);
  const ok = resp.status >= 200 && resp.status < 300 && !responseLooksLikeError(responseText);
  return {
    ok,
    action: "execute",
    targetOrg,
    instanceUrl,
    apiVersion,
    capability: capability.name,
    capabilityKind: capability.kind,
    operation: operation.name,
    safety: operation.safety,
    status: resp.status,
    request: {
      method: operation.method,
      path: apiPath,
      url: `${instanceUrl}${apiPath}`,
      ...(headers ? { headers: sanitizeHeaders(headers) } : {}),
      body: body ?? null,
    },
    response: resp.body,
    summary: `${operation.name} HTTP ${resp.status}`,
  };
}

async function runRunbookCapability(
  capability: D360Capability,
  input: Data360OperationInput,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const runbookName = capability.runbook?.name;
  if (!runbookName) throw new Error(`Capability '${capability.name}' is not backed by a runbook.`);
  const result = await runRunbook(
    { ...input, runbook: runbookName },
    ctx.cwd || process.cwd(),
    signal,
  );
  return {
    ...result,
    action: "execute",
    capability: capability.name,
    capabilityKind: capability.kind,
  };
}

async function runRunbook(
  input: Data360OperationInput,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const runbookName = requiredName(input.runbook, "runbook");
  const runbook = findRunbook(runbookName);
  if (!runbook)
    throw new Error(`Unknown Data 360 runbook '${runbookName}'. Use discover.action.search first.`);
  const session = await connectSalesforce({
    cwd,
    targetOrg: input.target_org,
    signal,
    timeoutMs: connectionTimeout(input),
  });
  const targetOrg = session.target.targetOrg;
  const apiVersion = session.target.apiVersion;
  const instanceUrl = session.target.instanceUrl;
  const params = input.params ?? {};
  const dataspaceName = typeof params.dataspaceName === "string" ? params.dataspaceName : "default";
  const sourceCalls: Record<string, unknown>[] = [];

  try {
    const result = await runAgentObservabilityRunbook(runbookName, params, async (sql) => {
      if (signal?.aborted) throw new Error("d360 runbook cancelled before query.");
      const apiPath = session.path("/ssot/query-sql", { dataspaceName });
      const resp = await session.request<unknown>({
        method: "POST",
        path: "/ssot/query-sql",
        query: { dataspaceName },
        body: { sql },
        timeoutMs: input.timeout_ms ?? 45_000,
        signal,
      });
      sourceCalls.push({
        ok: resp.status >= 200 && resp.status < 300,
        action: "query.sql.run",
        namespace: "query",
        status: resp.status,
        request: {
          method: "POST",
          path: apiPath,
          url: `${instanceUrl}${apiPath}`,
        },
        summary: `Platform Tracing source query HTTP ${resp.status}`,
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
      instanceUrl,
      apiVersion,
      dataspaceName,
      runbook: runbookName,
      result,
      sourceCalls,
      summary: result.markdown.split("\n")[0],
    };
  } catch (err) {
    return {
      ok: false,
      action: "runbook",
      targetOrg,
      instanceUrl,
      apiVersion,
      dataspaceName,
      runbook: runbookName,
      ...(sourceCalls.length ? { sourceCalls } : {}),
      error: err instanceof Error ? err.message : String(err),
      summary: `${runbookName} failed`,
    };
  }
}

function resolveOperationRequest(
  operation: D360Operation,
  params: Record<string, unknown>,
): { path: string; query?: QueryParams; headers?: Record<string, string>; body?: unknown } {
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
  const headerParamNames = new Set(operation.headerParams ?? []);
  const queryParamNames = [
    ...(operation.requiredParams ?? []),
    ...(operation.optionalParams ?? []),
  ].filter(
    (key) =>
      !pathParamNames.has(key) && !headerParamNames.has(key) && key !== "sql" && key !== "body",
  );
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
  if (operation.name === "d360_query_sql_rows" && query.offset === undefined) {
    query.offset = 0;
  }
  const headers = Object.fromEntries(
    [...headerParamNames]
      .map((name) => [name, params[name]])
      .filter((entry): entry is [string, string | number | boolean] =>
        ["string", "number", "boolean"].includes(typeof entry[1]),
      )
      .map(([name, value]) => [name, String(value)]),
  );

  const body = operation.method === "GET" ? undefined : buildOperationBody(operation, params);
  return {
    path,
    query: Object.keys(query).length ? query : undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    body,
  };
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      /authorization|token|secret|api[-_]?key/i.test(name) ? "••••••" : value,
    ]),
  );
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
    case "d360_prediction_job_def_delete":
      return {
        path: `/ssot/machine-learning/prediction-job-definitions/${encodePathParam(params.idOrName, "idOrName")}`,
      };
    case "d360_ml_model_artifact_delete":
      return {
        path: `/ssot/machine-learning/model-artifacts/${encodePathParam(params.idOrName, "idOrName")}`,
      };
    case "d360_ml_configured_model_delete":
      return {
        path: `/ssot/machine-learning/configured-models/${encodePathParam(params.idOrName, "idOrName")}`,
      };
    case "d360_ml_model_setup_delete":
      return {
        path: `/ssot/machine-learning/model-setups/${encodePathParam(params.idOrName, "idOrName")}`,
      };
    case "d360_p13n_experience_config_delete":
      return {
        path: `/personalization/external-apps/${encodePathParam(params.idOrAppSourceIdOrName, "idOrAppSourceIdOrName")}/personalization-experience-configs/${encodePathParam(params.nameParam, "nameParam")}`,
      };
    case "d360_p13n_transformer_delete":
      return {
        path: "/personalization/external-apps/transformer",
        query: { idOrName: encodePathParam(params.idOrName, "idOrName") },
      };
    case "d360_p13n_schema_delete":
      return {
        path: `/personalization/personalization-schemas/${encodePathParam(params.idOrName, "idOrName")}`,
      };
    case "d360_p13n_point_delete":
      return {
        path: `/personalization/personalization-points/${encodePathParam(params.idOrName, "idOrName")}`,
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
