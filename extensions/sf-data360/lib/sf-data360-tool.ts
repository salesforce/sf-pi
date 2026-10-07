/* SPDX-License-Identifier: Apache-2.0 */
/** Single Pi custom system tool registration for the complete Data 360 SDK surface. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../../lib/common/sf-environment/shared-runtime.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { readEffectiveData360Settings } from "./settings.ts";
import { renderSfData360Call, renderSfData360Result } from "./render.ts";
import { presentSfData360Result } from "./result.ts";
import { runSfData360Action } from "./sdk.ts";
import type { Data360ProgressEvent } from "./actions/dispatcher.ts";
import type { SfData360Input } from "./actions/action-types.ts";

export const SF_DATA360_TOOL_NAME = "sf_data360";
export const DATA360_EXECUTION_CHAIN_ENTRY_TYPE = "sf-data360-execution-chain";

const OutputSchema = Type.Object({
  outcome: Type.Object({
    action: Type.String(),
    namespace: Type.String(),
    status: Type.String(),
    summary: Type.String(),
  }),
  data: Type.Optional(Type.Any()),
  transport: Type.Optional(Type.Any()),
  artifacts: Type.Optional(Type.Array(Type.Any())),
});

const Params = Type.Object({
  action: Type.String({
    description:
      "Business action under discover, connect, prepare, harmonize, segment, activate, query, semantic, observe, orchestrate, or api.",
  }),
  params: Type.Optional(
    Type.Record(Type.String(), Type.Any(), { description: "Action parameters." }),
  ),
  target_org: Type.Optional(Type.String({ description: "Salesforce org alias or username." })),
  dry_run: Type.Optional(
    Type.Boolean({ description: "Resolve a mutating action without executing it." }),
  ),
  allow_mutation: Type.Optional(
    Type.Boolean({
      description:
        "Allow intentional mutation after dry-run review. Guardrail approval remains separate.",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({ description: "Optional bounded request timeout in milliseconds." }),
  ),
  output_mode: Type.Optional(StringEnum(["summary", "inline", "file_only"] as const)),
});

const LOCAL_ACTIONS = new Set([
  "discover.route",
  "discover.action.list",
  "discover.action.search",
  "discover.action.describe",
]);
const LOCAL_ENV: SfEnvironment = {
  cli: { installed: false },
  project: { detected: false, sourceApiVersion: "67.0" },
  config: { hasTargetOrg: false },
  org: { detected: false, orgType: "unknown", apiVersion: "67.0" },
  detectedAt: 0,
};

export function registerSfData360Tool(pi: ExtensionAPI): void {
  const exec = buildExecFn(pi);
  pi.registerTool<typeof Params>({
    name: SF_DATA360_TOOL_NAME,
    label: "SF Data 360",
    description:
      "Pi-native Data 360 SDK: discover, connect, prepare, harmonize, segment, activate, query, semantic, observe, orchestrate, and exact API actions through one tool.",
    promptSnippet:
      "Use one sf_data360 tool with business-namespaced actions for the complete Data 360 API lifecycle.",
    promptGuidelines: [
      "Use discover.* to route intent or inspect action contracts before complex calls.",
      "Use connect → prepare → harmonize → segment → activate as the Data 360 lifecycle; query, semantic, and observe inspect or augment it; orchestrate coordinates multiple phases.",
      "Use dry_run before mutations and allow_mutation=true only after review. Use api.request only for exact endpoints not yet promoted to a named action.",
    ],
    parameters: Params,
    outputSchema: OutputSchema,
    renderCall: (args, theme) => renderSfData360Call(args as SfData360Input, theme),
    renderResult: (result, options, theme) =>
      renderSfData360Result(result as never, options, theme),
    async execute(_id, rawParams, signal, onUpdate, ctx) {
      const input = rawParams as SfData360Input;
      const env = LOCAL_ACTIONS.has(input.action)
        ? LOCAL_ENV
        : await resolveEnvironment(exec, ctx.cwd);
      try {
        const result = await runSfData360Action(input, env, ctx, signal, (event) =>
          emitProgress(event, onUpdate),
        );
        appendExecutionChainAudit(pi, ctx, input, result);
        const settings = readEffectiveData360Settings(ctx.cwd);
        return presentSfData360Result(
          input,
          result,
          input.output_mode ?? settings.defaultOutputMode,
        );
      } catch (error) {
        return presentSfData360Result(
          input,
          {
            ok: false,
            tool: SF_DATA360_TOOL_NAME,
            action: input.action,
            error: error instanceof Error ? error.message : String(error),
            summary: `${input.action} failed`,
          },
          input.output_mode ?? "summary",
        );
      }
    },
  });
}

export function appendExecutionChainAudit(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: SfData360Input,
  result: Record<string, unknown>,
): void {
  const executionChain = Array.isArray(result.executionChain) ? result.executionChain : undefined;
  if (!executionChain?.length) return;
  pi.appendEntry(DATA360_EXECUTION_CHAIN_ENTRY_TYPE, {
    timestamp: Date.now(),
    sessionId: ctx.sessionManager.getSessionId(),
    parentTool: SF_DATA360_TOOL_NAME,
    parentAction: input.action,
    targetOrg: input.target_org,
    journey_fingerprint: result.journey_fingerprint,
    ok: result.ok !== false,
    executionChain,
  });
}

async function resolveEnvironment(
  exec: ReturnType<typeof buildExecFn>,
  cwd: string,
): Promise<SfEnvironment> {
  return getCachedSfEnvironment(cwd) ?? (await getSharedSfEnvironment(exec, cwd));
}

type Update = (value: { content: Array<{ type: "text"; text: string }>; details: never }) => void;
function emitProgress(event: Data360ProgressEvent, onUpdate: unknown): void {
  if (typeof onUpdate !== "function") return;
  (onUpdate as Update)({
    content: [{ type: "text", text: `☁️ Data 360 ${event.stage}: ${event.message}` }],
    details: undefined as never,
  });
}
