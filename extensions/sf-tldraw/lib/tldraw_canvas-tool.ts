/* SPDX-License-Identifier: Apache-2.0 */
/** The single tldraw Canvas API family tool. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { closeSync, constants as fsConstants, fstatSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTldrawStatus } from "../../../lib/common/tldraw-status/store.ts";
import { renderSalesforceDiagram } from "./renderer.ts";
import { sanitizeRuntimeText } from "./redaction.ts";
import { readEffectiveTldrawPreferences } from "./settings.ts";
import { TldrawRuntimeClient, TldrawRuntimeError } from "./runtime-client.ts";
import { formatTldrawDocuments, formatTldrawRuntimeStatus } from "./runtime-surface.ts";
import type {
  DiagramFamily,
  OutputMode,
  RenderMode,
  TldrawAction,
  TldrawPreferences,
} from "./types.ts";

export const TLDRAW_CANVAS_TOOL_NAME = "tldraw_canvas";
export const TLDRAW_CANVAS_DETAILS_KEY = "sfTldraw";

const Params = Type.Object(
  {
    action: StringEnum(
      [
        "status",
        "documents",
        "create_document",
        "cheatsheet",
        "render_salesforce_data_model",
        "render_salesforce_architecture",
        "render_salesforce_sequence",
      ] as const,
      { description: "tldraw Canvas action." },
    ),
    document_id: Type.Optional(
      Type.String({
        description:
          "Opaque id returned by action='documents' or action='create_document'. Omit to use the focused open document.",
      }),
    ),
    name: Type.Optional(
      Type.String({
        description:
          "Required for action='create_document'. Plain file name; tldraw saves it in the Documents directory.",
      }),
    ),
    spec: Type.Optional(
      Type.Record(Type.String(), Type.Any(), {
        description:
          "Salesforce Diagram Spec v2 object. Validation happens at execute. Call action='cheatsheet' before the first render if you do not already have a valid spec.",
      }),
    ),
    page_name: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 100,
        description:
          "Public-safe page name. Existing pages are reconciled; missing pages are created in the open document.",
      }),
    ),
    render_mode: Type.Optional(
      StringEnum(["preserve", "relayout", "replace"] as const, {
        description: "Preserve human positions by default; relayout and replace are explicit.",
      }),
    ),
    cardinality_detail: Type.Optional(StringEnum(["simplified", "full"] as const)),
    card_fill: Type.Optional(
      StringEnum(["transparent", "family"] as const, {
        description:
          "Data-model card interior. Defaults to the transparent (white) card from settings.",
      }),
    ),
    ldv_threshold: Type.Optional(StringEnum(["1M", "2M", "5M", "10M"] as const)),
    record_type_mode: Type.Optional(StringEnum(["off", "auto", "always"] as const)),
    legend_relationships: Type.Optional(
      StringEnum(["show", "hide"] as const, {
        description:
          "Show or hide the separate stacked Relationships legend on Data Model diagrams.",
      }),
    ),
    output_mode: Type.Optional(
      StringEnum(["summary", "inline", "file_only"] as const, {
        description:
          "summary returns compact text + thumbnail; inline adds bounded readiness/evidence detail; file_only returns artifact references without image content.",
      }),
    ),
  },
  { additionalProperties: false },
);

type ToolContent =
  { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

type Input = {
  action: TldrawAction;
  document_id?: string;
  name?: string;
  spec?: unknown;
  page_name?: string;
  render_mode?: RenderMode;
  cardinality_detail?: TldrawPreferences["cardinalityDetail"];
  card_fill?: TldrawPreferences["cardFill"];
  ldv_threshold?: TldrawPreferences["ldvThreshold"];
  record_type_mode?: TldrawPreferences["recordTypeMode"];
  legend_relationships?: TldrawPreferences["legendRelationships"];
  output_mode?: OutputMode;
};

export function registerTldrawCanvasTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof Params>({
    name: TLDRAW_CANVAS_TOOL_NAME,
    label: "tldraw Canvas",
    description:
      "Inspect the local tldraw runtime and deterministically render grounded Salesforce data-model, architecture, and sequence diagrams. Use the upstream tldraw-offline skill for generic canvas work.",
    promptSnippet: "Render editable, deterministic Salesforce diagrams in a local tldraw canvas.",
    promptGuidelines: [
      "Every Salesforce diagram element must use strict spec_version='2.0' grounding and declared evidence; never infer or fabricate Salesforce facts.",
      "Call action='cheatsheet' before the first render if you do not already have a valid Spec v2 object.",
      "A render is complete only when readiness is true, canvas lints/decorations pass, and screenshot evidence exists; never fall back to OS automation or direct archive generation.",
      "Read extensions/sf-tldraw/AGENT_GUIDE.md for document selection, preserve/relayout semantics, and completion criteria.",
    ],
    parameters: Params,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = params as Input;
      const client = new TldrawRuntimeClient();
      onUpdate?.({ content: [{ type: "text", text: progressMessage(input.action) }], details: {} });
      try {
        if (input.action === "status") {
          const observation = await client.observe(signal);
          setTldrawStatus({ ...observation.status, origin: "interaction" });
          return ok(input.action, formatTldrawRuntimeStatus(observation.status), {
            status: observation.status,
          });
        }
        if (input.action === "cheatsheet") {
          const text = readFileSync(
            path.join(import.meta.dirname, "..", "docs", "cheatsheet.md"),
            "utf8",
          );
          return ok(input.action, text, { lazy: true });
        }
        if (input.action === "documents") {
          const observation = await client.observe(signal);
          setTldrawStatus({ ...observation.status, origin: "interaction" });
          return ok(input.action, formatTldrawDocuments(observation.documents), {
            documents: observation.documents,
            capabilities: observation.status.capabilities,
            skillReadiness: observation.status.skillReadiness,
          });
        }
        if (input.action === "create_document") {
          if (!input.name?.trim())
            return fail(
              input.action,
              "name is required for action='create_document'.",
              "missing_name",
            );
          const document = await client.createDocument(input.name, signal);
          setTldrawStatus({
            kind: "ready",
            origin: "interaction",
            focusedDocumentName: document.name,
            skillReadiness: client.skillReadiness(),
          });
          return ok(
            input.action,
            [
              "Created tldraw document.",
              `Name: ${document.name}`,
              `Document id: ${document.id}`,
              "Location: Documents",
              "Next: pass this document id to a Salesforce render action.",
            ].join("\n"),
            { document },
          );
        }
        if (isRenderAction(input.action)) {
          const family = familyForAction(input.action);
          const outcome = await renderSalesforceDiagram(
            {
              family,
              spec: input.spec,
              documentId: input.document_id,
              pageName: input.page_name,
              mode: input.render_mode,
              outputMode: input.output_mode,
              preferences: {
                ...(input.cardinality_detail
                  ? { cardinalityDetail: input.cardinality_detail }
                  : {}),
                ...(input.card_fill ? { cardFill: input.card_fill } : {}),
                ...(input.ldv_threshold ? { ldvThreshold: input.ldv_threshold } : {}),
                ...(input.record_type_mode ? { recordTypeMode: input.record_type_mode } : {}),
                ...(input.legend_relationships
                  ? { legendRelationships: input.legend_relationships }
                  : {}),
              },
            },
            { cwd: ctx.cwd, signal, client },
          );
          if (outcome.ok === false) {
            return fail(input.action, outcome.message, outcome.reason, {
              validation: outcome.validation,
              readiness: outcome.result?.readiness,
              recover_via: outcome.recoverVia,
            });
          }
          return {
            content: renderSuccessContent(outcome),
            details: {
              [TLDRAW_CANVAS_DETAILS_KEY]: {
                ok: true,
                action: input.action,
                result: outcome.result,
                artifact: outcome.artifact,
              },
            },
          };
        }
        return fail(
          input.action,
          `Unsupported tldraw_canvas action '${input.action}'.`,
          "unsupported_action",
        );
      } catch (error) {
        if (error instanceof TldrawRuntimeError) {
          return fail(input.action, error.message, error.code, {
            recover_via: runtimeRecovery(error.code),
          });
        }
        return fail(
          input.action,
          `tldraw_canvas failed: ${sanitizeRuntimeText(error instanceof Error ? error.message : String(error)).slice(0, 500)}`,
          "unexpected_error",
        );
      }
    },
  });
}

function isRenderAction(action: TldrawAction): boolean {
  return action.startsWith("render_salesforce_");
}

function familyForAction(action: TldrawAction): DiagramFamily {
  if (action === "render_salesforce_data_model") return "data_model";
  if (action === "render_salesforce_architecture") return "architecture";
  return "sequence";
}

function progressMessage(action: TldrawAction): string {
  return action.startsWith("render_")
    ? `Validating and rendering ${action.replace("render_salesforce_", "").replaceAll("_", " ")}…`
    : `Running tldraw Canvas action: ${action}…`;
}

type RenderSuccessOutcome = Extract<
  Awaited<ReturnType<typeof renderSalesforceDiagram>>,
  { ok: true }
>;

export function renderSuccessContent(outcome: RenderSuccessOutcome): ToolContent[] {
  const content: ToolContent[] = [{ type: "text", text: formatRenderSuccess(outcome) }];
  if (outcome.outputMode !== "file_only" && outcome.artifact.thumbnailPath) {
    const image = imageContent(outcome.artifact.thumbnailPath);
    if (image) content.push(image);
  }
  return content;
}

export function formatRenderSuccess(outcome: RenderSuccessOutcome): string {
  const { result, artifact } = outcome;
  const artifacts = [
    `Report: ${artifact.reportPath}`,
    `Full image: ${artifact.screenshotPath ?? "not written"}`,
    `Thumbnail: ${artifact.thumbnailPath ?? "not written"}`,
  ];
  if (outcome.outputMode === "file_only") {
    return [
      `Rendered Salesforce ${result.family.replaceAll("_", " ")} diagram.`,
      `Document: ${result.documentId} · Page: ${result.pageName}`,
      ...artifacts,
    ].join("\n");
  }

  const warnings = result.readiness.warnings.slice(0, 8);
  const summary = [
    `Rendered Salesforce ${result.family.replaceAll("_", " ")} diagram.`,
    `Document: ${result.documentId}`,
    `Page: ${result.pageName}`,
    `Shapes: ${result.createdShapes} created · ${result.updatedShapes} updated · ${result.deletedShapes} removed`,
    `Readiness: ready · lints=${result.readiness.lintCount} · marker checks=${result.readiness.markerChecks.length}`,
    warnings.length ? `Warnings: ${warnings.join(" | ")}` : "Warnings: none",
    ...artifacts,
  ];
  if (outcome.outputMode !== "inline") return clip(summary.join("\n"), 6_000);

  const readiness = result.readiness;
  const sources = outcome.spec.grounding.sources.slice(0, 8);
  const inline = [
    ...summary,
    "",
    "Inline readiness details:",
    `- Bindings: ${readiness.bindingChecks.filter((check) => check.valid).length}/${readiness.bindingChecks.length} valid`,
    `- Sequence geometry checks: ${readiness.sequenceGeometryChecks.length}`,
    `- Typography checks: ${readiness.typographyChecks.length}`,
    `- Card-content checks: ${readiness.cardContentChecks?.length ?? 0}`,
    `- Route obstructions: ${readiness.routeChecks?.length ?? 0}`,
    `- Route crossings: ${readiness.routeCrossingChecks?.length ?? 0}`,
    `- Shared corridors: ${readiness.sharedCorridorChecks?.length ?? 0}`,
    `- Marker overlaps: ${readiness.markerOverlapChecks?.length ?? 0}`,
    "Evidence sources:",
    ...sources.map((source) => `- ${source.id} · ${source.kind} · ${source.label}`),
  ];
  return clip(inline.join("\n"), 8_000);
}

function imageContent(filePath: string): { type: "image"; data: string; mimeType: string } | null {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > 1_500_000) return null;
    const bytes = readFileSync(descriptor);
    if (bytes.length !== metadata.size) return null;
    return {
      type: "image",
      data: bytes.toString("base64"),
      mimeType: filePath.endsWith(".png") ? "image/png" : "image/jpeg",
    };
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function ok(action: TldrawAction, text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details: { [TLDRAW_CANVAS_DETAILS_KEY]: { ok: true, action, ...details } },
  };
}

function fail(
  action: TldrawAction,
  text: string,
  reason: string,
  details: Record<string, unknown> = {},
) {
  return {
    content: [{ type: "text" as const, text }],
    details: { [TLDRAW_CANVAS_DETAILS_KEY]: { ok: false, action, reason, ...details } },
  };
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const suffix = "\n…truncated";
  return `${value.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

function runtimeRecovery(code: TldrawRuntimeError["code"]): Record<string, unknown> {
  if (code === "no_open_document" || code === "not_found")
    return {
      action: "create_document",
      instruction: "Create a document, then pass its document_id to the render action.",
    };
  if (code === "conflict")
    return {
      action: "create_document",
      instruction:
        "Choose a different name, or use action='documents' to select the existing file.",
    };
  if (code === "invalid_request")
    return { action: "create_document", instruction: "Correct the document name and retry." };
  return { action: "status", command: "/sf-tldraw status" };
}

export function effectiveSettingsText(cwd: string): string {
  const settings = readEffectiveTldrawPreferences(cwd);
  return [
    `Cardinality: ${settings.cardinalityDetail}`,
    `Card fill: ${settings.cardFill}`,
    `LDV threshold: ${settings.ldvThreshold}`,
    `Record types: ${settings.recordTypeMode}`,
    `Relationship legend: ${settings.legendRelationships}`,
  ].join(" · ");
}
