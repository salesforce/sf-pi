/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Structured diagnostic metadata shared by Salesforce feedback extensions.
 *
 * The text appended to tool `content` remains the model-facing contract. This
 * metadata gives renderers, widgets, and tests a stable machine-readable shape.
 */
import path from "node:path";
import type { SfPiDisplayProfile } from "./types.ts";

export const SF_PI_DIAGNOSTICS_DETAILS_KEY = "sfPiDiagnostics" as const;

export type SfPiDiagnosticSeverity = "error" | "warning" | "info" | "hint";
export type SfPiDiagnosticStatus = "error" | "clean" | "unavailable";

export interface SfPiDiagnosticRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface SfPiDiagnosticFixMetadata {
  title: string;
  preferred?: boolean;
  diagnosticLine?: number;
  diagnosticCode?: string;
  editCount?: number;
  firstEdit?: {
    range: SfPiDiagnosticRange;
    newTextPreview: string;
  };
}

export interface SfPiDiagnosticMetadataItem {
  severity: SfPiDiagnosticSeverity;
  message: string;
  line: number;
  character: number;
  code?: string;
  source?: string;
  range: SfPiDiagnosticRange;
  fixes?: SfPiDiagnosticFixMetadata[];
}

export interface SfPiDiagnosticsMetadata {
  source: "sf-lsp" | "sf-agentscript-assist";
  status: SfPiDiagnosticStatus;
  filePath: string;
  fileName: string;
  language: "apex" | "lwc" | "agentscript";
  generatedAt: string;
  summary: string;
  renderedText: string;
  diagnostics: SfPiDiagnosticMetadataItem[];
  dialect?: string;
  unavailableReason?: string;
}

export type DetailsWithSfPiDiagnostics<
  T extends Record<string, unknown> = Record<string, unknown>,
> = T & {
  [SF_PI_DIAGNOSTICS_DETAILS_KEY]?: SfPiDiagnosticsMetadata;
};

export function severityFromLsp(value: unknown): SfPiDiagnosticSeverity {
  switch (value) {
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    case 1:
    default:
      return "error";
  }
}

export function diagnosticFileName(filePath: string): string {
  return path.basename(filePath);
}

export function buildDiagnosticsSummary(metadata: {
  status: SfPiDiagnosticStatus;
  fileName: string;
  diagnostics?: readonly unknown[];
  unavailableReason?: string;
}): string {
  if (metadata.status === "clean") {
    return `${metadata.fileName} is clean`;
  }
  if (metadata.status === "unavailable") {
    return `${metadata.fileName} diagnostic engine unavailable`;
  }
  const count = metadata.diagnostics?.length ?? 0;
  return `${metadata.fileName}: ${count} diagnostic${count === 1 ? "" : "s"}`;
}

export function mergeSfPiDiagnosticsDetails(
  existingDetails: unknown,
  diagnostics: SfPiDiagnosticsMetadata,
): DetailsWithSfPiDiagnostics {
  if (existingDetails && typeof existingDetails === "object" && !Array.isArray(existingDetails)) {
    return {
      ...(existingDetails as Record<string, unknown>),
      [SF_PI_DIAGNOSTICS_DETAILS_KEY]: diagnostics,
    };
  }

  return {
    [SF_PI_DIAGNOSTICS_DETAILS_KEY]: diagnostics,
  };
}

export function renderDiagnosticsForProfile(
  metadata: SfPiDiagnosticsMetadata,
  profile: SfPiDisplayProfile,
): string {
  const header = `[${metadata.source}] ${metadata.summary}`;
  if (metadata.status !== "error") {
    return header;
  }

  const limit =
    profile === "compact" ? 3 : profile === "balanced" ? 8 : metadata.diagnostics.length;
  const shown = metadata.diagnostics.slice(0, limit);
  const lines = [header];

  for (const diagnostic of shown) {
    const code = diagnostic.code ? ` [${diagnostic.code}]` : "";
    lines.push(`- L${diagnostic.line}${code}: ${diagnostic.message}`);
    if (profile !== "compact") {
      for (const fix of diagnostic.fixes ?? []) {
        lines.push(`    fix: ${fix.title}`);
      }
    }
  }

  const omitted = metadata.diagnostics.length - shown.length;
  if (omitted > 0) {
    lines.push(`(+${omitted} more)`);
  }

  return lines.join("\n");
}
