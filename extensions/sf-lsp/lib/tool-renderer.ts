/* SPDX-License-Identifier: Apache-2.0 */
/**
 * In-card LSP panel for write/edit tool results.
 *
 * Re-registers pi's built-in `write` and `edit` tools with the same name so
 * they inherit all existing behavior (the pattern used by
 * `examples/extensions/built-in-tool-renderer.ts`). We delegate execution
 * to `createEditTool` / `createWriteTool` unchanged; we only add a small
 * LSP panel below the default renderResult output.
 *
 * The panel is driven entirely by `result.details.sfPiDiagnostics`, which
 * is already stamped by `feedback.ts`. If another extension (e.g.
 * sf-agentscript-assist) wrote that metadata instead, we pick it up too,
 * which keeps Apex/LWC/Agent Script parity in the UI.
 */
import type { ExtensionAPI, Theme, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import {
  createEditTool,
  createWriteTool,
  type EditToolDetails,
} from "@mariozechner/pi-coding-agent";
import { Box, Container, Text } from "@mariozechner/pi-tui";
import type {
  SfPiDiagnosticMetadataItem,
  SfPiDiagnosticsMetadata,
  SfPiDiagnosticStatus,
} from "../../../lib/common/display/diagnostics.ts";
import { SF_PI_DIAGNOSTICS_DETAILS_KEY } from "../../../lib/common/display/diagnostics.ts";
import { languageLongLabel } from "./activity.ts";

// -------------------------------------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------------------------------------

/**
 * Register a single pair of edit/write overrides. Pi's registerTool is
 * idempotent on name, so calling this once at extension load is enough
 * regardless of how many sessions open.
 */
export function registerLspToolRenderers(pi: ExtensionAPI, cwd: string): void {
  const editTool = createEditTool(cwd);
  pi.registerTool({
    name: "edit",
    label: "edit",
    description: editTool.description,
    parameters: editTool.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      return editTool.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("edit "));
      text += theme.fg("accent", args.path);
      return new Text(text, 0, 0);
    },
    renderResult(result, options, theme) {
      return renderEditResult(result, options, theme);
    },
  });

  const writeTool = createWriteTool(cwd);
  pi.registerTool({
    name: "write",
    label: "write",
    description: writeTool.description,
    parameters: writeTool.parameters,
    async execute(toolCallId, params, signal, onUpdate) {
      return writeTool.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("write "));
      text += theme.fg("accent", args.path);
      const lineCount = args.content.split("\n").length;
      text += theme.fg("dim", ` (${lineCount} lines)`);
      return new Text(text, 0, 0);
    },
    renderResult(result, options, theme) {
      return renderWriteResult(result, options, theme);
    },
  });
}

// -------------------------------------------------------------------------------------------------
// edit
// -------------------------------------------------------------------------------------------------

function renderEditResult(
  result: { content: unknown; details?: unknown },
  options: ToolRenderResultOptions,
  theme: Theme,
): Container {
  const container = new Container();
  const { expanded, isPartial } = options;

  if (isPartial) {
    container.addChild(new Text(theme.fg("warning", "Editing..."), 0, 0));
    return container;
  }

  const details = result.details as EditToolDetails | undefined;
  const contentArr = Array.isArray(result.content) ? result.content : [];
  const firstText = contentArr.find(
    (p: { type?: string; text?: string }) => p?.type === "text" && typeof p.text === "string",
  ) as { text: string } | undefined;

  if (firstText?.text.startsWith("Error")) {
    container.addChild(new Text(theme.fg("error", firstText.text.split("\n")[0]), 0, 0));
    return container;
  }

  if (details?.diff) {
    container.addChild(new Text(formatDiffStats(details.diff, theme, expanded), 0, 0));
  } else {
    container.addChild(new Text(theme.fg("success", "Applied"), 0, 0));
  }

  const panel = buildLspPanel(result.details, theme, expanded);
  if (panel) container.addChild(panel);

  return container;
}

function formatDiffStats(diff: string, theme: Theme, expanded: boolean): string {
  const diffLines = diff.split("\n");
  let additions = 0;
  let removals = 0;
  for (const line of diffLines) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) removals++;
  }

  let text = theme.fg("success", `+${additions}`);
  text += theme.fg("dim", " / ");
  text += theme.fg("error", `-${removals}`);

  if (expanded) {
    for (const line of diffLines.slice(0, 30)) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        text += `\n${theme.fg("success", line)}`;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        text += `\n${theme.fg("error", line)}`;
      } else {
        text += `\n${theme.fg("dim", line)}`;
      }
    }
    if (diffLines.length > 30) {
      text += `\n${theme.fg("muted", `... ${diffLines.length - 30} more diff lines`)}`;
    }
  }

  return text;
}

