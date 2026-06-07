/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Timeline waterfall renderer for agentscript_preview send results.
 *
 * Reads the same `TraceDigest` we already ship in `details.digest` (no new
 * extraction), and emits two surfaces:
 *
 *   - `renderPreviewSendResult(...)` — pi-tui Text component for renderResult
 *   - `previewSendMarkdown(...)`     — Markdown string for slash panels / reports
 *
 * The LLM-facing `content[0].text` is unchanged; this module only adds
 * visual rendering for the human watching the tool row.
 */

import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TraceDigest, VariableChangeDigest } from "../preview/trace-digest.ts";
import {
  fmtMs,
  rowDetail,
  rowSubRow,
  stepLabel,
  styleForStep,
  visibleWidth,
  padRightVisible,
  clipLine,
} from "./shared.ts";

// ─── Result shape we expect in `details` from preview-tool.ts ────────────────

export interface PreviewSendDetails {
  ok?: boolean;
  agent_response?: string;
  topic?: string;
  invoked_actions?: string[];
  latency_ms?: number;
  plan_id?: string;
  trace_file?: string;
  digest?: TraceDigest;
  apex_debug_log?: unknown;
}

interface SendArgs {
  action?: string;
  agent_name?: string;
  session_id?: string;
  message?: string;
}

// ─── renderCall: thin pre-result label ───────────────────────────────────────

export function renderPreviewCall(args: SendArgs, theme: Theme): Text {
  const label = theme.fg("toolTitle", theme.bold("🎬 Agent Script preview "));
  switch (args.action) {
    case "start":
      return new Text(label + theme.fg("muted", `start · ${args.agent_name ?? "?"}`), 0, 0);
    case "send": {
      const sid = args.session_id ? args.session_id.slice(0, 8) : "?";
      const utterance = args.message ? `"${clipLine(args.message, 60)}"` : "";
      return new Text(
        label + theme.fg("muted", `send · ${args.agent_name ?? "?"} · ${sid}…  ${utterance}`),
        0,
        0,
      );
    }
    case "end":
      return new Text(label + theme.fg("muted", `end · ${args.agent_name ?? "?"}`), 0, 0);
    case "trace":
      return new Text(label + theme.fg("muted", `trace · ${args.session_id ?? "?"}`), 0, 0);
    case "cleanup":
      return new Text(label + theme.fg("muted", "cleanup"), 0, 0);
    default:
      return new Text(label + theme.fg("muted", args.action ?? ""), 0, 0);
  }
}

// ─── renderResult: full timeline waterfall ───────────────────────────────────

interface RenderOpts {
  expanded?: boolean;
  isPartial?: boolean;
}

export function renderPreviewSendResult(
  result: { details?: PreviewSendDetails | unknown; content?: unknown[] },
  opts: RenderOpts,
  theme: Theme,
): Text {
  if (opts.isPartial) {
    return new Text(theme.fg("warning", "🎬 preview · streaming…"), 0, 0);
  }
  const details = (result.details ?? {}) as PreviewSendDetails;
  if (!details.ok) {
    // Error envelope — let the default text fallback show; render a tight
    // single line referencing what we know.
    const text = getFirstText(result.content) || "preview send failed";
    return new Text(theme.fg("error", `✗ ${text}`), 0, 0);
  }
  const digest = details.digest;
  if (!digest) {
    // Defensive: pre-digest result. Render the simple summary.
    const reply = details.agent_response ?? "(no response)";
    return new Text(
      `${theme.fg("success", "🤖 ")}${reply}\n${theme.fg(
        "dim",
        `plan=${(details.plan_id ?? "").slice(0, 8)}…`,
      )}`,
      0,
      0,
    );
  }
  return new Text(formatSendBody(digest, details, theme, /*ansi=*/ true), 0, 0);
}

// ─── Markdown emitter (slash-command panels, reports) ─────────────────────────

