/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../../lib/common/sf-environment/shared-runtime.ts";
import type { OrgInfo, OrgType, SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { connFromAlias } from "../../../lib/common/sf-conn/connection.ts";
import { connRequest } from "../../../lib/common/sf-conn/request.ts";
import { buildApiPath, type QueryParams } from "./path.ts";
import { apiResultToCard } from "./display/api-card.ts";
import { renderD360ApiCall, renderD360ApiResult } from "./display/render.ts";
import {
  normalizeTargetOrg,
  resolveApiVersion,
  resolveExplicitTargetOrg,
  resolveOrgType,
} from "./target-org.ts";
import {
  buildD360Envelope,
  D360_OUTPUT_SUFFIX,
  formatD360Output,
  type D360OutputMode,
} from "./truncation.ts";
import {
  classifyD360Request,
  normalizeMethod,
  type D360Method,
  type D360SafetyDecision,
} from "./safety.ts";

export const D360_TOOL_NAME = "d360_api";
export const HEADLESS_WRITE_ENV = "SF_D360_ALLOW_HEADLESS_WRITE";

export const D360ApiParams = Type.Object({
  method: StringEnum(["GET", "POST", "PATCH", "PUT", "DELETE"] as const, {
    description: "HTTP method for the Salesforce Data 360 REST endpoint.",
  }),
  path: Type.String({
    description:
      "Path relative to /services/data/vXX.X, e.g. /ssot/data-model-objects or /connect/search/metadata/results. A supplied /services/data/vNN.N prefix is normalized to the active org API version.",
  }),
  query: Type.Optional(
    Type.Record(Type.String(), Type.Any(), {
      description: "Query string parameters. Array values are repeated.",
    }),
  ),
  body: Type.Optional(
    Type.Any({
      description: "JSON request body for POST, PATCH, or PUT calls.",
    }),
  ),
  target_org: Type.Optional(
    Type.String({
      description:
        "Salesforce org alias or username. Defaults to the active sf-pi target org when available.",
    }),
  ),
  dry_run: Type.Optional(
    Type.Boolean({
      description:
        "If true, only show the resolved REST request, target org, API path, and safety decision; do not call Salesforce.",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({
      description: "Optional command timeout in milliseconds. Defaults to 120000.",
    }),
  ),
  output_mode: Type.Optional(
    StringEnum(["inline", "summary", "file_only"] as const, {
      description:
        "How to return the response. inline truncates large output, summary saves full JSON and returns a shape summary, file_only saves full JSON and returns only the file path.",
    }),
  ),
});

export interface D360ApiInput {
  method: string;
  path: string;
  query?: QueryParams;
  body?: unknown;
  target_org?: string;
  dry_run?: boolean;
  timeout_ms?: number;
  output_mode?: D360OutputMode;
}

interface ResolvedRequest {
  method: D360Method;
  apiPath: string;
  targetOrg?: string;
  apiVersion: string;
  orgType: OrgType | "unknown";
  safety: D360SafetyDecision;
}

export function registerD360ApiTool(pi: ExtensionAPI): void {
  const exec = buildExecFn(pi);

  pi.registerTool({
    name: D360_TOOL_NAME,
    label: "Data 360 API",
    description:
      "Call Salesforce Data 360 REST APIs through the active sf CLI auth context (via @salesforce/core Connection)." +
      D360_OUTPUT_SUFFIX,
    promptSnippet: "Call Salesforce Data 360 REST endpoints safely via @salesforce/core Connection",
    promptGuidelines: [
      "Use d360_api for Data Cloud/Data 360 REST endpoints instead of hand-rolled curl.",
      "Pass target_org explicitly when the intended Data 360 org is not the active sf-pi default org.",
      "Use d360_api dry_run:true before mutating Data 360 create, update, run, publish, deploy, undeploy, or delete calls.",
      "Use /ssot/metadata-entities?entityType=DataModelObject for concise DMO lists; do not call /ssot/data-model-objects broadly unless full DMO definitions or fields are explicitly needed.",
      "Before querying DMO records, inspect the selected DMO with GET /ssot/data-model-objects/{dmoApiName}, then run COUNT(*) before sampling rows.",
      "Keep Data 360 result sets small; for broad/list responses use output_mode:'summary' or output_mode:'file_only' instead of pasting full nested payloads.",
      "Before complex Data 360 create/update calls, read extensions/sf-data360/references/ for payload examples.",
    ],
    parameters: D360ApiParams,
    renderCall: renderD360ApiCall,
    renderResult: renderD360ApiResult,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const input = params as D360ApiInput;
      const env = await resolveEnvironment(exec, ctx);
      const resolved = await resolveRequestForExecution(input, env);

      if (input.dry_run) {
        return buildResult(
          JSON.stringify(
            {
              dryRun: true,
              method: resolved.method,
              path: resolved.apiPath,
              targetOrg: resolved.targetOrg,
              apiVersion: resolved.apiVersion,
              orgType: resolved.orgType,
              safety: resolved.safety,
              body: input.body ?? null,
            },
            null,
            2,
          ),
          "inline",
          { ok: true, action: "dry_run", resolved },
        );
      }

      await enforceSafety(ctx, resolved);

      const { text, status, ok } = await callD360Rest(resolved, input, signal);
      return buildResult(text, input.output_mode ?? "inline", {
        ok,
        action: "call",
        status,
        resolved,
        requestBody: input.body ?? null,
      });
    },
  });
}

/**
 * Issue the Data 360 REST call via @salesforce/core Connection.
 *
 * Replaces the prior `sf api request rest` subprocess path. Auth comes from
 * the same auth files the sf CLI writes — no second login, automatic token
 * refresh, ~30× lower per-call latency than shelling. HTTP errors surface
 * as data via `connRequest` so the caller can keep the existing
 * ok/text/status envelope without try/catch sprawl.
 */
async function callD360Rest(
  resolved: ResolvedRequest,
  input: D360ApiInput,
  signal: AbortSignal | undefined,
): Promise<{ text: string; status: number; ok: boolean }> {
  if (!resolved.targetOrg) {
    throw new Error(
      "No Salesforce target org is configured. Pass target_org or set sf config target-org.",
    );
  }
  if (signal?.aborted) {
    throw new Error("d360_api call cancelled before request.");
  }

  const conn = await connFromAlias(resolved.targetOrg);
  // Some sf CLI versions errored on DELETE without an explicit body; the
  // REST endpoint itself accepts an empty body. Preserve the prior shape
  // by sending `{}` for DELETE when the caller didn't pass one.
  const body =
    resolved.method === "GET"
      ? undefined
      : (input.body ?? (resolved.method === "DELETE" ? {} : undefined));

  const resp = await connRequest<unknown>(conn, {
    method: resolved.method,
    url: resolved.apiPath,
    body,
    timeoutMs: typeof input.timeout_ms === "number" ? input.timeout_ms : 120_000,
  });

  const text = stringifyResponseBody(resp.body);
  const ok = resp.status >= 200 && resp.status < 300 && !responseLooksLikeError(text);
  return { text, status: resp.status, ok };
}

function stringifyResponseBody(body: unknown): string {
  if (typeof body === "string") return body;
  if (body === undefined || body === null) return "";
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

async function resolveEnvironment(
  exec: ReturnType<typeof buildExecFn>,
  ctx: ExtensionContext,
): Promise<SfEnvironment> {
  return getCachedSfEnvironment(ctx.cwd) ?? (await getSharedSfEnvironment(exec, ctx.cwd));
}

export async function resolveRequestForExecution(
  input: D360ApiInput,
  env: SfEnvironment,
): Promise<ResolvedRequest> {
  const targetOrg = normalizeTargetOrg(input.target_org, env);
  const targetOrgInfo = await resolveExplicitTargetOrg(targetOrg, env);
  return resolveRequest(input, env, targetOrgInfo);
}

export function resolveRequest(
  input: D360ApiInput,
  env: SfEnvironment,
  targetOrgInfo?: OrgInfo,
): ResolvedRequest {
  const method = normalizeMethod(input.method);
  const targetOrg = normalizeTargetOrg(input.target_org, env);
  const resolvedTargetOrgInfo = targetOrgInfo?.detected ? targetOrgInfo : undefined;
  const apiVersion = resolveApiVersion(env, resolvedTargetOrgInfo);
  const apiPath = buildApiPath(input.path, apiVersion, input.query);
  const orgType = resolveOrgType(targetOrg, env, resolvedTargetOrgInfo);
  const safety = classifyD360Request(method, input.path, orgType);

  return { method, apiPath, targetOrg, apiVersion, orgType, safety };
}

async function enforceSafety(ctx: ExtensionContext, resolved: ResolvedRequest): Promise<void> {
  if (!resolved.safety.requiresConfirmation) return;

  const detail = [
    `Method: ${resolved.method}`,
    `Path: ${resolved.apiPath}`,
    `Target org: ${resolved.targetOrg ?? "(none)"}`,
    `Org type: ${resolved.orgType}`,
    `Safety: ${resolved.safety.level}`,
    `Reason: ${resolved.safety.reason}`,
  ].join("\n");

  if (!ctx.hasUI) {
    const allowed = process.env[HEADLESS_WRITE_ENV];
    if (allowed && allowed !== "0" && allowed.toLowerCase() !== "false") return;
    throw new Error(
      `Blocked d360_api call in headless mode. Set ${HEADLESS_WRITE_ENV}=1 to allow.\n\n${detail}`,
    );
  }

  const choice = await ctx.ui.select(
    `Confirm Data 360 ${resolved.safety.level} call\n\n${detail}`,
    ["Allow once", "Block"],
    { timeout: 30_000, signal: ctx.signal },
  );

  if (choice !== "Allow once") {
    throw new Error("Blocked by user via d360_api confirmation.");
  }
}

export function responseLooksLikeError(text: string): boolean {
  try {
    return parsedValueLooksLikeError(JSON.parse(text));
  } catch {
    return false;
  }
}

function parsedValueLooksLikeError(parsed: unknown): boolean {
  if (Array.isArray(parsed)) return parsed.some(parsedValueLooksLikeError);
  if (!parsed || typeof parsed !== "object") return false;

  const obj = parsed as Record<string, unknown>;
  if (obj.error) return true;
  if (Array.isArray(obj.errors) && obj.errors.length > 0) return true;
  if (typeof obj.errorCode === "string" && obj.errorCode) return true;
  return typeof obj.message === "string" && typeof obj.code === "string";
}

async function buildResult(
  text: string,
  outputMode: D360OutputMode | undefined,
  details: Record<string, unknown>,
) {
  const formatted = await formatD360Output(text, outputMode ?? "inline");
  const ok = details.ok !== false;
  const resolved = details.resolved as ResolvedRequest | undefined;
  const card = apiResultToCard(text, {
    method: resolved?.method,
    path: resolved?.apiPath,
    targetOrg: resolved?.targetOrg,
    apiVersion: resolved?.apiVersion,
    orgType: resolved?.orgType,
    safety: resolved?.safety.level,
    status: typeof details.status === "number" ? details.status : undefined,
    ok,
    action: typeof details.action === "string" ? details.action : undefined,
    requestBody: details.requestBody,
    fullOutputPath: formatted.fullOutputPath,
  });
  const sfPi = buildD360Envelope(D360_TOOL_NAME, ok, text, details, formatted);
  sfPi.data = { card };
  sfPi.renderHints = { profile: "balanced", collapsedLines: 48, expandedMaxLines: 120 };
  return {
    content: [{ type: "text" as const, text: formatted.text }],
    details: {
      ...details,
      card,
      outputMode: formatted.outputMode ?? outputMode ?? "inline",
      ...(formatted.truncation ? { truncation: formatted.truncation } : {}),
      ...(formatted.fullOutputPath ? { fullOutputPath: formatted.fullOutputPath } : {}),
      // Standard SF Pi tool-result envelope for renderers + downstream tooling.
      // See `lib/common/display/types.ts` and `lib/common/display/diagnostics.ts`.
      sfPi,
    },
  };
}