// -------------------------------------------------------------------------------------------------
// write
// -------------------------------------------------------------------------------------------------

function renderWriteResult(
  result: { content: unknown; details?: unknown },
  options: ToolRenderResultOptions,
  theme: Theme,
): Container {
  const container = new Container();
  const { expanded, isPartial } = options;

  if (isPartial) {
    container.addChild(new Text(theme.fg("warning", "Writing..."), 0, 0));
    return container;
  }

  const contentArr = Array.isArray(result.content) ? result.content : [];
  const firstText = contentArr.find(
    (p: { type?: string; text?: string }) => p?.type === "text" && typeof p.text === "string",
  ) as { text: string } | undefined;

  if (firstText?.text.startsWith("Error")) {
    container.addChild(new Text(theme.fg("error", firstText.text.split("\n")[0]), 0, 0));
    return container;
  }

  container.addChild(new Text(theme.fg("success", firstText?.text ?? "Written"), 0, 0));

  const panel = buildLspPanel(result.details, theme, expanded);
  if (panel) container.addChild(panel);

  return container;
}

// -------------------------------------------------------------------------------------------------
// Shared LSP panel
// -------------------------------------------------------------------------------------------------

function buildLspPanel(details: unknown, theme: Theme, expanded: boolean): Box | null {
  const meta = extractMetadata(details);
  if (!meta) return null;

  const box = new Box(1, 0, (s) => theme.bg("toolPendingBg", s));

  const headerColor = headerColorForStatus(meta.status);
  const header = buildHeader(meta, theme, headerColor);
  box.addChild(new Text(header, 0, 0));

  if (meta.status === "error" && meta.diagnostics.length > 0) {
    const body = buildErrorBody(meta.diagnostics, theme, expanded);
    if (body) box.addChild(new Text(body, 0, 0));
  } else if (meta.status === "clean") {
    const note = meta.renderedText?.includes("now clean")
      ? "clean (was error → now clean)"
      : "clean";
    box.addChild(new Text(theme.fg("success", note), 0, 0));
  } else if (meta.status === "unavailable") {
    const reason = meta.unavailableReason ?? "unavailable";
    box.addChild(new Text(theme.fg("warning", truncate(reason, 160)), 0, 0));
  }

  return box;
}

function extractMetadata(details: unknown): SfPiDiagnosticsMetadata | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const record = details as Record<string, unknown>;
  const candidate = record[SF_PI_DIAGNOSTICS_DETAILS_KEY];
  if (!candidate || typeof candidate !== "object") return null;
  return candidate as SfPiDiagnosticsMetadata;
}

function headerColorForStatus(status: SfPiDiagnosticStatus): "success" | "error" | "warning" {
  switch (status) {
    case "error":
      return "error";
    case "unavailable":
      return "warning";
    case "clean":
    default:
      return "success";
  }
}

function buildHeader(
  meta: SfPiDiagnosticsMetadata,
  theme: Theme,
  color: "success" | "error" | "warning",
): string {
  const sourceName = meta.source === "sf-agentscript-assist" ? "agentscript-assist" : "sf-lsp";
  const language = languageLongLabel(meta.language);
  const marker = theme.fg(color, statusMarker(meta.status));
  const sep = theme.fg("muted", " · ");
  const head = `${marker} ${theme.fg("text", theme.bold("LSP"))}${sep}${theme.fg("accent", language)}${sep}${theme.fg("dim", sourceName)}`;

  const tail =
    meta.status === "error" ? ` ${theme.fg("error", `${meta.diagnostics.length} err`)}` : "";
  return `${head}${tail}`;
}

function statusMarker(status: SfPiDiagnosticStatus): string {
  switch (status) {
    case "clean":
      return "✓";
    case "error":
      return "✗";
    case "unavailable":
    default:
      return "○";
  }
}

function buildErrorBody(
  diagnostics: SfPiDiagnosticMetadataItem[],
  theme: Theme,
  expanded: boolean,
): string | null {
  const limit = expanded ? Math.min(diagnostics.length, 30) : 3;
  const slice = diagnostics.slice(0, limit);
  const lines: string[] = [];

  for (const diag of slice) {
    const loc = theme.fg("muted", `L${diag.line}`);
    const code = diag.code ? theme.fg("dim", ` [${diag.code}]`) : "";
    const message = theme.fg("text", clampLine(diag.message, 180));
    lines.push(`  ${loc}${code}: ${message}`);
  }

  const omitted = diagnostics.length - slice.length;
  if (omitted > 0) {
    lines.push(theme.fg("muted", `  (+${omitted} more)`));
  }

  if (!expanded && diagnostics.length > 3) {
    lines.push(theme.fg("dim", "  ▸ ctrl+e to expand"));
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

function clampLine(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
