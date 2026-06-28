/* SPDX-License-Identifier: Apache-2.0 */
/** Apex diagnostics via the existing managed Apex LSP client during handoff. */

import path from "node:path";
import { getLspDiagnosticsForFile } from "../../sf-lsp/lib/lsp-client.ts";
import type { LspDiagnostic } from "../../sf-lsp/lib/types.ts";
import { buildApexDigest } from "./digest.ts";
import { fail, ok } from "./result.ts";
import type { SfApexParams, ToolResult } from "./types.ts";

const DIAGNOSTIC_TIMEOUT_MS = 6_000;

export async function diagnoseFile(params: SfApexParams, cwd: string): Promise<ToolResult> {
  const filePath = resolveToolPath(params.file ?? params.target, cwd);
  if (!filePath)
    return fail("file or target is required for diagnose.file.", { kind: "diagnostics" });
  if (!isApexFile(filePath)) {
    return fail("diagnose.file only supports .cls and .trigger files.", {
      kind: "diagnostics",
      file: filePath,
    });
  }
  return diagnoseApexFile(filePath, cwd);
}

export async function diagnoseApexFile(filePath: string, cwd: string): Promise<ToolResult> {
  const lspResult = await getLspDiagnosticsForFile("apex", filePath, cwd, DIAGNOSTIC_TIMEOUT_MS);
  if (lspResult.unavailable) {
    return fail(`Apex diagnostics unavailable: ${lspResult.unavailable.detail}`, {
      kind: "diagnostics",
      status: "unavailable",
      file: filePath,
      unavailable: lspResult.unavailable,
      digest: buildApexDigest({
        action: "diagnose.file",
        kind: "diagnostics",
        status: "warning",
        icon: "🧠",
        title: "Apex File Gate · unavailable",
        mode: "Managed Apex LSP",
        apiCalls: [
          {
            method: "LOCAL",
            path: "Managed Apex LSP",
            detail: "textDocument diagnostics · 1 file",
          },
        ],
        sections: [
          {
            icon: "🚦",
            title: "Gate",
            rows: [
              { icon: "⚠️", label: "Status", value: "diagnostics unavailable" },
              { icon: "🧯", label: "Reason", value: lspResult.unavailable.detail },
            ],
          },
          {
            icon: "📄",
            title: "File",
            rows: fileRows(filePath),
          },
        ],
        nextRows: [
          {
            icon: "🧭",
            label: "Recommend",
            value: "check Apex LSP readiness, then rerun diagnose.file",
          },
        ],
      }),
    });
  }

  const errors = lspResult.diagnostics.filter((diagnostic) => diagnostic.severity === 1);
  const warnings = lspResult.diagnostics.filter((diagnostic) => diagnostic.severity === 2);
  const status = errors.length > 0 ? "error" : "clean";
  const counts = {
    errors: errors.length,
    warnings: warnings.length,
    total: lspResult.diagnostics.length,
  };
  return ok(formatDiagnostics(filePath, errors, warnings), {
    kind: "diagnostics",
    status,
    file: filePath,
    diagnostics: lspResult.diagnostics,
    counts,
    digest: buildApexDiagnosticsDigest(filePath, counts, lspResult.diagnostics),
  });
}

export function isApexFile(filePath: string): boolean {
  return filePath.endsWith(".cls") || filePath.endsWith(".trigger");
}

export function resolveToolPath(inputPath: string | undefined, cwd: string): string | undefined {
  if (!inputPath || inputPath.trim() === "") return undefined;
  const cleaned = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
  return path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(cwd, cleaned);
}

function buildApexDiagnosticsDigest(
  filePath: string,
  counts: { errors: number; warnings: number; total: number },
  diagnostics: LspDiagnostic[],
) {
  const clean = counts.errors === 0 && counts.warnings === 0;
  const blocked = counts.errors > 0;
  return buildApexDigest({
    action: "diagnose.file",
    kind: "diagnostics",
    status: clean ? "pass" : blocked ? "fail" : "warning",
    icon: "🧠",
    title: `Apex File Gate · ${clean ? "passed" : blocked ? "blocked" : "warnings"}`,
    mode: "Managed Apex LSP",
    apiCalls: [
      { method: "LOCAL", path: "Managed Apex LSP", detail: "textDocument diagnostics · 1 file" },
    ],
    sections: [
      {
        icon: "🚦",
        title: "Gate",
        rows: [
          {
            icon: clean ? "🟢" : blocked ? "🔴" : "🟡",
            label: "Status",
            value: clean
              ? "safe to test"
              : blocked
                ? "blocked by compile diagnostics"
                : "warnings only · can test with caution",
          },
          { icon: "🔥", label: "Errors", value: String(counts.errors) },
          { icon: "⚠️", label: "Warnings", value: String(counts.warnings) },
        ],
      },
      {
        icon: "🧯",
        title: "Findings",
        rows: findingRows(diagnostics),
      },
      {
        icon: "📄",
        title: "File",
        rows: fileRows(filePath),
      },
    ],
    nextRows: [
      {
        icon: "🧭",
        label: "Recommend",
        value: clean
          ? "run targeted tests"
          : blocked
            ? "fix errors, rerun diagnose.file, then test"
            : "review warnings, then run targeted tests",
      },
    ],
  });
}

function findingRows(diagnostics: LspDiagnostic[]) {
  if (diagnostics.length === 0) {
    return [{ icon: "✅", label: "None", value: "no Apex diagnostics" }];
  }
  return diagnostics.slice(0, 6).map((diagnostic) => ({
    icon: diagnostic.severity === 1 ? "🔥" : "⚠️",
    label: `L${diagnostic.range.start.line + 1}:C${diagnostic.range.start.character + 1}`,
    value: diagnostic.message,
  }));
}

function fileRows(filePath: string) {
  return [
    { icon: "📄", label: "Name", value: path.basename(filePath) },
    { icon: "📍", label: "Path", value: compactPath(filePath) },
    { icon: "⚙️", label: "Engine", value: "Managed Apex LSP" },
  ];
}

function compactPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "/force-app/";
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function formatDiagnostics(
  filePath: string,
  errors: LspDiagnostic[],
  warnings: LspDiagnostic[],
): string {
  const fileName = path.basename(filePath);
  if (errors.length === 0 && warnings.length === 0) return `Apex diagnostics clean: ${fileName}.`;
  const lines = [
    `Apex diagnostics for ${fileName}: ${errors.length} error(s), ${warnings.length} warning(s).`,
  ];
  for (const diagnostic of [...errors, ...warnings].slice(0, 10)) {
    const line = diagnostic.range.start.line + 1;
    lines.push(`- L${line}: ${diagnostic.message}`);
  }
  const hidden = errors.length + warnings.length - 10;
  if (hidden > 0) lines.push(`- … +${hidden} more diagnostic(s)`);
  return lines.join("\n");
}
