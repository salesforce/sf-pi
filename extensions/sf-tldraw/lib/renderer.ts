/* SPDX-License-Identifier: Apache-2.0 */
/** Render orchestration: validate → compile → execute → gate → capture evidence. */
import { setTldrawStatus } from "../../../lib/common/tldraw-status/store.ts";
import { buildCanvasProgram } from "./canvas-program.ts";
import { createRunId, persistRenderArtifact } from "./artifacts.ts";
import { compileProfile } from "./profiles.ts";
import { readEffectiveTldrawPreferences } from "./settings.ts";
import { validateDiagramSpec, validateRenderedText } from "./spec-validation.ts";
import { TldrawRuntimeClient, TldrawRuntimeError } from "./runtime-client.ts";
import { sanitizeRuntimeText } from "./redaction.ts";
import type {
  CanvasExecutionResult,
  DiagramFamily,
  OutputMode,
  RenderArtifact,
  RenderMode,
  SalesforceDiagramSpec,
  TldrawPreferences,
  ValidationFinding,
} from "./types.ts";

export interface RenderRequest {
  family: DiagramFamily;
  spec: unknown;
  documentId?: string;
  pageName?: string;
  mode?: RenderMode;
  outputMode?: OutputMode;
  preferences?: Partial<TldrawPreferences>;
}

export interface RenderSuccess {
  ok: true;
  spec: SalesforceDiagramSpec;
  result: CanvasExecutionResult;
  artifact: RenderArtifact;
  outputMode: OutputMode;
}

export interface RenderFailure {
  ok: false;
  reason: string;
  message: string;
  validation?: { errors: ValidationFinding[]; warnings: ValidationFinding[] };
  recoverVia?: Record<string, unknown>;
  result?: CanvasExecutionResult;
}

export type RenderOutcome = RenderSuccess | RenderFailure;

