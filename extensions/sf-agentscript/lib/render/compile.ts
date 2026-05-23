/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Compile diagnostics renderer.
 *
 * Two surfaces, one extractor:
 *   - renderCompileResult(...)  — pi-tui Text component (TUI)
 *   - compileResultMarkdown(...)— Markdown string (slash panels, reports)
 *
 * The LLM-facing summary text is unchanged (still produced by
 * authoring/actions/compile.ts::renderCheckSummary). This module only adds
 * the visual row that the human sees in the TUI.
 */

import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { padRightVisible, visibleWidth, clipLine } from "./shared.ts";

export interface CompileDiagnostic {
  severity: number;
  code?: string;
  message: string;
  range: { start: { line: number; character?: number } };
}

export interface CompileResultDetails {
  ok?: boolean;
  action?: "check" | "format";
  path?: string;
  clean?: boolean;
  diagnostic_count?: number;
  quick_fix_count?: number;
  dialect?: { name?: string; version?: string } | null;
  compiled_via?: "local" | "server";
  diagnostics?: CompileDiagnostic[];
  changed?: boolean;
  bytes_changed?: number;
}

interface CompileArgs {
  action?: "check" | "format";
  path?: string;
}

// ─── renderCall ───────────────────────────────────────────────────────────────

export function renderCompileCall(args: CompileArgs, theme: Theme): Text {
  const label = theme.fg("toolTitle", theme.bold("⚙  Agent Script compile "));
  const action = args.action ?? "check";
  const summary = `${action} · ${args.path ?? "?"}`;
  return new Text(label + theme.fg("muted", summary), 0, 0);
}

// ─── renderResult ─────────────────────────────────────────────────────────────

interface RenderOpts {
  expanded?: boolean;
  isPartial?: boolean;
}

export function renderCompileResult(
  result: { details?: CompileResultDetails | unknown; content?: unknown[] },
  opts: RenderOpts,
  theme: Theme,
): Text {
  if (opts.isPartial) return new Text(theme.fg("warning", "⚙  compile · running…"), 0, 0);
  const details = (result.details ?? {}) as CompileResultDetails;
  if (!details.ok) {
    return new Text(
      theme.fg("error", `✗ ${getFirstText(result.content) || "compile failed"}`),
      0,
      0,
    );
  }
  return new Text(formatCompileBody(details, theme, /*ansi=*/ true), 0, 0);
}

// ─── Markdown emitter ─────────────────────────────────────────────────────────

export function compileResultMarkdown(details: CompileResultDetails): string {
  return formatCompileBody(details, undefined, /*ansi=*/ false);
}

// ─── Shared body formatter ────────────────────────────────────────────────────

function formatCompileBody(
  details: CompileResultDetails,
  theme: Theme | undefined,
  _ansi: boolean,
): string {
  const fg = (token: Parameters<Theme["fg"]>[0], s: string): string =>
    theme ? theme.fg(token, s) : s;
  const bold = (s: string): string => (theme ? theme.bold(s) : `**${s}**`);
  const dim = (s: string): string => fg("dim", s);
  const ok = (s: string): string => fg("success", s);
  const err = (s: string): string => fg("error", s);
  const warn = (s: string): string => fg("warning", s);
  const code = (s: string): string => fg("mdCode", s);

  const path = details.path ?? "?";
  const dialectName = details.dialect?.name ?? "unknown dialect";

  // Format action — short-circuits on success.
  if (details.action === "format") {
    if (details.changed) {
      return `${bold(`✨ ${path}`)} formatted ${dim(`(Δ ${details.bytes_changed ?? 0} bytes)`)}`;
    }
    return `${ok(`✓ ${path}`)} ${dim(`already canonical`)}`;
  }

  // Check action — clean
  const diagnostics = details.diagnostics ?? [];
  if ((details.diagnostic_count ?? diagnostics.length) === 0) {
    const tag = details.compiled_via === "server" ? dim(" (via server)") : "";
    return `${ok(`✓ ${path}`)} ${dim(`compiles clean`)} ${dim(`(${dialectName})`)}${tag}`;
  }

  // Check action — has diagnostics
  const sev1 = diagnostics.filter((d) => d.severity === 1).length;
  const sev2 = diagnostics.filter((d) => d.severity === 2).length;
  const fixCount = details.quick_fix_count ?? 0;

  const headerBits = [
    bold(`❌ ${path}`),
    `${diagnostics.length} ${diagnostics.length === 1 ? "issue" : "issues"}`,
  ];
  if (sev1 > 0) headerBits.push(err(`● ${sev1} error${sev1 === 1 ? "" : "s"}`));
  if (sev2 > 0) headerBits.push(warn(`⚠ ${sev2} warning${sev2 === 1 ? "" : "s"}`));
  if (fixCount > 0) headerBits.push(fg("accent", `🔧 ${fixCount} quick-fix ready`));

  const lines: string[] = [];
  lines.push(headerBits.join("  "));
  lines.push(dim(dialectName));
  lines.push("");

  // Sort: errors first, then warnings, in original order within group.
  const ordered = [...diagnostics].sort((a, b) => a.severity - b.severity);
  const widestCode = ordered
    .slice(0, 8)
    .reduce((max, d) => Math.max(max, visibleWidth(d.code ?? "(no-code)")), 0);

  // Header row
  const sevHeader = padRightVisible(dim("Sev"), 5);
  const codeHeader = padRightVisible(dim("Code"), widestCode + 2);
  const lineHeader = padRightVisible(dim("Line"), 6);
  lines.push(`  ${sevHeader} ${codeHeader} ${lineHeader} ${dim("Message")}`);

  for (const d of ordered.slice(0, 8)) {
    const dot = d.severity === 1 ? err("●") : d.severity === 2 ? warn("⚠") : fg("muted", "·");
    const sev = padRightVisible(`${dot} `, 5);
    const codeStr = padRightVisible(code(d.code ?? "(no-code)"), widestCode + 2);
    const ln = padRightVisible(dim(`L${(d.range?.start?.line ?? 0) + 1}`), 6);
    const msg = clipLine(d.message ?? "", 80);
    lines.push(`  ${sev} ${codeStr} ${ln} ${msg}`);
  }
  if (diagnostics.length > 8) {
    lines.push(dim(`  …and ${diagnostics.length - 8} more in details.diagnostics`));
  }

  // Quick-fix recover_via hint
  if (fixCount > 0) {
    const first = ordered.find((d) => d.severity === 1) ?? ordered[0];
    const codeArg = first?.code ?? "";
    const lineArg = (first?.range?.start?.line ?? 0) + 1;
    lines.push("");
    lines.push(
      `${fg("accent", "💡 Apply fix:")} ${code(`agentscript_authoring verb=mutate mode=apply_quick_fix line=${lineArg} code=${codeArg}`)}`,
    );
  }

  return lines.join("\n");
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