export function previewSendMarkdown(digest: TraceDigest, details: PreviewSendDetails): string {
  return formatSendBody(digest, details, undefined, /*ansi=*/ false);
}

// ─── Shared body formatter ───────────────────────────────────────────────────

function formatSendBody(
  digest: TraceDigest,
  details: PreviewSendDetails,
  theme: Theme | undefined,
  ansi: boolean,
): string {
  const fg = (token: Parameters<Theme["fg"]>[0], s: string): string =>
    theme ? theme.fg(token, s) : s;
  const bold = (s: string): string => (theme ? theme.bold(s) : `**${s}**`);
  const dim = (s: string): string => fg("dim", s);
  const accent = (s: string): string => fg("accent", s);
  const ok = (s: string): string => fg("success", s);
  const err = (s: string): string => fg("error", s);

  const lines: string[] = [];

  // Header line: 🎬 session  ·  topic  ·  latency
  const sid = (details.plan_id ?? digest.turn.plan_id ?? "").slice(0, 8);
  const totalMs = digest.turn.latency_ms ?? details.latency_ms;
  const headerBits: string[] = [bold(`🎬 ${digest.turn.topic ?? "(no topic)"}`)];
  if (sid) headerBits.push(dim(`plan=${sid}…`));
  if (typeof totalMs === "number") headerBits.push(dim(fmtMs(totalMs)));
  lines.push(headerBits.join("  "));

  // User input + agent response cards
  if (digest.turn.user_input) {
    lines.push("");
    lines.push(`${accent("👤")} ${dim(`"${clipLine(digest.turn.user_input, 200)}"`)}`);
  }
  if (digest.turn.agent_response) {
    lines.push("");
    lines.push(`${ok("🤖")} ${digest.turn.agent_response}`);
  }

  if (digest.variable_changes && digest.variable_changes.length > 0) {
    lines.push("");
    lines.push(`${accent("🧬 changed")} ${dim(formatVariableChanges(digest.variable_changes))}`);
  }

  if (digest.state_variables && Object.keys(digest.state_variables).length > 0) {
    lines.push("");
    const entries = selectStateEntries(digest.state_variables)
      .slice(0, 10)
      .map(([key, value]) => `${key}=${clipLine(String(value), 80)}`);
    lines.push(`${accent("🧪 state snapshot")} ${dim(entries.join(", "))}`);
  }

  // Timeline header
  lines.push("");
  const rowsToRender = compactTimelineRows(digest.timeline);
  const hiddenRows = digest.timeline.length - rowsToRender.length;
  const header =
    hiddenRows > 0
      ? `─── Timeline (${rowsToRender.length} shown, ${hiddenRows} internal hidden) ───`
      : "─── Timeline ───";
  lines.push(dim(ansi ? header : `**${header.replaceAll("─", "").trim()}**`));

  // Timeline rows. `row.ms` is the per-step duration, so we accumulate to
  // get a virtual clock. The first row sits at t+0; subsequent offsets are
  // the running sum of preceding durations. Rows without a `ms` value
  // contribute 0 to the clock but still get a relative label so the order
  // stays scannable.
  const widestLabel = rowsToRender.reduce((max, row) => {
    const lbl = stepLabel(row.t);
    return Math.max(max, visibleWidth(lbl));
  }, 0);
  let clock = 0;
  for (const row of rowsToRender) {
    const tStr = clock === 0 ? "+0ms" : `+${fmtMs(clock)}`;
    const tBlock = padRightVisible(dim(tStr), 8);
    const style = styleForStep(row.t);
    const glyph = ansi ? fg(style.color, style.glyph) : style.glyph;
    const label = padRightVisible(fg(style.color, stepLabel(row.t)), widestLabel + 2);
    const detail = rowDetail(row, theme);
    const main = `  ${tBlock} ${glyph}  ${label}${detail}`;
    lines.push(main);
    const sub = rowSubRow(row, theme);
    if (sub) lines.push(`  ${" ".repeat(8)}    ${sub}`);
    if (typeof row.ms === "number" && Number.isFinite(row.ms) && row.ms > 0) {
      clock += row.ms;
    }
  }

  // Per-step errors block
  if (digest.errors.length > 0) {
    lines.push("");
    lines.push(err(ansi ? "─── Errors ───" : "**Errors**"));
    for (const e of digest.errors) {
      const where = typeof e.step === "number" ? `step ${e.step}` : (e.type ?? "?");
      lines.push(`  ${err("⚠")}  ${dim(where)}  ${clipLine(e.message, 200)}`);
    }
  }

  // Stats footer
  lines.push("");
  lines.push(dim(ansi ? "─── Stats ───" : "**Stats**"));
  const stats = digest.stats;
  const internalVarRows = digest.timeline.filter(isInternalVariableRow).length;
  const statsBits = [
    `${ok(`${stats.step_count} step${stats.step_count === 1 ? "" : "s"} raw`)}`,
    hiddenRows > 0 ? `${ok(`${rowsToRender.length} shown`)}` : null,
    `${ok(`${stats.llm_calls} LLM call${stats.llm_calls === 1 ? "" : "s"}`)}`,
    stats.function_calls > 0
      ? `${ok(`${stats.function_calls} fn call${stats.function_calls === 1 ? "" : "s"}`)}`
      : null,
    stats.vars_updated > 0
      ? `${ok(`${stats.vars_updated} var update${stats.vars_updated === 1 ? "" : "s"}`)}${
          internalVarRows > 0 ? dim(` (${internalVarRows} internal hidden)`) : ""
        }`
      : null,
    stats.topic_changes > 0
      ? `${ok(`${stats.topic_changes} transition${stats.topic_changes === 1 ? "" : "s"}`)}`
      : null,
    stats.errors > 0 ? `${err(`${stats.errors} error${stats.errors === 1 ? "" : "s"}`)}` : null,
  ].filter(Boolean) as string[];
  lines.push(`  ${statsBits.join(" · ")}`);

  // Footer: trace file + drill hint
  lines.push("");
  if (digest.turn.trace_file ?? details.trace_file) {
    lines.push(dim(`📄 trace_file: ${digest.turn.trace_file ?? details.trace_file}`));
  }
  if (digest.notes && digest.notes.length > 0) {
    for (const n of digest.notes) {
      // Notes are informational (e.g. "production-v1 endpoint has no
      // per-step trace") — not warnings. Render in dim gray.
      lines.push(dim(`ⓘ ${n}`));
    }
  }
  if (sid && digest.turn.plan_id) {
    lines.push(
      `${fg("accent", "💡 Drill:")} ${fg("mdCode", `agentscript_preview trace plan_id=${digest.turn.plan_id}`)}`,
    );
  }

  return lines.join("\n");
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function formatVariableChanges(changes: VariableChangeDigest[]): string {
  return changes
    .slice(0, 8)
    .map((change) => {
      const value = change.value_preview ?? "?";
      const previous = change.previous_value_preview;
      const rendered = previous === undefined ? value : `${previous} → ${value}`;
      return `${change.name}=${clipLine(rendered, 80)}`;
    })
    .concat(changes.length > 8 ? [`+${changes.length - 8} more`] : [])
    .join(", ");
}

function selectStateEntries(vars: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(vars).filter(([key]) => !isInternalVariableName(key));
}

function compactTimelineRows(rows: TraceDigest["timeline"]): TraceDigest["timeline"] {
  return rows.filter((row) => !isInternalVariableRow(row));
}

function isInternalVariableRow(row: TraceDigest["timeline"][number]): boolean {
  return (
    row.t === "VariableUpdateStep" && (row.internal === true || isInternalVariableName(row.var))
  );
}

function isInternalVariableName(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value.startsWith("__") || value.startsWith("AgentScriptInternal_"))
  );
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