export async function renderSalesforceDiagram(
  request: RenderRequest,
  context: { cwd: string; signal?: AbortSignal; client?: TldrawRuntimeClient },
): Promise<RenderOutcome> {
  const validation = validateDiagramSpec(request.spec, request.family);
  if (!validation.ok || !validation.spec) {
    return {
      ok: false,
      reason: "invalid_spec",
      message: [
        formatValidationErrors(validation.errors),
        'Call tldraw_canvas { action: "cheatsheet" }, fix the reported spec paths, then retry the render.',
      ].join("\n"),
      validation: { errors: validation.errors, warnings: validation.warnings },
      recoverVia: {
        action: "cheatsheet",
        instruction:
          'Call tldraw_canvas { action: "cheatsheet" }, fix the reported spec paths, then retry the render.',
      },
    };
  }

  const pageNameErrors = validateRenderedText(request.pageName, "page_name");
  if (pageNameErrors.length > 0) {
    return {
      ok: false,
      reason: "invalid_page_name",
      message: formatValidationErrors(pageNameErrors),
      validation: { errors: pageNameErrors, warnings: validation.warnings },
      recoverVia: { action: actionForFamily(request.family), fix: "Use a public-safe page name." },
    };
  }

  const effective = readEffectiveTldrawPreferences(context.cwd);
  const preferences: TldrawPreferences = {
    cardinalityDetail: request.preferences?.cardinalityDetail ?? effective.cardinalityDetail,
    cardFill: request.preferences?.cardFill ?? effective.cardFill,
    ldvThreshold: request.preferences?.ldvThreshold ?? effective.ldvThreshold,
    recordTypeMode: request.preferences?.recordTypeMode ?? effective.recordTypeMode,
    legendRelationships: request.preferences?.legendRelationships ?? effective.legendRelationships,
  };
  const client = context.client ?? new TldrawRuntimeClient();

  try {
    const capabilities = await client.capabilities(context.signal);
    if (!capabilities.execute || !capabilities.screenshot) {
      setTldrawStatus({ kind: "incompatible", origin: "interaction" });
      return {
        ok: false,
        reason: "incompatible_runtime",
        message:
          "The local tldraw runtime does not expose the execute and screenshot capabilities required by sf-tldraw.",
        recoverVia: { action: "status", command: "/sf-tldraw status" },
      };
    }
    const openDocuments = await client.documents(context.signal);
    const document = await client.resolveDocument(
      request.documentId,
      context.signal,
      openDocuments,
    );
    setTldrawStatus({
      kind: "ready",
      origin: "interaction",
      port: client.readServerConfig().port,
      openDocuments: openDocuments.length,
      focusedDocumentName: document.name,
    });
    const payload = compileProfile(validation.spec, {
      renderMode: request.mode ?? "preserve",
      pageName: request.pageName,
      preferences,
      warnings: validation.warnings.map((warning) => warning.message),
    });
    const script = buildCanvasProgram(payload);
    const rawResult = await client.execute<
      Omit<CanvasExecutionResult, "documentId"> & { documentId?: string }
    >(document.id, script, context.signal);
    const result: CanvasExecutionResult = { ...rawResult, documentId: document.id };
    if (!result.readiness.ready) {
      return {
        ok: false,
        reason: "readiness_blocked",
        message: `tldraw rendered the managed shapes but readiness failed: ${result.readiness.blockers.map((blocker) => blocker.message).join(" ")}`,
        result,
        recoverVia: { action: actionForFamily(request.family), mode: "relayout" },
      };
    }

    const [full, thumbnail] = await Promise.all([
      client.screenshot(document.id, { size: "full", mode: "canvas" }, context.signal),
      client.screenshot(document.id, { size: "small", mode: "canvas" }, context.signal),
    ]);
    if (
      full.pageName !== result.pageName ||
      thumbnail.pageName !== result.pageName ||
      full.captureMode !== "canvas" ||
      thumbnail.captureMode !== "canvas"
    ) {
      return {
        ok: false,
        reason: "evidence_page_mismatch",
        message: `Diagram readiness passed, but screenshot evidence did not belong to rendered page '${result.pageName}'.`,
        result,
        recoverVia: { action: actionForFamily(request.family) },
      };
    }
    let artifact: RenderArtifact;
    try {
      artifact = persistRenderArtifact({
        runId: createRunId(),
        spec: validation.spec,
        result,
        screenshot: full,
        thumbnail,
      });
    } catch {
      return {
        ok: false,
        reason: "evidence_capture_failed",
        message:
          "Diagram readiness passed, but validated full and thumbnail evidence could not be persisted securely.",
        result,
        recoverVia: { action: actionForFamily(request.family) },
      };
    }
    return {
      ok: true,
      spec: validation.spec,
      result,
      artifact,
      outputMode: request.outputMode ?? "summary",
    };
  } catch (error) {
    if (error instanceof TldrawRuntimeError) {
      setTldrawStatus({
        origin: "interaction",
        kind:
          error.code === "not_running"
            ? "not-running"
            : error.code === "no_open_document"
              ? "no-open-document"
              : error.code === "auth_error"
                ? "auth-error"
                : "stale-config",
        message: error.message,
      });
      return {
        ok: false,
        reason: error.code,
        message: error.message,
        recoverVia: recoveryFor(error.code),
      };
    }
    const message = sanitizeRuntimeText(error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      reason: "render_failed",
      message: `Salesforce diagram render failed: ${message.slice(0, 500)}`,
      recoverVia: { action: "status" },
    };
  }
}

function formatValidationErrors(errors: ValidationFinding[]): string {
  return [
    "Salesforce Diagram Spec is invalid:",
    ...errors
      .slice(0, 12)
      .map((error) => `- ${error.path ? `${error.path}: ` : ""}${error.message}`),
  ].join("\n");
}

function actionForFamily(family: DiagramFamily): string {
  return family === "data_model"
    ? "render_salesforce_data_model"
    : family === "architecture"
      ? "render_salesforce_architecture"
      : "render_salesforce_sequence";
}

function recoveryFor(code: TldrawRuntimeError["code"]): Record<string, unknown> {
  if (code === "no_open_document" || code === "not_found") {
    return {
      action: "create_document",
      instruction: "Create a tldraw document, then retry with its document_id.",
    };
  }
  if (code === "not_running" || code === "stale_config") {
    return { action: "status", instruction: "Start or restart tldraw offline." };
  }
  if (code === "auth_error")
    return {
      action: "status",
      instruction: "Restart tldraw offline so server.json and its per-launch token are refreshed.",
    };
  return { action: "status" };
}
