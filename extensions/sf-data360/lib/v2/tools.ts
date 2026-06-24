/* SPDX-License-Identifier: Apache-2.0 */
/** Pi tool registration for the Data 360 v2 family surface. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { buildExecFn } from "../../../../lib/common/exec-adapter.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../../../lib/common/sf-environment/shared-runtime.ts";
import type { SfEnvironment } from "../../../../lib/common/sf-environment/types.ts";
import type { D360OutputMode } from "../truncation.ts";
import { readEffectiveData360Settings } from "../settings.ts";
import { runData360V2Action, type Data360ProgressEvent } from "./dispatcher.ts";
import { presentData360Result } from "./result-presenter.ts";
import { renderData360V2Call, renderData360V2Result } from "./render.ts";
import type { Data360V2Input, Data360V2ToolName } from "./action-types.ts";

const OutputMode = StringEnum(["inline", "summary", "file_only"] as const, {
  description: "How to return broad responses.",
});

const Params = Type.Object({
  action: Type.String({
    description:
      "Family action, e.g. actions.search, action.describe, stream.create_ingest_api, or sql.verify_rows.",
  }),
  params: Type.Optional(
    Type.Record(Type.String(), Type.Any(), { description: "Action parameters." }),
  ),
  target_org: Type.Optional(
    Type.String({ description: "Salesforce org alias or username. Defaults to active sf-pi org." }),
  ),
  dry_run: Type.Optional(Type.Boolean({ description: "Resolve the action without mutating." })),
  allow_confirmed: Type.Optional(
    Type.Boolean({ description: "Allow confirmed/destructive execution after dry-run review." }),
  ),
  timeout_ms: Type.Optional(Type.Number({ description: "Optional request timeout in ms." })),
  output_mode: Type.Optional(OutputMode),
});

interface Data360ToolDef {
  name: Data360V2ToolName;
  label: string;
  description: string;
  guidelines: string[];
}

export const DATA360_V2_TOOL_DEFS: Data360ToolDef[] = [
  {
    name: "data360_discover",
    label: "Data 360 discover",
    description:
      "Discover Data 360 readiness, action catalog entries, examples, and routing guidance.",
    guidelines: [
      "Use actions.search and action.describe when the right Data 360 family action is unclear.",
      "Use readiness.probe before workflows when org readiness is uncertain.",
    ],
  },
  {
    name: "data360_connect",
    label: "Data 360 connect",
    description:
      "Manage source connectivity: connectors, connections, endpoints, source schemas, and auth preflight.",
    guidelines: [
      "Use source_schema.test before source_schema.put for Ingestion API schemas.",
      "Use connection.test before connection.create when connector metadata requires credentials.",
    ],
  },
  {
    name: "data360_prepare",
    label: "Data 360 prepare",
    description:
      "Prepare raw data: dataspaces, DLOs, data streams, ingest jobs, transforms, and DataKits.",
    guidelines: [
      "Use stream.create_ingest_api for Ingestion API streams after source schema upload.",
      "Use dry_run before confirmed stream, transform, DataKit, or ingest-job actions.",
    ],
  },
  {
    name: "data360_harmonize",
    label: "Data 360 harmonize",
    description:
      "Model, map, and unify data with DMOs, mappings, standard mappings, smart helpers, and identity resolution.",
    guidelines: [
      "Inspect DLO and DMO fields before mapping.",
      "Use smart mapping helpers before hand-building broad mappings.",
    ],
  },
  {
    name: "data360_segment",
    label: "Data 360 segment",
    description: "Build calculated insights and audience segments, then publish or inspect status.",
    guidelines: [
      "Validate calculated insights before create.",
      "Check CI and segment status before downstream activation.",
    ],
  },
  {
    name: "data360_activate",
    label: "Data 360 activate",
    description:
      "Deliver downstream with activations, activation targets, data actions, and action targets.",
    guidelines: ["Create or inspect targets before creating activations or data actions."],
  },
  {
    name: "data360_query",
    label: "Data 360 query",
    description:
      "Run SQL, metadata search, profile queries, data graph reads, row counts, samples, and verification.",
    guidelines: ["Prefer sql.count, sql.sample, or sql.verify_rows before broad row queries."],
  },
  {
    name: "data360_semantic",
    label: "Data 360 semantic",
    description:
      "Manage semantic models, semantic objects, metrics, search indexes, and retrievers.",
    guidelines: [
      "Use action.describe for semantic subresources; this family is intentionally broad.",
    ],
  },
  {
    name: "data360_observe",
    label: "Data 360 observe",
    description:
      "Analyze Agentforce STDM sessions, platform tracing spans, trace trees, errors, and latency.",
    guidelines: [
      "Use observe actions for production behavior; use sf-agentscript for local .agent development.",
    ],
  },
  {
    name: "data360_orchestrate",
    label: "Data 360 orchestrate",
    description: "Plan and run journeys, manifests, cross-phase workflows, sweeps, and cleanup.",
    guidelines: [
      "Mutating journeys are plan-first: run *.plan, review steps, then run with explicit confirmation.",
    ],
  },
  {
    name: "data360_api",
    label: "Data 360 API",
    description:
      "Raw Data 360 REST escape hatch for endpoints not yet promoted to a family action.",
    guidelines: [
      "Prefer family actions for repeated workflows; use data360_api only when you know the raw endpoint.",
    ],
  },
];

const LOCAL_ACTION_ENV: SfEnvironment = {
  cli: { installed: false },
  project: { detected: false, sourceApiVersion: "67.0" },
  config: { hasTargetOrg: false },
  org: { detected: false, orgType: "unknown", apiVersion: "67.0" },
  detectedAt: 0,
};

const ENV_FREE_ACTIONS = new Set([
  "help",
  "actions.list",
  "actions.search",
  "action.describe",
  "examples.get",
]);
const ENV_FREE_DISCOVER_ACTIONS = new Set(["catalog.search", "catalog.action"]);

function inputRequiresEnvironment(input: Data360V2Input): boolean {
  if (ENV_FREE_ACTIONS.has(input.action)) return false;
  if (input.tool === "data360_discover" && ENV_FREE_DISCOVER_ACTIONS.has(input.action)) {
    return false;
  }
  return true;
}

export function registerData360V2Tools(pi: ExtensionAPI): void {
  const exec = buildExecFn(pi);
  for (const tool of DATA360_V2_TOOL_DEFS) {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      promptSnippet: tool.description,
      promptGuidelines: tool.guidelines,
      parameters: Params,
      renderCall: (args, theme) =>
        renderData360V2Call(tool.name, args as Record<string, unknown>, theme),
      renderResult: renderData360V2Result,
      async execute(_toolCallId, params, signal, onUpdate, ctx) {
        const settings = readEffectiveData360Settings(ctx.cwd);
        const input = { ...(params as Omit<Data360V2Input, "tool">), tool: tool.name };
        const env = inputRequiresEnvironment(input)
          ? await resolveEnvironment(exec, ctx.cwd)
          : LOCAL_ACTION_ENV;
        const result = await runData360V2Action(input, env, ctx, signal, (event) =>
          emitProgressUpdate(event, onUpdate),
        );
        return buildToolResult(input, result, input.output_mode ?? settings.defaultOutputMode);
      },
    });
  }
}

type ToolOnUpdate = (partial: {
  content: Array<{ type: "text"; text: string }>;
  details: never;
}) => void;

function emitProgressUpdate(event: Data360ProgressEvent, onUpdate: unknown): void {
  if (typeof onUpdate !== "function") return;
  const glyph = event.status === "error" ? "❌" : event.status === "warning" ? "⚠️" : "☁️";
  (onUpdate as ToolOnUpdate)({
    content: [
      {
        type: "text",
        text: `${glyph} Data 360 ${event.stage}: ${event.message}`,
      },
    ],
    details: undefined as never,
  });
}

async function resolveEnvironment(
  exec: ReturnType<typeof buildExecFn>,
  cwd: string,
): Promise<SfEnvironment> {
  return getCachedSfEnvironment(cwd) ?? (await getSharedSfEnvironment(exec, cwd));
}

async function buildToolResult(
  input: Data360V2Input,
  result: Record<string, unknown>,
  outputMode: D360OutputMode,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
  return presentData360Result(input, result, outputMode);
}
