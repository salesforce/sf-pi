/* SPDX-License-Identifier: Apache-2.0 */
/** Shared dispatcher for the Data 360 v2 family tools. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { SfEnvironment } from "../../../../lib/common/sf-environment/types.ts";
import { connFromAlias } from "../../../../lib/common/sf-conn/connection.ts";
import { connRequest } from "../../../../lib/common/sf-conn/request.ts";
import { buildApiPath, type QueryParams } from "../path.ts";
import { planCleanup } from "./cleanup.ts";
import { inferCsvSchema } from "./csv-schema.ts";
import {
  clearTenantIngestTokenSessions,
  exchangePkceForTenantIngestAuth,
  getTenantIngestTokenSession,
  inspectTenantIngestAuth,
  listTenantIngestTokenSessions,
  planTenantIngestAuth,
  planTenantIngestExchange,
  startTenantIngestPkce,
  tenantIngestTokenExchange,
} from "./ingest/auth.ts";
import { planInteractivePkceAuth, runInteractivePkceAuth } from "./ingest/interactive-auth.ts";
import { findData360Journey, getData360Journeys, planData360Intent } from "./journey-catalog.ts";
import { loadManifest, planManifest } from "./manifest.ts";
import { executeTenantIngestRequest, planTenantIngestRequest } from "./ingest/tenant-client.ts";
import type { TenantIngestActionName } from "./ingest/types.ts";
import { responseLooksLikeError, resolveRequestForExecution } from "../api-tool.ts";
import { summarizeMetadataOutput, type D360MetadataInput } from "../metadata-tool.ts";
import { runFacade } from "../facade-tool.ts";
import {
  classifyConnectionProbeResult,
  PROBES,
  summarizeReadiness,
  type ProbeResult,
} from "../probe-tool.ts";
import { resolveTargetOrgContext } from "../target-org.ts";
import {
  findData360Action,
  getData360ActionsForTool,
  searchData360Actions,
  summarizeAction,
} from "./action-registry.ts";
import type {
  Data360V2ActionDefinition,
  Data360V2Input,
  Data360V2Step,
  Data360V2ToolName,
} from "./action-types.ts";

export async function runData360V2Action(
  input: Data360V2Input,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  if (input.tool === "data360_discover") {
    const discovery = await runDiscoveryAction(input, env, ctx, signal);
    if (discovery) return discovery;
  }
  if (input.tool === "data360_api") {
    const api = await runApiAction(input, env, signal);
    if (api) return api;
  }

  switch (input.action) {
    case "help":
      return runHelp(input.tool);
    case "actions.list":
      return runActionsList(input.tool);
    case "actions.search":
      return runActionsSearch(input);
    case "action.describe":
      return runActionDescribe(input);
    case "examples.get":
      return runExamplesGet(input, env, ctx, signal);
    default:
      return runMappedAction(input, env, ctx, signal);
  }
}

async function runDiscoveryAction(
  input: Data360V2Input,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown> | undefined> {
  switch (input.action) {
    case "readiness.probe":
      return runReadinessProbe(input, env, signal);
    case "catalog.search":
      return runCatalogSearch(input);
    case "catalog.action":
      return runCatalogAction(input);
    case "examples.get":
      return runDiscoverExamplesGet(input, env, ctx, signal);
    default:
      return undefined;
  }
}

async function runApiAction(
  input: Data360V2Input,
  env: SfEnvironment,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (input.action !== "rest.request") return undefined;
  const params = input.params ?? {};
  const method = requiredStringParam(params, "method");
  const path = requiredStringParam(params, "path");
  const query = asQueryParams(params.query);
  const body = params.body;
  const resolved = await resolveRequestForExecution(
    {
      method,
      path,
      query,
      body,
      target_org: input.target_org,
      timeout_ms: input.timeout_ms,
      output_mode: input.output_mode,
      dry_run: input.dry_run,
    },
    env,
  );
  if (input.dry_run) {
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      dryRun: true,
      targetOrg: resolved.targetOrg,
      apiVersion: resolved.apiVersion,
      orgType: resolved.orgType,
      safety: resolved.safety,
      request: { method: resolved.method, path: resolved.apiPath, body: body ?? null },
      summary: `Resolved raw Data 360 REST ${resolved.method} ${resolved.apiPath}`,
    };
  }
  if (!resolved.targetOrg) throw new Error("No Salesforce target org is configured.");
  if (resolved.safety.requiresConfirmation && !input.allow_confirmed) {
    return {
      ok: false,
      tool: input.tool,
      action: input.action,
      targetOrg: resolved.targetOrg,
      apiVersion: resolved.apiVersion,
      safety: resolved.safety,
      error: "CONFIRMATION_REQUIRED",
      summary: "Raw Data 360 REST request requires dry_run review and allow_confirmed=true.",
    };
  }
  if (signal?.aborted) throw new Error("data360_api rest.request cancelled before request.");
  const conn = await connFromAlias(resolved.targetOrg);
  const resp = await connRequest<unknown>(conn, {
    method: resolved.method,
    url: resolved.apiPath,
    body: resolved.method === "GET" ? undefined : body,
    timeoutMs: input.timeout_ms ?? 120_000,
  });
  const responseText = stringify(resp.body);
  const ok = resp.status >= 200 && resp.status < 300 && !responseLooksLikeError(responseText);
  return {
    ok,
    tool: input.tool,
    action: input.action,
    targetOrg: resolved.targetOrg,
    apiVersion: resolved.apiVersion,
    status: resp.status,
    safety: resolved.safety,
    request: { method: resolved.method, path: resolved.apiPath, body: body ?? null },
    response: resp.body,
    summary: `Raw Data 360 REST ${resolved.method} ${resolved.apiPath} HTTP ${resp.status}`,
  };
}

async function runReadinessProbe(
  input: Data360V2Input,
  env: SfEnvironment,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const { targetOrg, apiVersion } = await resolveTargetOrgContext(input.target_org, env);
  if (!targetOrg) throw new Error("No Salesforce target org is configured.");
  if (input.dry_run) {
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      dryRun: true,
      targetOrg,
      apiVersion,
      probes: PROBES.map((probe) => ({
        name: probe.name,
        path: buildApiPath(probe.path, apiVersion),
      })),
      summary: `Resolved ${PROBES.length} read-only Data 360 readiness probes`,
    };
  }
  const conn = await connFromAlias(targetOrg);
  const timeoutMs = typeof input.timeout_ms === "number" ? input.timeout_ms : 45_000;
  const probes: ProbeResult[] = await Promise.all(
    PROBES.map(async (probe) => {
      if (signal?.aborted) throw new Error("Data 360 readiness probe cancelled.");
      const apiPath = buildApiPath(probe.path, apiVersion);
      const resp = await connRequest<unknown>(conn, { method: "GET", url: apiPath, timeoutMs });
      return classifyConnectionProbeResult(probe.name, probe.path, resp.status, resp.body);
    }),
  );
  const summary = summarizeReadiness(probes);
  return {
    ok: summary.state !== "blocked",
    tool: input.tool,
    action: input.action,
    targetOrg,
    apiVersion,
    ...summary,
    probes,
    summary: `Data 360 readiness: ${summary.state}`,
  };
}

function runCatalogSearch(input: Data360V2Input): Record<string, unknown> {
  const query = stringParam(input.params, "query", "");
  const results = searchData360Actions(query).map(summarizeAction);
  return {
    ok: true,
    tool: input.tool,
    action: input.action,
    query,
    summary: `${results.length} matching Data 360 action(s)`,
    results,
  };
}

function runCatalogAction(input: Data360V2Input): Record<string, unknown> {
  const requestedTool = stringParam(input.params, "tool", "" as Data360V2ToolName) as
    | Data360V2ToolName
    | "";
  const requestedAction = requiredStringParam(input.params, "action");
  const matches = requestedTool
    ? [findData360Action(requestedTool, requestedAction)].filter(Boolean)
    : searchData360Actions(requestedAction).filter(
        (candidate) =>
          candidate.action === requestedAction || candidate.aliases?.includes(requestedAction),
      );
  const match = matches[0];
  if (!match) return unknownAction(input, requestedAction);
  return {
    ok: true,
    tool: input.tool,
    action: input.action,
    requestedTool: requestedTool || undefined,
    requestedAction,
    summary: `${match.tool} ${match.action}: ${match.description}`,
    match: summarizeAction(match),
    next_actions: nextActionsFor(match),
  };
}

async function runDiscoverExamplesGet(
  input: Data360V2Input,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const requestedTool = requiredStringParam(input.params, "tool") as Data360V2ToolName;
  const requestedAction = requiredStringParam(input.params, "action");
  const match = findData360Action(requestedTool, requestedAction);
  if (!match) return unknownAction({ ...input, tool: requestedTool }, requestedAction);
  return runExamplesForMatch(input, match, env, ctx, signal);
}

function runHelp(tool: Data360V2ToolName): Record<string, unknown> {
  const actions = getData360ActionsForTool(tool);
  return {
    ok: true,
    tool,
    action: "help",
    summary: `${tool} supports ${actions.length} action(s). Use actions.search or action.describe for details.`,
    commonActions: actions.slice(0, 12).map((entry) => entry.action),
    metaActions: ["help", "actions.list", "actions.search", "action.describe", "examples.get"],
  };
}

function runActionsList(tool: Data360V2ToolName): Record<string, unknown> {
  const actions = getData360ActionsForTool(tool).map(summarizeAction);
  return {
    ok: true,
    tool,
    action: "actions.list",
    summary: `${actions.length} ${tool} action(s)`,
    actions,
  };
}

function runActionsSearch(input: Data360V2Input): Record<string, unknown> {
  const query = stringParam(input.params, "query", "");
  const results = searchData360Actions(query, { tool: input.tool }).map(summarizeAction);
  return {
    ok: true,
    tool: input.tool,
    action: "actions.search",
    query,
    summary: `${results.length} matching ${input.tool} action(s)`,
    results,
  };
}

function runActionDescribe(input: Data360V2Input): Record<string, unknown> {
  const requestedAction = requiredStringParam(input.params, "action");
  const match = findData360Action(input.tool, requestedAction);
  if (!match) {
    return unknownAction(input, requestedAction);
  }
  return {
    ok: true,
    tool: input.tool,
    action: "action.describe",
    requestedAction,
    summary: `${input.tool} ${match.action}: ${match.description}`,
    match: summarizeAction(match),
    next_actions: nextActionsFor(match),
  };
}

async function runExamplesGet(
  input: Data360V2Input,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const requestedAction = requiredStringParam(input.params, "action");
  const match = findData360Action(input.tool, requestedAction);
  if (!match) return unknownAction(input, requestedAction);
  return runExamplesForMatch(input, match, env, ctx, signal);
}

async function runExamplesForMatch(
  input: Data360V2Input,
  match: Data360V2ActionDefinition,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  if (!match.capability) {
    return {
      ok: false,
      tool: input.tool,
      action: "examples.get",
      requestedAction: match.action,
      summary: `${match.action} does not have a capability-backed example yet`,
      suggestion: "Use action.describe for parameters and next actions.",
    };
  }
  const result = await runFacade(
    {
      action: "examples",
      capability: match.capability,
      variant: typeof input.params?.variant === "string" ? input.params.variant : undefined,
      target_org: input.target_org,
      output_mode: input.output_mode,
    },
    env,
    ctx,
    signal,
  );
  return decorateResult(input, match, result);
}

async function runMappedAction(
  input: Data360V2Input,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const match = findData360Action(input.tool, input.action);
  if (!match) return unknownAction(input, input.action);
  const metadataResult = await runCompactMetadataAction(input, match, env);
  if (metadataResult) return metadataResult;
  if (match.implementation?.kind === "local") return runLocalAction(input, match, env);
  if (match.implementation?.kind === "journey")
    return runJourneyAction(input, match, env, ctx, signal);
  if (match.implementation?.kind === "tenant_ingest")
    return runTenantIngestAction(input, match, env);
  if (match.implementation?.kind === "tenant_ingest_auth")
    return runTenantIngestAuthAction(input, match, env);
  if (!match.capability) {
    return {
      ok: false,
      tool: input.tool,
      action: input.action,
      summary: `${input.action} is not executable yet`,
      error: "ACTION_NOT_EXECUTABLE",
      suggestion: "Use action.describe or actions.search to choose a capability-backed action.",
    };
  }
  const result = await runFacade(
    {
      action: "execute",
      capability: match.capability,
      params: input.params,
      target_org: input.target_org,
      dry_run: input.dry_run,
      allow_confirmed: input.allow_confirmed,
      timeout_ms: input.timeout_ms,
      output_mode: input.output_mode,
    },
    env,
    ctx,
    signal,
  );
  return decorateResult(input, match, result);
}

async function runCompactMetadataAction(
  input: Data360V2Input,
  action: Data360V2ActionDefinition,
  env: SfEnvironment,
): Promise<Record<string, unknown> | undefined> {
  const metadataInput = metadataInputFor(input, action.action);
  if (!metadataInput) return undefined;
  const { targetOrg, apiVersion } = await resolveTargetOrgContext(input.target_org, env);
  if (!targetOrg) throw new Error("No Salesforce target org is configured.");
  const path = metadataPath(metadataInput);
  const apiPath = buildApiPath(path, apiVersion);
  if (input.dry_run) {
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      dryRun: true,
      targetOrg,
      apiVersion,
      request: { method: "GET", path: apiPath },
      summary: `Resolved compact metadata ${input.action}`,
    };
  }
  const conn = await connFromAlias(targetOrg);
  const resp = await connRequest<unknown>(conn, {
    method: "GET",
    url: apiPath,
    timeoutMs: input.timeout_ms ?? 120_000,
  });
  const raw = stringify(resp.body);
  const ok = resp.status >= 200 && resp.status < 300 && !responseLooksLikeError(raw);
  if (!ok) {
    return {
      ok: false,
      tool: input.tool,
      action: input.action,
      status: resp.status,
      request: { method: "GET", path: apiPath },
      response: resp.body,
      summary: `Compact metadata ${input.action} failed HTTP ${resp.status}`,
    };
  }
  const summary = summarizeMetadataOutput(metadataInput, raw, "(not written by v2 compact path)");
  return {
    ok: true,
    tool: input.tool,
    action: input.action,
    targetOrg,
    apiVersion,
    status: resp.status,
    request: { method: "GET", path: apiPath },
    text: summary.text,
    ...summary.details,
    summary: `Compact metadata ${input.action} HTTP ${resp.status}`,
  };
}

function metadataInputFor(input: Data360V2Input, action: string): D360MetadataInput | undefined {
  const params = input.params ?? {};
  const common = {
    category: typeof params.category === "string" ? params.category : undefined,
    max_fields: typeof params.max_fields === "number" ? params.max_fields : undefined,
    max_results: typeof params.max_results === "number" ? params.max_results : undefined,
    target_org: input.target_org,
    timeout_ms: input.timeout_ms,
  };
  switch (action) {
    case "dmo.list":
      return { action: "list_dmos", ...common };
    case "dlo.list":
      return { action: "list_dlos", ...common };
    case "dmo.get":
      return {
        action: "describe_dmo",
        api_name: requiredAnyString(params, ["dmoName", "api_name"]),
        ...common,
      };
    case "dlo.get":
      return {
        action: "describe_dlo",
        api_name: requiredAnyString(params, ["dloName", "api_name"]),
        ...common,
      };
    case "metadata.entities": {
      const entityType = requiredAnyString(params, ["entityType"]);
      if (entityType === "DataModelObject") return { action: "list_dmos", ...common };
      if (entityType === "DataLakeObject") return { action: "list_dlos", ...common };
      return undefined;
    }
    default:
      return undefined;
  }
}

function metadataPath(input: D360MetadataInput): string {
  switch (input.action) {
    case "list_dmos":
      return "/ssot/metadata-entities?entityType=DataModelObject";
    case "list_dlos":
      return "/ssot/metadata-entities?entityType=DataLakeObject";
    case "describe_dmo":
      return `/ssot/data-model-objects/${input.api_name}`;
    case "describe_dlo":
      return `/ssot/data-lake-objects/${input.api_name}`;
    default:
      throw new Error(`Unhandled metadata action ${input.action}`);
  }
}

function requiredAnyString(params: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  throw new Error(`Missing required parameter '${keys.join(" or ")}'.`);
}

async function runTenantIngestAuthAction(
  input: Data360V2Input,
  action: Data360V2ActionDefinition,
  env: SfEnvironment,
): Promise<Record<string, unknown>> {
  const { targetOrg, apiVersion } = await resolveTargetOrgContext(input.target_org, env);
  if (!targetOrg) throw new Error("No Salesforce target org is configured.");
  const params = input.params ?? {};
  if (action.action === "auth.pkce_start") {
    const result = startTenantIngestPkce(params);
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      targetOrg,
      apiVersion,
      ...result,
      summary: "Data Cloud ingest PKCE authorization URL generated",
      next_actions: [
        {
          tool: "data360_connect",
          action: "auth.exchange",
          params: { pkceState: result.authorization.state },
        },
      ],
    };
  }
  if (action.action === "auth.sessions") {
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      targetOrg,
      apiVersion,
      sessions: listTenantIngestTokenSessions(),
      summary: "Listed in-memory Data Cloud ingest auth sessions",
    };
  }
  if (action.action === "auth.clear") {
    const authSessionId =
      typeof params.authSessionId === "string" ? params.authSessionId.trim() : undefined;
    const cleared = clearTenantIngestTokenSessions(authSessionId);
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      targetOrg,
      apiVersion,
      cleared,
      summary: `Cleared ${cleared} in-memory Data Cloud ingest auth session(s)`,
    };
  }
  if (action.action === "auth.status") {
    const auth = inspectTenantIngestAuth(params);
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      targetOrg,
      apiVersion,
      auth,
      tokenExchange: tenantIngestTokenExchange(),
      summary: `Data Cloud ingest auth status: ${auth.status}`,
      next_actions: [{ tool: "data360_connect", action: "auth.plan" }],
    };
  }
  if (action.action === "auth.plan") {
    const plan = planTenantIngestAuth(params);
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      dryRun: true,
      targetOrg,
      apiVersion,
      strategy: plan.strategy,
      tokenExchange: plan.tokenExchange,
      steps: plan.steps,
      storesSecrets: plan.storesSecrets,
      executesNetworkCalls: plan.executesNetworkCalls,
      summary: `Data Cloud ingest auth plan (${plan.strategy})`,
      next_actions: [{ tool: "data360_connect", action: "auth.status" }],
    };
  }
  if (action.action === "auth.exchange") {
    if (input.dry_run) {
      const plan = planTenantIngestExchange(params);
      return {
        ok: true,
        tool: input.tool,
        action: input.action,
        dryRun: true,
        targetOrg,
        apiVersion,
        steps: plan.steps,
        storesSecrets: plan.storesSecrets,
        executesNetworkCalls: plan.executesNetworkCalls,
        summary: "Data Cloud ingest auth exchange dry-run",
      };
    }
    const result = await exchangePkceForTenantIngestAuth(params);
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      targetOrg,
      apiVersion,
      auth: result.auth,
      token: result.token,
      authSession: result.authSession,
      storesSecrets: result.storesSecrets,
      summary: `Data Cloud ingest auth exchange ready for tenant ${result.auth.tenantHost}`,
      next_actions: [{ tool: "data360_prepare", action: "ingest_job.create" }],
    };
  }
  return {
    ok: false,
    tool: input.tool,
    action: input.action,
    error: "UNKNOWN_TENANT_INGEST_AUTH_ACTION",
    summary: `Unknown tenant ingest auth action ${action.action}`,
  };
}

async function runTenantIngestAction(
  input: Data360V2Input,
  action: Data360V2ActionDefinition,
  env: SfEnvironment,
): Promise<Record<string, unknown>> {
  const { targetOrg, apiVersion } = await resolveTargetOrgContext(input.target_org, env);
  if (!targetOrg) throw new Error("No Salesforce target org is configured.");
  const plan = planTenantIngestRequest(action.action as TenantIngestActionName, input.params ?? {});
  if (!input.dry_run) {
    const authSessionId =
      typeof input.params?.authSessionId === "string" ? input.params.authSessionId : undefined;
    const session = getTenantIngestTokenSession(authSessionId);
    if (!session) {
      return {
        ok: false,
        tool: input.tool,
        action: input.action,
        targetOrg,
        apiVersion,
        safety: action.safety,
        auth: plan.auth,
        request: plan.request,
        error: "DATA_CLOUD_INGEST_AUTH_REQUIRED",
        summary:
          "Tenant ingest execution requires Data Cloud ingest auth; run dry_run or configure auth first.",
        recover_via: {
          tool: "data360_connect",
          action: "actions.search",
          params: { query: "ingest auth" },
        },
      };
    }
    const response = await executeTenantIngestRequest(plan.request, session);
    return {
      ok: response.ok,
      tool: input.tool,
      action: input.action,
      targetOrg,
      apiVersion,
      status: response.status,
      safety: action.safety,
      auth: { required: true, status: "ready", tenantHost: session.tenantHost },
      request: plan.request,
      response: response.body,
      summary: `Tenant ingest ${action.action} HTTP ${response.status}`,
      next_actions: nextActionsFor(action),
    };
  }
  return {
    ok: true,
    tool: input.tool,
    action: input.action,
    dryRun: true,
    targetOrg,
    apiVersion,
    safety: action.safety,
    auth: plan.auth,
    request: plan.request,
    summary: `Resolved tenant ingest ${action.action}`,
    next_actions: nextActionsFor(action),
  };
}

function agentBehaviorSteps(): Data360V2Step[] {
  return [
    {
      label: "Find or inspect the STDM session timeline",
      tool: "data360_observe",
      action: "stdm.session_timeline",
    },
    {
      label: "Find recent platform error traces",
      tool: "data360_observe",
      action: "trace.error_traces",
    },
    {
      label: "Summarize backend latency by operation",
      tool: "data360_observe",
      action: "trace.operation_latency_summary",
    },
  ];
}

async function runAgentBehaviorInvestigation(
  input: Data360V2Input,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const params = input.params ?? {};
  const sessionId = typeof params.session_id === "string" ? params.session_id : params.sessionId;
  const traceId = typeof params.trace_id === "string" ? params.trace_id : params.traceId;
  const since = typeof params.since === "string" ? params.since : undefined;
  const limit = typeof params.limit === "number" ? params.limit : undefined;
  if (!sessionId && !traceId && !since) {
    return {
      ok: false,
      tool: input.tool,
      action: input.action,
      error: "MISSING_INVESTIGATION_INPUT",
      summary: "Pass session_id, trace_id, or since to run an Agentforce investigation.",
      recover_via: { tool: "data360_orchestrate", action: "agent_behavior_investigation.plan" },
    };
  }
  const sections: Array<Record<string, unknown>> = [];
  if (sessionId) {
    sections.push(
      await runInvestigationSection(input, env, ctx, signal, "stdm.session_timeline", {
        session_id: sessionId,
        limit,
      }),
    );
  }
  if (since) {
    sections.push(
      await runInvestigationSection(input, env, ctx, signal, "trace.error_traces", {
        since,
        limit,
      }),
    );
    sections.push(
      await runInvestigationSection(input, env, ctx, signal, "trace.operation_latency_summary", {
        since,
        limit,
      }),
    );
  }
  if (traceId) {
    sections.push(
      await runInvestigationSection(input, env, ctx, signal, "trace.trace_tree", {
        trace_id: traceId,
      }),
    );
  }
  return {
    ok: sections.every((section) => section.ok !== false),
    tool: input.tool,
    action: input.action,
    journey: "agent_behavior_investigation",
    sections,
    report: agentBehaviorReport(sections),
    summary: "Agent behavior investigation complete",
    next_actions: [
      { tool: "data360_observe", action: "trace.trace_tree" },
      { tool: "data360_observe", action: "trace.join_interaction_trace" },
    ],
  };
}

async function runInvestigationSection(
  input: Data360V2Input,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await runData360V2Action(
    { tool: "data360_observe", action, target_org: input.target_org, params },
    env,
    ctx,
    signal,
  );
  return {
    action,
    ok: result.ok !== false,
    summary: result.summary,
    result: result.result,
  };
}

function agentBehaviorReport(sections: Array<Record<string, unknown>>): string {
  return [
    "✅ Agent behavior investigation complete",
    "",
    ...sections.map((section) => `- ${section.action}: ${section.summary ?? "complete"}`),
  ].join("\n");
}

function planKnownJourney(
  input: Data360V2Input,
  journeyName: string,
  steps: Data360V2Step[],
): Record<string, unknown> {
  const journey = findData360Journey(journeyName);
  return {
    ok: true,
    tool: input.tool,
    action: input.action,
    journey: journeyName,
    phases: journey?.phases ?? [],
    requiredInputs: journey?.requiredInputs ?? [],
    providedInputs: input.params ?? {},
    missingInputs: (journey?.requiredInputs ?? []).filter(
      (entry) => input.params?.[entry] === undefined,
    ),
    steps,
    verification: journey?.verification ?? [],
    suggestedQuestions: journey?.suggestedQuestions ?? [],
    summary: `${journeyName} plan resolved without mutation`,
  };
}

async function runManifest(
  input: Data360V2Input,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const authSessionId = requiredStringParam(input.params, "authSessionId");
  const plan = await planManifest(input.params ?? {});
  const current = await runData360V2Action(
    {
      tool: "data360_connect",
      action: "source_schema.get",
      target_org: input.target_org,
      params: { connectionId: plan.manifest.source.connectionId },
    },
    env,
    ctx,
    signal,
  );
  const existingSchemas = Array.isArray(asRecord(current.response)?.schemas)
    ? (asRecord(current.response)?.schemas as unknown[]).map(sanitizeSchema)
    : [];
  const newNames = new Set(plan.datasets.map((dataset) => dataset.schemaName));
  const body = {
    schemas: [
      ...existingSchemas.filter((schema) => !newNames.has(String(schema.name))),
      ...plan.datasets.map((dataset) => dataset.inferred.schema),
    ],
  };
  const schemaTest = await runData360V2Action(
    {
      tool: "data360_connect",
      action: "source_schema.test",
      target_org: input.target_org,
      params: { connectionId: plan.manifest.source.connectionId, body },
    },
    env,
    ctx,
    signal,
  );
  if (schemaTest.ok === false) return { ...schemaTest, summary: "manifest.run schema test failed" };
  const schemaPut = await runData360V2Action(
    {
      tool: "data360_connect",
      action: "source_schema.put",
      target_org: input.target_org,
      allow_confirmed: true,
      params: { connectionId: plan.manifest.source.connectionId, body },
    },
    env,
    ctx,
    signal,
  );
  if (schemaPut.ok === false) return { ...schemaPut, summary: "manifest.run schema upload failed" };

  const connectorName = await resolveIngestApiConnectorName(
    input,
    env,
    ctx,
    signal,
    plan.manifest.source,
  );
  const results: Record<string, unknown>[] = [];
  for (const dataset of plan.datasets) {
    const stream = await runData360V2Action(
      {
        tool: "data360_prepare",
        action: "stream.create_ingest_api",
        target_org: input.target_org,
        allow_confirmed: true,
        params: { body: streamCreateBody(connectorName, dataset) },
      },
      env,
      ctx,
      signal,
    );
    if (stream.ok === false) {
      return manifestFailure(input, "stream.create_ingest_api", dataset.schemaName, stream);
    }
    const streamName = stringFromPath(stream, ["response", "name"], dataset.streamName);
    const dloName = await resolveCreatedDloName(input, env, ctx, signal, streamName);
    const before = await runData360V2Action(
      {
        tool: "data360_query",
        action: "sql.verify_rows",
        target_org: input.target_org,
        params: { dloName },
      },
      env,
      ctx,
      signal,
    );
    const beforeRows = rowCountFromResult(before, 0);
    const job = await createManifestIngestJob(input, env, ctx, signal, {
      authSessionId,
      sourceName: plan.manifest.source.name,
      object: dataset.schemaName,
    });
    if (job.ok === false) {
      return manifestFailure(input, "ingest_job.create", dataset.schemaName, job);
    }
    const jobId = stringFromPath(job, ["response", "id"]);
    await runData360V2Action(
      {
        tool: "data360_prepare",
        action: "ingest_job.upload_csv",
        target_org: input.target_org,
        params: { authSessionId, jobId, csvPath: dataset.csvPath },
      },
      env,
      ctx,
      signal,
    );
    const close = await runData360V2Action(
      {
        tool: "data360_prepare",
        action: "ingest_job.close",
        target_org: input.target_org,
        params: { authSessionId, jobId },
      },
      env,
      ctx,
      signal,
    );
    if (close.ok === false) {
      return manifestFailure(input, "ingest_job.close", dataset.schemaName, close);
    }
    const finalJob = await pollManifestJob(input, env, ctx, signal, authSessionId, jobId);
    const after = await runData360V2Action(
      {
        tool: "data360_query",
        action: "sql.verify_rows",
        target_org: input.target_org,
        params: { dloName },
      },
      env,
      ctx,
      signal,
    );
    results.push({
      schemaName: dataset.schemaName,
      streamName,
      dloName,
      jobId,
      jobState: stringFromPath(finalJob, ["response", "state"], "unknown"),
      beforeRows,
      afterRows: rowCountFromResult(after, beforeRows),
    });
  }

  return {
    ok: true,
    tool: input.tool,
    action: input.action,
    results,
    report: manifestRunReport(results),
    summary: `Manifest run complete for ${results.length} dataset(s)`,
    next_actions: [
      { tool: "data360_orchestrate", action: "cleanup.plan" },
      { tool: "data360_query", action: "sql.verify_rows" },
    ],
  };
}

function manifestFailure(
  input: Data360V2Input,
  failedStep: string,
  failedDataset: string,
  failure: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...failure,
    failedStep,
    failedDataset,
    retryable: true,
    recover_via: {
      tool: "data360_orchestrate",
      action: "manifest.run",
      params: {
        ...(input.params ?? {}),
        resumeFrom: failedStep,
      },
    },
    cleanupPlan: { tool: "data360_orchestrate", action: "cleanup.plan" },
    summary: `manifest.run failed at ${failedStep} for ${failedDataset}`,
  };
}

function manifestRunReport(results: Record<string, unknown>[]): string {
  const lines = [
    "✅ Manifest run complete",
    "",
    "| Dataset | DLO | Rows | Job |",
    "| --- | --- | ---: | --- |",
  ];
  for (const result of results) {
    const schemaName = String(result.schemaName ?? "(unknown)");
    const dloName = String(result.dloName ?? "(unknown)");
    const beforeRows = Number(result.beforeRows ?? 0);
    const afterRows = Number(result.afterRows ?? beforeRows);
    const jobState = String(result.jobState ?? "unknown");
    lines.push(`| ${schemaName} | ${dloName} | ${beforeRows} → ${afterRows} | ${jobState} |`);
  }
  return lines.join("\n");
}

async function resolveIngestApiConnectorName(
  input: Data360V2Input,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  source: { name: string; connectionId: string },
): Promise<string> {
  const listed = await runData360V2Action(
    {
      tool: "data360_connect",
      action: "source.list_ingest_api",
      target_org: input.target_org,
    },
    env,
    ctx,
    signal,
  );
  const connections = asRecord(listed.response)?.connections;
  if (Array.isArray(connections)) {
    const match = connections.map(asRecord).find((connection) => {
      return (
        connection?.id === source.connectionId ||
        connection?.connectionId === source.connectionId ||
        connection?.name === source.name ||
        connection?.label === source.name
      );
    });
    if (typeof match?.name === "string" && match.name.trim()) return match.name.trim();
  }
  return source.name;
}

async function resolveCreatedDloName(
  input: Data360V2Input,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  streamName: string,
): Promise<string> {
  const listed = await runData360V2Action(
    {
      tool: "data360_prepare",
      action: "stream.list",
      target_org: input.target_org,
      params: { limit: 100 },
    },
    env,
    ctx,
    signal,
  );
  const streams = asRecord(listed.response)?.dataStreams;
  if (Array.isArray(streams)) {
    const match = streams.map(asRecord).find((stream) => stream?.name === streamName);
    const dloName = asRecord(match?.dataLakeObjectInfo)?.name;
    if (typeof dloName === "string" && dloName.trim()) return dloName.trim();
  }
  return `${streamName}__dll`;
}

async function createManifestIngestJob(
  input: Data360V2Input,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  params: { authSessionId: string; sourceName: string; object: string },
): Promise<Record<string, unknown>> {
  const maxAttempts =
    typeof input.params?.jobCreateMaxAttempts === "number" ? input.params.jobCreateMaxAttempts : 6;
  const retryMs =
    typeof input.params?.jobCreateRetryMs === "number" ? input.params.jobCreateRetryMs : 10_000;
  let last: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await runData360V2Action(
      {
        tool: "data360_prepare",
        action: "ingest_job.create",
        target_org: input.target_org,
        params,
      },
      env,
      ctx,
      signal,
    );
    if (last.ok !== false) return last;
    if (!looksLikeTenantObjectNotReady(last)) return last;
    if (retryMs > 0) await sleep(retryMs);
  }
  return last ?? { ok: false, error: "INGEST_JOB_CREATE_FAILED" };
}

function looksLikeTenantObjectNotReady(result: Record<string, unknown>): boolean {
  const status = result.status;
  const response = asRecord(result.response);
  const message = typeof response?.message === "string" ? response.message : "";
  return status === 404 && /requested resource/i.test(message);
}

async function pollManifestJob(
  input: Data360V2Input,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  authSessionId: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  const maxPolls = typeof input.params?.maxPolls === "number" ? input.params.maxPolls : 60;
  const pollIntervalMs =
    typeof input.params?.pollIntervalMs === "number" ? input.params.pollIntervalMs : 5_000;
  let last: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    last = await runData360V2Action(
      {
        tool: "data360_prepare",
        action: "ingest_job.poll",
        target_org: input.target_org,
        params: { authSessionId, jobId },
      },
      env,
      ctx,
      signal,
    );
    const state = stringFromPath(last, ["response", "state"], "unknown");
    if (state === "JobComplete") return last;
    if (state === "Failed" || state === "Aborted")
      throw new Error(`Ingest job ${jobId} ended ${state}.`);
    if (pollIntervalMs > 0) await sleep(pollIntervalMs);
  }
  throw new Error(
    `Ingest job ${jobId} did not complete after ${maxPolls} poll(s): ${stringify(last)}`,
  );
}

function rowCountFromResult(result: Record<string, unknown>, fallback: number): number {
  const response = asRecord(result.response);
  const data = response?.data;
  if (Array.isArray(data) && Array.isArray(data[0]) && typeof data[0][0] === "number") {
    return data[0][0];
  }
  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLocalAction(
  input: Data360V2Input,
  action: Data360V2ActionDefinition,
  env: SfEnvironment,
): Promise<Record<string, unknown>> {
  if (action.implementation?.name === "csv_schema.infer") {
    const inferred = await inferCsvSchema(input.params ?? {});
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      ...inferred,
      summary: `Inferred ${inferred.schema.fields.length} field(s) for ${inferred.schema.name}`,
    };
  }
  if (action.implementation?.name !== "sql.verify_rows") {
    return {
      ok: false,
      tool: input.tool,
      action: input.action,
      error: "UNKNOWN_LOCAL_ACTION",
      summary: `Unknown local action ${action.implementation?.name ?? "(none)"}`,
    };
  }
  const { targetOrg, apiVersion } = await resolveTargetOrgContext(input.target_org, env);
  if (!targetOrg) throw new Error("No Salesforce target org is configured.");
  const dloName = requiredSafeApiName(input.params, "dloName");
  const dataspaceName = stringParam(input.params, "dataspaceName", "default");
  const sql = `SELECT COUNT(*) AS row_count FROM ${dloName}`;
  const request = {
    method: "POST" as const,
    path: buildApiPath("/ssot/query-sql", apiVersion, { dataspaceName }),
    body: { sql },
  };
  if (input.dry_run) {
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      dryRun: true,
      targetOrg,
      apiVersion,
      dataspaceName,
      safety: action.safety,
      request,
      summary: `Resolved row-count verification for ${dloName}`,
      next_actions: nextActionsFor(action),
    };
  }
  const conn = await connFromAlias(targetOrg);
  const resp = await connRequest<unknown>(conn, {
    method: request.method,
    url: request.path,
    body: request.body,
    timeoutMs: input.timeout_ms ?? 120_000,
  });
  const responseText = stringify(resp.body);
  const ok = resp.status >= 200 && resp.status < 300 && !responseLooksLikeError(responseText);
  return {
    ok,
    tool: input.tool,
    action: input.action,
    targetOrg,
    apiVersion,
    dataspaceName,
    status: resp.status,
    safety: action.safety,
    request,
    response: resp.body,
    summary: `Verified row count for ${dloName} HTTP ${resp.status}`,
    next_actions: nextActionsFor(action),
  };
}

async function runJourneyAction(
  input: Data360V2Input,
  action: Data360V2ActionDefinition,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  if (action.implementation?.name === "journey.list") {
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      journeys: getData360Journeys().map((journey) => ({
        name: journey.name,
        summary: journey.summary,
        phases: journey.phases,
        planAction: journey.planAction,
        runAction: journey.runAction,
      })),
      summary: "Listed Data 360 outcome journeys",
    };
  }
  if (action.implementation?.name === "journey.describe") {
    const journeyName = requiredStringParam(input.params, "journey");
    const journey = findData360Journey(journeyName);
    if (!journey) {
      return {
        ok: false,
        tool: input.tool,
        action: input.action,
        error: "UNKNOWN_JOURNEY",
        summary: `Unknown Data 360 journey '${journeyName}'.`,
        suggestions: getData360Journeys().map((entry) => entry.name),
      };
    }
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      journey,
      availableActions: journey.availableActions,
      summary: `${journey.name}: ${journey.summary}`,
      next_actions: journey.availableActions.slice(0, 3),
    };
  }
  if (action.implementation?.name === "intent.plan") {
    const utterance = requiredStringParam(input.params, "utterance");
    const plan = planData360Intent(utterance);
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      utterance,
      recommendedJourney: plan.journey.name,
      journey: plan.journey,
      confidence: plan.confidence,
      missingInputs: plan.missingInputs,
      suggestedQuestions: plan.journey.suggestedQuestions,
      targetTool: plan.targetTool,
      targetAction: plan.targetAction,
      summary: `Recommended Data 360 journey: ${plan.journey.name}`,
      next_actions: [
        {
          tool: plan.targetTool,
          action: plan.targetAction,
          params: { journey: plan.journey.name },
        },
      ],
    };
  }
  if (action.implementation?.name === "make_data_usable.plan") {
    return planKnownJourney(input, "make_data_usable", [
      {
        label: "Validate or create source connection",
        tool: "data360_connect",
        action: "connection.test",
      },
      {
        label: "Land raw data through a stream or manifest",
        tool: "data360_orchestrate",
        action: "manifest.plan",
      },
      {
        label: "Map raw data to the target model",
        tool: "data360_harmonize",
        action: "mapping.create",
      },
      {
        label: "Verify loaded rows and mappings",
        tool: "data360_query",
        action: "sql.verify_rows",
      },
    ]);
  }
  if (action.implementation?.name === "agent_behavior_investigation.plan") {
    return planKnownJourney(input, "agent_behavior_investigation", agentBehaviorSteps());
  }
  if (action.implementation?.name === "semantic_retrieval.plan") {
    return planKnownJourney(input, "semantic_retrieval", [
      {
        label: "List or choose a semantic model",
        tool: "data360_semantic",
        action: "semantic_model.list",
      },
      {
        label: "Find embedding model artifacts",
        tool: "data360_semantic",
        action: "model_artifact.list",
      },
      {
        label: "Inspect search index configuration options",
        tool: "data360_semantic",
        action: "search_index.config",
      },
      {
        label: "Create or update a semantic search index",
        tool: "data360_semantic",
        action: "search_index.create",
      },
      { label: "Create retriever", tool: "data360_semantic", action: "retriever.create" },
      {
        label: "Create retriever configuration",
        tool: "data360_semantic",
        action: "retriever.config.create",
      },
      {
        label: "Validate semantic model",
        tool: "data360_semantic",
        action: "semantic_model.validate",
      },
      { label: "Read retriever details", tool: "data360_semantic", action: "retriever.get" },
    ]);
  }
  if (action.implementation?.name === "agent_behavior_investigation.run") {
    return runAgentBehaviorInvestigation(input, env, ctx, signal);
  }
  if (action.implementation?.name === "manifest.validate") {
    const manifest = await loadManifest(input.params ?? {});
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      manifest,
      datasetCount: manifest.datasets.length,
      summary: `Validated Data 360 ingest manifest with ${manifest.datasets.length} dataset(s)`,
    };
  }
  if (
    action.implementation?.name === "manifest.plan" ||
    action.implementation?.name === "ingest_csv.run"
  ) {
    const plan = await planManifest(input.params ?? {});
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      dryRun: true,
      manifest: plan.manifest,
      datasets: plan.datasets.map((dataset) => ({
        csvPath: dataset.csvPath,
        schemaName: dataset.schemaName,
        streamName: dataset.streamName,
        primaryKey: dataset.primaryKey,
        recordModifiedField: dataset.recordModifiedField,
        dloName: dataset.dloName,
      })),
      steps: plan.steps,
      summary:
        action.implementation?.name === "ingest_csv.run"
          ? "Data 360 ingest_csv.run dry-run plan resolved"
          : "Data 360 manifest plan resolved",
    };
  }
  if (action.implementation?.name === "manifest.run") {
    if (!input.allow_confirmed) {
      return {
        ok: false,
        tool: input.tool,
        action: input.action,
        error: "CONFIRMATION_REQUIRED",
        summary: "manifest.run requires allow_confirmed=true after reviewing manifest.plan.",
      };
    }
    return runManifest(input, env, ctx, signal);
  }
  if (
    action.implementation?.name === "cleanup.plan" ||
    action.implementation?.name === "cleanup.run"
  ) {
    const cleanup = planCleanup(input.params ?? {});
    if (action.implementation?.name === "cleanup.run" && !input.allow_confirmed) {
      return {
        ok: false,
        tool: input.tool,
        action: input.action,
        error: "CONFIRMATION_REQUIRED",
        resources: cleanup.resources,
        summary: "cleanup.run requires allow_confirmed=true after reviewing cleanup.plan.",
      };
    }
    if (action.implementation?.name === "cleanup.run") {
      const results = [];
      for (const resource of cleanup.resources) {
        if (resource.type !== "data_stream") continue;
        const deleted = await runData360V2Action(
          {
            tool: "data360_prepare",
            action: "stream.delete",
            target_org: input.target_org,
            allow_confirmed: true,
            params: {
              dataStreamId: resource.id,
              shouldDeleteDataLakeObject: cleanup.shouldDeleteDataLakeObject,
            },
          },
          env,
          ctx,
          signal,
        );
        results.push({ id: resource.id, ok: deleted.ok !== false, result: deleted });
      }
      return {
        ok: results.every((result) => result.ok),
        tool: input.tool,
        action: input.action,
        resources: cleanup.resources,
        results,
        summary: `cleanup.run processed ${results.length} resource(s)`,
      };
    }
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      resources: cleanup.resources,
      shouldDeleteDataLakeObject: cleanup.shouldDeleteDataLakeObject,
      summary: `${action.action} resolved ${cleanup.resources.length} resource(s)`,
    };
  }
  if (action.implementation?.name === "ingest_auth.pkce_interactive") {
    const { targetOrg, apiVersion } = await resolveTargetOrgContext(input.target_org, env);
    if (!targetOrg) throw new Error("No Salesforce target org is configured.");
    if (input.dry_run) {
      return {
        ok: true,
        tool: input.tool,
        action: input.action,
        dryRun: true,
        targetOrg,
        apiVersion,
        ...planInteractivePkceAuth(input.params ?? {}),
        summary: "Data Cloud ingest interactive PKCE auth plan",
      };
    }
    const result = await runInteractivePkceAuth(input.params ?? {});
    return {
      ok: true,
      tool: input.tool,
      action: input.action,
      targetOrg,
      apiVersion,
      auth: result.auth,
      token: result.token,
      authSession: result.authSession,
      storesSecrets: result.storesSecrets,
      secretStorage: result.secretStorage,
      summary: `Data Cloud ingest interactive PKCE auth ready for tenant ${result.auth.tenantHost}`,
      next_actions: [{ tool: "data360_prepare", action: "ingest_job.create" }],
    };
  }
  if (action.implementation?.name !== "ingest_csv") {
    return {
      ok: false,
      tool: input.tool,
      action: input.action,
      error: "UNKNOWN_JOURNEY",
      summary: `Unknown journey ${action.implementation?.name ?? "(none)"}`,
    };
  }
  const { targetOrg, apiVersion } = await resolveTargetOrgContext(input.target_org, env);
  if (!targetOrg) throw new Error("No Salesforce target org is configured.");
  const params = input.params ?? {};
  const sourceName = requiredStringParam(params, "sourceName");
  const schemaObjectName = requiredSafeApiName(params, "schemaObjectName");
  const streamName = requiredSafeApiName(params, "streamName");
  const csvPath = requiredStringParam(params, "csvPath");
  const connectionId =
    typeof params.connectionId === "string" ? params.connectionId : "<connectionId>";
  const dloName =
    typeof params.dloName === "string" && params.dloName.trim()
      ? params.dloName.trim()
      : `${streamName}_${schemaObjectName}__dll`;
  const steps: Data360V2Step[] = [
    { label: "Check Data 360 readiness", tool: "data360_discover", action: "readiness.probe" },
    {
      label: "Validate Ingestion API source schema",
      tool: "data360_connect",
      action: "source_schema.test",
      params: { connectionId, body: "<schemaPayload>" },
      safety: "safe_post",
      endpoint: { method: "POST", path: "/ssot/connections/{connectionId}/schema/actions/test" },
    },
    {
      label: "Upload Ingestion API source schema",
      tool: "data360_connect",
      action: "source_schema.put",
      params: { connectionId, body: "<schemaPayload>" },
      safety: "confirmed",
      endpoint: { method: "PUT", path: "/ssot/connections/{connectionId}/schema" },
    },
    {
      label: "Create Ingestion API data stream",
      tool: "data360_prepare",
      action: "stream.create_ingest_api",
      params: { sourceName, schemaObjectName, streamName },
      safety: "confirmed",
      endpoint: { method: "POST", path: "/ssot/data-streams" },
    },
    { label: "Create tenant ingest job", tool: "data360_prepare", action: "ingest_job.create" },
    {
      label: "Upload CSV bytes to tenant ingest job",
      tool: "data360_prepare",
      action: "ingest_job.upload_csv",
      params: { csvPath },
    },
    { label: "Close tenant ingest job", tool: "data360_prepare", action: "ingest_job.close" },
    { label: "Poll tenant ingest job", tool: "data360_prepare", action: "ingest_job.poll" },
    {
      label: "Verify DLO row count",
      tool: "data360_query",
      action: "sql.verify_rows",
      params: { dloName },
      safety: "safe_post",
      endpoint: { method: "POST", path: "/ssot/query-sql" },
    },
  ];
  return {
    ok: true,
    tool: input.tool,
    action: input.action,
    dryRun: true,
    targetOrg,
    apiVersion,
    sourceName,
    schemaObjectName,
    streamName,
    csvPath,
    summary: "Route A CSV ingestion plan resolved without mutation",
    steps,
  };
}

function decorateResult(
  input: Data360V2Input,
  action: Data360V2ActionDefinition,
  result: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...result,
    tool: input.tool,
    action: action.action,
    requestedAction: input.action,
    capability: action.capability,
    family: action.family,
    phase: action.phase,
    next_actions: nextActionsFor(action),
  };
}

function unknownAction(input: Data360V2Input, actionName: string): Record<string, unknown> {
  const suggestions = searchData360Actions(actionName, { tool: input.tool, limit: 5 }).map(
    (action) => ({ tool: action.tool, action: action.action, description: action.description }),
  );
  return {
    ok: false,
    tool: input.tool,
    action: input.action,
    error: "UNKNOWN_ACTION",
    summary: `Unknown ${input.tool} action '${actionName}'.`,
    suggestion: suggestions.length
      ? "Use one of the suggested actions or call actions.search."
      : "Call actions.list or actions.search to discover available actions.",
    suggestions,
    recover_via: suggestions[0]
      ? {
          tool: suggestions[0].tool,
          action: "action.describe",
          params: { action: suggestions[0].action },
        }
      : { tool: input.tool, action: "actions.list" },
  };
}

function nextActionsFor(action: Data360V2ActionDefinition): Array<Record<string, unknown>> {
  switch (action.action) {
    case "source_schema.test":
      return [{ tool: "data360_connect", action: "source_schema.put" }];
    case "source_schema.put":
      return [{ tool: "data360_prepare", action: "stream.create_ingest_api" }];
    case "stream.create_ingest_api":
      return [
        { tool: "data360_prepare", action: "ingest_job.create" },
        { tool: "data360_query", action: "sql.verify_rows" },
      ];
    default:
      return [];
  }
}

function sanitizeSchema(value: unknown): Record<string, unknown> {
  const schema = asRecord(value) ?? {};
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  return {
    name: schema.name,
    label: schema.label ?? schema.name,
    schemaType: schema.schemaType ?? "IngestApi",
    fields: fields.map((field) => {
      const record = asRecord(field) ?? {};
      return {
        name: record.name,
        label: record.label ?? record.name,
        dataType: record.dataType ?? "Text",
      };
    }),
  };
}

function streamCreateBody(
  sourceName: string,
  dataset: {
    streamName: string;
    schemaName: string;
    primaryKey: string;
    recordModifiedField: string;
  },
): Record<string, unknown> {
  return {
    name: dataset.streamName,
    label: dataset.streamName,
    datastreamType: "INGESTAPI",
    connectorInfo: {
      connectorType: "IngestApi",
      connectorDetails: { name: sourceName, events: [dataset.schemaName] },
    },
    dataLakeObjectInfo: {
      name: `${dataset.streamName}__dll`,
      label: dataset.streamName,
      category: "Other",
      dataspaceInfo: [{ name: "default" }],
      dataLakeFieldInputRepresentations: [
        {
          label: dataset.primaryKey,
          name: dataset.primaryKey,
          dataType: "Text",
          isPrimaryKey: true,
        },
      ],
      recordModifiedFieldName: dataset.recordModifiedField,
    },
  };
}

function stringFromPath(obj: Record<string, unknown>, path: string[], fallback?: string): string {
  let current: unknown = obj;
  for (const key of path) current = asRecord(current)?.[key];
  if (typeof current === "string" && current.trim()) return current.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing expected string path ${path.join(".")}`);
}

function requiredStringParam(params: Record<string, unknown> | undefined, key: string): string {
  const value = params?.[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Missing required parameter '${key}'.`);
  return value.trim();
}

function stringParam(
  params: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const value = params?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asQueryParams(value: unknown): QueryParams | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const query: QueryParams = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      entry === null ||
      Array.isArray(entry)
    ) {
      query[key] = entry as QueryParams[string];
    }
  }
  return Object.keys(query).length ? query : undefined;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function requiredSafeApiName(params: Record<string, unknown> | undefined, key: string): string {
  const value = requiredStringParam(params, key);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Parameter '${key}' must be an API-safe name.`);
  }
  return value;
}
