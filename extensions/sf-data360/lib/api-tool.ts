/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";

import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../../lib/common/sf-environment/shared-runtime.ts";
import type { OrgType, SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { buildApiPath, type QueryParams } from "./path.ts";
import { D360_OUTPUT_SUFFIX, formatD360Output, type D360OutputMode } from "./truncation.ts";
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
        "If true, only show the resolved sf api request rest command, target org, API path, and safety decision; do not call Salesforce.",
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
      "Call Salesforce Data 360 REST APIs through sf api request rest using the active sf CLI auth context." +
      D360_OUTPUT_SUFFIX,
    promptSnippet: "Call Salesforce Data 360 REST endpoints safely via sf api request rest",
    promptGuidelines: [
      "Use d360_api for Data Cloud/Data 360 REST endpoints instead of hand-rolled curl.",
      "Use d360_api dry_run:true before mutating Data 360 create, update, run, publish, deploy, undeploy, or delete calls.",
      "Use /ssot/metadata-entities?entityType=DataModelObject for concise DMO lists; do not call /ssot/data-model-objects broadly unless full DMO definitions or fields are explicitly needed.",
      "Before querying DMO records, inspect the selected DMO with GET /ssot/data-model-objects/{dmoApiName}, then run COUNT(*) before sampling rows.",
      "Keep Data 360 result sets small; for broad/list responses use output_mode:'summary' or output_mode:'file_only' instead of pasting full nested payloads.",
      "Before complex Data 360 create/update calls, read the sf-data360 skill references for payload examples.",
    ],
    parameters: D360ApiParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const input = params as D360ApiInput;
      const env = await resolveEnvironment(exec, ctx);
      const resolved = resolveRequest(input, env);

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

      const args = buildSfApiRequestArgs(resolved, input.body);
      const result = await pi.exec("sf", args, {
        signal,
        timeout: typeof input.timeout_ms === "number" ? input.timeout_ms : 120_000,
      });

      const output = result.stdout.trim() || result.stderr.trim() || "{}";
      const ok = result.code === 0 && !responseLooksLikeError(output);
      return buildResult(output, input.output_mode ?? "inline", {
        ok,
        action: "call",
        exitCode: result.code,
        stderr: result.stderr,
        resolved,
      });
    },
  });
}

async function resolveEnvironment(
  exec: ReturnType<typeof buildExecFn>,
  ctx: ExtensionContext,
): Promise<SfEnvironment> {
  return getCachedSfEnvironment(ctx.cwd) ?? (await getSharedSfEnvironment(exec, ctx.cwd));
}

export function resolveRequest(input: D360ApiInput, env: SfEnvironment): ResolvedRequest {
  const method = normalizeMethod(input.method);
  const apiVersion = env.org.apiVersion ?? env.project.sourceApiVersion ?? "66.0";
  const apiPath = buildApiPath(input.path, apiVersion, input.query);
  const targetOrg = normalizeTargetOrg(input.target_org, env);
  const orgType = resolveOrgType(targetOrg, env);
  const safety = classifyD360Request(method, input.path, orgType);

  return { method, apiPath, targetOrg, apiVersion, orgType, safety };
}

function normalizeTargetOrg(targetOrg: string | undefined, env: SfEnvironment): string | undefined {
  const explicit = targetOrg?.trim();
  if (explicit) return explicit;
  return env.config.targetOrg ?? env.org.alias ?? env.org.username;
}

function resolveOrgType(targetOrg: string | undefined, env: SfEnvironment): OrgType | "unknown" {
  if (!targetOrg) return "unknown";
  if (
    targetOrg === env.config.targetOrg ||
    targetOrg === env.org.alias ||
    targetOrg === env.org.username
  ) {
    return env.org.orgType;
  }
  // Do not run a second org display from the hot tool path. Unknown aliases fail
  // closed in the safety classifier.
  return "unknown";
}

function buildSfApiRequestArgs(resolved: ResolvedRequest, body: unknown): string[] {
  if (!resolved.targetOrg) {
    throw new Error(
      "No Salesforce target org is configured. Pass target_org or set sf config target-org.",
    );
  }

  const args = [
    "api",
    "request",
    "rest",
    resolved.apiPath,
    "--method",
    resolved.method,
    "--target-org",
    resolved.targetOrg,
    "--header",
    "Accept: application/json",
  ];
  if (body !== undefined && resolved.method !== "GET" && resolved.method !== "DELETE") {
    args.push("--header", "Content-Type: application/json", "--body", JSON.stringify(body));
  }
  return args;
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
    const parsed = JSON.parse(text) as { error?: unknown; errors?: unknown };
    if (parsed && typeof parsed === "object") {
      if (parsed.error) return true;
      if (Array.isArray(parsed.errors) && parsed.errors.length > 0) return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function buildResult(
  text: string,
  outputMode: D360OutputMode | undefined,
  details: Record<string, unknown>,
) {
  const formatted = await formatD360Output(text, outputMode ?? "inline");
  return {
    content: [{ type: "text" as const, text: formatted.text }],
    details: {
      ...details,
      outputMode: formatted.outputMode ?? outputMode ?? "inline",
      ...(formatted.truncation ? { truncation: formatted.truncation } : {}),
      ...(formatted.fullOutputPath ? { fullOutputPath: formatted.fullOutputPath } : {}),
    },
  };
}
