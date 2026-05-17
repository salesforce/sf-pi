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
import { StringEnum } from "@earendil-works/pi-ai";
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
  D360_EXAMPLES,
  D360_OPERATIONS,
  D360_RUNBOOKS,
  findOperation,
  findRunbook,
  searchRegistry,
  type D360Operation,
} from "./facade/registry.ts";
import { runAgentObservabilityRunbook } from "./facade/agent-observability.ts";

export const D360_FACADE_TOOL_NAME = "d360";

const D360FacadeAction = StringEnum(["search", "examples", "execute", "runbook"] as const, {
  description: "Facade action to run.",
});

export const D360FacadeParams = Type.Object({
  action: D360FacadeAction,
  query: Type.Optional(Type.String({ description: "Search text for action='search'." })),
  operation: Type.Optional(
    Type.String({ description: "Registry operation name for examples/execute." }),
  ),
  runbook: Type.Optional(Type.String({ description: "Runbook name for examples/runbook." })),
  params: Type.Optional(
    Type.Record(Type.String(), Type.Any(), { description: "Operation/runbook parameters." }),
  ),
  target_org: Type.Optional(
    Type.String({ description: "Salesforce org alias or username. Defaults to active sf-pi org." }),
  ),
  dry_run: Type.Optional(
    Type.Boolean({
      description: "Return resolved operation/runbook request without network calls.",
    }),
  ),
  timeout_ms: Type.Optional(Type.Number({ description: "Optional request timeout in ms." })),
  output_mode: Type.Optional(
    StringEnum(["inline", "summary", "file_only"] as const, {
      description: "How to return broad responses.",
    }),
  ),
});

type D360FacadeActionValue = "search" | "examples" | "execute" | "runbook";

export interface D360FacadeInput {
  action: D360FacadeActionValue;
  query?: string;
  operation?: string;
  runbook?: string;
  params?: Record<string, unknown>;
  target_org?: string;
  dry_run?: boolean;
  timeout_ms?: number;
  output_mode?: D360OutputMode;
}

export function registerD360FacadeTool(pi: ExtensionAPI): void {
  const exec = buildExecFn(pi);

  pi.registerTool({
    name: D360_FACADE_TOOL_NAME,
    label: "Data 360 Facade",
    description:
      "Facade for Data 360 operation discovery, examples, registry execution, and deterministic runbooks.",
    promptSnippet: "Search/examples/execute/runbook facade for deterministic Data 360 workflows",
    promptGuidelines: [
      "Use d360 action='search' to discover Data 360 operation families without loading large references.",
      "Use d360 action='examples' before complex or mutating registry operations.",
      "Use d360 action='runbook' for deterministic Agentforce observability workflows (STDM + Agent Platform Tracing).",
      "Use d360_api as the raw REST escape hatch when an operation is not in the facade registry.",
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

async function runFacade(
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
    case "runbook":
      return runRunbook(input, env, signal);
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
    hint: "Call d360 action='examples' with an operation or runbook name, then execute or runbook.",
  };
}

function runExamples(input: D360FacadeInput): Record<string, unknown> {
  const name = input.operation ?? input.runbook;
  if (!name) {
    return {
      ok: true,
      action: "examples",
      summary: "Available facade examples",
      operations: D360_OPERATIONS.map((op) => op.name),
      runbooks: D360_RUNBOOKS.map((runbook) => runbook.name),
      examples: Object.keys(D360_EXAMPLES),
    };
  }

  const operation = findOperation(name);
  const runbook = findRunbook(name);
  return {
    ok: Boolean(operation || runbook),
    action: "examples",
    summary: operation || runbook ? `Example for ${name}` : `Unknown facade item ${name}`,
    operation,
    runbook,
    example: D360_EXAMPLES[name] ?? null,
    hint: operation || runbook ? undefined : "Use d360 action='search' to discover names.",
  };
}

async function runExecute(
  input: D360FacadeInput,
  env: SfEnvironment,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const operationName = requiredName(input.operation, "operation");
  const operation = findOperation(operationName);
  if (!operation)
    throw new Error(`Unknown Data 360 operation '${operationName}'. Use d360 search first.`);

  const { targetOrg, apiVersion } = await resolveTargetOrgContext(input.target_org, env);
  if (!targetOrg) throw new Error("No Salesforce target org is configured.");
  const params = input.params ?? {};
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
      request: { method: operation.method, path: apiPath, body: body ?? null },
      summary: `Resolved ${operation.name}`,
    };
  }

  await enforceOperationSafety(ctx, operation);
  if (signal?.aborted) throw new Error("d360 execute cancelled before request.");
  const conn = await connFromAlias(targetOrg);
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
    operation: operation.name,
    status: resp.status,
    response: resp.body,
    summary: `${operation.name} HTTP ${resp.status}`,
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
  if (operation.name === "d360_query_sql") {
    return { sql: params.sql };
  }
  return params.body ?? {};
}

async function enforceOperationSafety(
  ctx: ExtensionContext,
  operation: D360Operation,
): Promise<void> {
  if (operation.safety === "read" || operation.safety === "safe_post") return;
  if (!ctx.hasUI)
    throw new Error(`Blocked ${operation.safety} operation ${operation.name} in headless mode.`);
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
  sfPi.renderHints = { profile: "balanced", collapsedLines: 8, expandedMaxLines: 40 };

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
