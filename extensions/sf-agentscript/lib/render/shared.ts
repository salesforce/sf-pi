/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared rendering helpers for sf-agentscript tool results.
 *
 * Two surfaces share these helpers:
 *   - `renderResult` (TUI Ink) emits theme-colored Text via `theme.fg(token, ...)`.
 *   - Markdown emitters (slash-command panels, headless reports) consume
 *     the same extractor output but format with Markdown.
 *
 * Glyph + token assignments are pinned here so every step type renders
 * identically across tools (preview, eval, eval get_failure, eval trace).
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { DigestRow } from "../preview/trace-digest.ts";

// ─── Step-type → glyph + theme color ─────────────────────────────────────────

interface StepStyle {
  glyph: string;
  color: ThemeColor;
  /** Display label override; falls back to the step type string. */
  label?: string;
}

const DEFAULT_STYLE: StepStyle = { glyph: "❔", color: "muted" };

const STEP_STYLES: Record<string, StepStyle> = {
  UserInputStep: { glyph: "▶", color: "accent" },
  LLMStep: { glyph: "🧠", color: "mdHeading" },
  LLMExecutionStep: { glyph: "🧠", color: "mdHeading" },
  BeforeReasoningStep: { glyph: "🧠", color: "muted", label: "Reasoning" },
  BeforeReasoningIterationStep: { glyph: "🧠", color: "muted", label: "Reasoning" },
  AfterReasoningStep: { glyph: "🧠", color: "muted", label: "Reasoning end" },
  ReasoningStep: { glyph: "🧠", color: "muted", label: "Reasoning" },
  TransitionStep: { glyph: "🔀", color: "success" },
  UpdateTopicStep: { glyph: "📌", color: "mdHeading", label: "Topic" },
  FunctionStep: { glyph: "🛠", color: "toolTitle" },
  FunctionCallStep: { glyph: "🛠", color: "toolTitle", label: "Function" },
  VariableUpdateStep: { glyph: "📦", color: "mdCode", label: "Variable" },
  EnabledToolsStep: { glyph: "🧰", color: "mdListBullet", label: "Tools enabled" },
  NodeEntryStateStep: { glyph: "🟦", color: "mdListBullet", label: "Node entry" },
  PlannerResponseStep: { glyph: "💬", color: "success", label: "Response" },
  OutputEvaluationStep: { glyph: "🛡", color: "warning", label: "Output eval" },
  PlatformNotificationStep: { glyph: "🔔", color: "warning", label: "Notification" },
  SessionInitialStateStep: { glyph: "🟢", color: "muted", label: "Session start" },
  CitedReferenceStep: { glyph: "📎", color: "mdLink", label: "Citation" },
};

export function styleForStep(stepType: string): StepStyle {
  return STEP_STYLES[stepType] ?? DEFAULT_STYLE;
}

// ─── Width helpers ─────────────────────────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const OSC8_RE = /\x1b\]8;;[^\x1b]*\x1b\\/g;

/** Strip ANSI + OSC 8 sequences so we can measure visible width for padding. */
export function stripAnsi(s: string): string {
  return s.replace(OSC8_RE, "").replace(ANSI_RE, "");
}

/** Approximate visible cell width. Treats common emoji as width 2. */
export function visibleWidth(s: string): number {
  const stripped = stripAnsi(s);
  let width = 0;
  for (const ch of stripped) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      // Emoji + common pictographs
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x2600 && code <= 0x27bf) ||
      // CJK common ranges
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x303f)
    ) {
      width += 2;
    } else if (code >= 0x20) {
      width += 1;
    }
    // Skip control chars and combining marks (rough).
  }
  return width;
}

/** Right-pad to a target visible width. */
export function padRightVisible(s: string, target: number): string {
  const w = visibleWidth(s);
  if (w >= target) return s;
  return s + " ".repeat(target - w);
}

/** Truncate a single line to a max visible width with an ellipsis. */
export function clipLine(s: string, max: number): string {
  if (visibleWidth(s) <= max) return s;
  // Walk backwards stripping characters until we fit (rough; ANSI-naive but
  // we only call this on already-uncolored input).
  const stripped = stripAnsi(s);
  let out = "";
  for (const ch of stripped) {
    if (visibleWidth(out + ch + "…") > max) break;
    out += ch;
  }
  return out + "…";
}

// ─── Mini formatters reused by every renderer ────────────────────────────────

export function fmtMs(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function fmtChars(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Format an offset relative to a turn anchor (ms). */
export function fmtOffset(absMs: number | undefined, anchorMs: number | undefined): string {
  if (typeof absMs !== "number" || typeof anchorMs !== "number") return "";
  const off = absMs - anchorMs;
  if (off < 0) return "";
  if (off === 0) return "+0ms";
  return `+${fmtMs(off)}`;
}

// ─── Inline detail formatter for digest rows ─────────────────────────────────

/**
 * Render the type-specific "detail" portion of a timeline row, e.g.
 *   "Triage → AccountSecurity"  for TransitionStep
 *   "488ms · 7,183 → 406 chars" for LLMStep
 *   "verified_check = true"     for VariableUpdateStep
 *
 * Theme is optional — when omitted (Markdown emitter), we return plain text.
 */
export function rowDetail(row: DigestRow, theme?: Theme): string {
  const code = (s: string) => (theme ? theme.fg("mdCode", s) : s);
  const dim = (s: string) => (theme ? theme.fg("dim", s) : s);
  const ok = (s: string) => (theme ? theme.fg("success", s) : s);
  const err = (s: string) => (theme ? theme.fg("error", s) : s);
  const accent = (s: string) => (theme ? theme.fg("accent", s) : s);

  switch (row.t) {
    case "UserInputStep":
      return typeof row.user === "string" ? `"${row.user}"` : "";
    case "LLMStep":
    case "LLMExecutionStep": {
      const parts: string[] = [];
      if (typeof row.agent === "string") parts.push(accent(row.agent));
      const promptN = typeof row.prompt_chars === "number" ? row.prompt_chars : undefined;
      const respN = typeof row.response_chars === "number" ? row.response_chars : undefined;
      if (promptN !== undefined && respN !== undefined) {
        parts.push(dim(`${fmtChars(promptN)} → ${fmtChars(respN)} chars`));
      }
      return parts.join(" · ");
    }
    case "TransitionStep": {
      const from = typeof row.from === "string" ? row.from : "?";
      const to = typeof row.to === "string" ? row.to : "?";
      return `${code(from)} → ${code(to)}`;
    }
    case "UpdateTopicStep":
      return typeof row.topic === "string" ? code(row.topic) : "";
    case "FunctionStep":
    case "FunctionCallStep": {
      const fn = typeof row.fn === "string" ? row.fn : "(unknown)";
      const args = typeof row.args_preview === "string" ? row.args_preview : "";
      return args ? `${code(fn)} ${dim(args)}` : code(fn);
    }
    case "VariableUpdateStep": {
      const name = typeof row.var === "string" ? row.var : "(unknown)";
      const value = typeof row.value_preview === "string" ? row.value_preview : "?";
      const tail =
        typeof row.extra_updates === "number" && row.extra_updates > 0
          ? dim(` +${row.extra_updates} more`)
          : "";
      const internalTag = row.internal === true ? dim(" (internal)") : "";
      return `${code(name)} = ${value}${tail}${internalTag}`;
    }
    case "EnabledToolsStep": {
      const tools = Array.isArray(row.tools) ? (row.tools as string[]) : [];
      const agent = typeof row.agent === "string" ? accent(row.agent) : "";
      const list = tools.length
        ? code(
            `[${tools.slice(0, 4).join(", ")}${tools.length > 4 ? ` +${tools.length - 4}` : ""}]`,
          )
        : "";
      return [agent, list].filter(Boolean).join(" · ");
    }
    case "NodeEntryStateStep":
      return typeof row.node === "string" ? accent(row.node) : "";
    case "PlannerResponseStep": {
      const parts: string[] = [];
      if (typeof row.response_type === "string") parts.push(code(row.response_type));
      if (row.is_content_safe === true) parts.push(ok("safe ✓"));
      else if (row.is_content_safe === false) parts.push(err("⚠ unsafe"));
      if (typeof row.response_chars === "number") parts.push(dim(`${row.response_chars} chars`));
      return parts.join(" · ");
    }
    case "BeforeReasoningStep":
    case "BeforeReasoningIterationStep":
    case "AfterReasoningStep":
    case "ReasoningStep":
      return typeof row.agent === "string" ? accent(row.agent) : "";
    case "SessionInitialStateStep": {
      const dc = typeof row.directive_context === "string" ? code(row.directive_context) : "";
      const v = typeof row.vars === "number" ? dim(`${row.vars} vars seeded`) : "";
      return [dc, v].filter(Boolean).join(" · ");
    }
    case "CitedReferenceStep": {
      const title = typeof row.title === "string" ? row.title : "";
      const score = typeof row.score === "number" ? dim(` (score=${row.score.toFixed(2)})`) : "";
      return title ? `${code(title)}${score}` : "";
    }
    default:
      // Unknown step — hint string from fallback extractor.
      return typeof row.hint === "string" ? dim(row.hint) : "";
  }
}

/** Produce a single-line "sub-row" string (e.g. tool_calls list, fn output). */
export function rowSubRow(row: DigestRow, theme?: Theme): string | null {
  const code = (s: string) => (theme ? theme.fg("mdCode", s) : s);
  const dim = (s: string) => (theme ? theme.fg("dim", s) : s);
  if ((row.t === "LLMStep" || row.t === "LLMExecutionStep") && Array.isArray(row.tool_calls)) {
    const calls = row.tool_calls as string[];
    if (calls.length === 0) return null;
    return `${dim("↳ tool_calls:")} ${code(`[${calls.join(", ")}]`)}`;
  }
  if ((row.t === "FunctionStep" || row.t === "FunctionCallStep") && row.has_output === true) {
    return dim("↳ result captured");
  }
  return null;
}

/** Friendly label for a step type, with overrides from the styles table. */
export function stepLabel(stepType: string): string {
  const s = STEP_STYLES[stepType];
  if (s?.label) return s.label;
  // Strip "Step" suffix for display when there's no override.
  return stepType.replace(/Step$/, "");
}
