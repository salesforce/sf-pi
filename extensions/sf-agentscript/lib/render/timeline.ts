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
import type {
  ActionValuePreview,
  TraceDigest,
  VariableChangeDigest,
} from "../preview/trace-digest.ts";
import { fmtMs, stepLabel, styleForStep, padRightVisible, clipLine } from "./shared.ts";

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
  const code = (s: string): string => fg("mdCode", s);

  const lines: string[] = [];
  const sid = (details.plan_id ?? digest.turn.plan_id ?? "").slice(0, 8);
  const totalMs = digest.turn.latency_ms ?? details.latency_ms;
  const headerBits: string[] = [bold("🎬 Preview Trace Report")];
  if (digest.turn.topic) headerBits.push(accent(digest.turn.topic));
  if (typeof totalMs === "number") headerBits.push(dim(fmtMs(totalMs)));
  if (sid) headerBits.push(dim(`plan=${sid}…`));
  lines.push(headerBits.join(" · "));

  lines.push("");
  lines.push(sectionTitle("🧾", "Turn Summary", ansi, dim));
  if (digest.turn.user_input) {
    lines.push(sectionRow("👤", "User", `"${clipLine(digest.turn.user_input, 200)}"`, theme));
  }
  if (digest.turn.agent_response) {
    lines.push(sectionRow("🤖", "Agent", clipLine(digest.turn.agent_response, 260), theme));
  }
  const outcome = formatOutcome(digest);
  if (outcome)
    lines.push(sectionRow(outcome.startsWith("⚠") ? "⚠" : "✅", "Outcome", outcome, theme));

  const route = routePath(digest);
  if (route.length > 0) {
    lines.push("");
    lines.push(sectionTitle("🧭", "Route Path", ansi, dim));
    for (const item of route) lines.push(`  ${fg("success", "🔀")} ${code(item)}`);
  }

  if (digest.variable_changes && digest.variable_changes.length > 0) {
    lines.push("");
    lines.push(sectionTitle("🧬", "State Changes", ansi, dim));
    for (const change of digest.variable_changes.slice(0, 10)) {
      lines.push(sectionRow("📦", change.name, formatVariableChange(change), theme));
    }
    if (digest.variable_changes.length > 10) {
      lines.push(`  ${dim(`👁 +${digest.variable_changes.length - 10} more changes in trace`)}`);
    }
  }

  if (digest.state_variables && Object.keys(digest.state_variables).length > 0) {
    lines.push("");
    lines.push(sectionTitle("🧪", "Key State Snapshot", ansi, dim));
    const entries = selectStateEntries(digest.state_variables).slice(0, 8);
    for (const [key, value] of entries) {
      lines.push(sectionRow(iconForStateKey(key), key, formatStateValue(value), theme));
    }
    const visibleCount = selectStateEntries(digest.state_variables).length;
    if (visibleCount > entries.length) {
      lines.push(`  ${dim(`👁 +${visibleCount - entries.length} more visible vars in trace`)}`);
    }
  }

  const toolActivity = digest.tool_activity;
  if (toolActivity?.enabled?.length || toolActivity?.called?.length) {
    lines.push("");
    lines.push(sectionTitle("🛠", "Tool Activity", ansi, dim));
    const enabledTools = unique(toolActivity.enabled?.flatMap((item) => item.tools) ?? []);
    if (enabledTools.length > 0) {
      lines.push(sectionRow("🧰", "enabled", formatList(enabledTools, 6), theme));
    }
    const called = toolActivity.called ?? [];
    lines.push(
      sectionRow(
        "🛠",
        "called",
        called.length
          ? formatList(
              called.map((call) => call.name),
              6,
            )
          : "none",
        theme,
      ),
    );
  }

  if (toolActivity?.called?.length) {
    lines.push("");
    lines.push(sectionTitle("🛠", "Action I/O Appendix", ansi, dim));
    for (const call of toolActivity.called.slice(0, 4)) {
      const status = call.has_output === false ? "no output" : "output captured";
      const latency = typeof call.latency_ms === "number" ? ` · ${fmtMs(call.latency_ms)}` : "";
      lines.push(
        `  ${fg("toolTitle", "🛠")} ${code(call.name)}${dim(latency)} ${dim(`· ${status}`)}`,
      );
      appendActionValue(lines, "input", call.input, theme);
      appendActionValue(lines, "output", call.output, theme);
    }
    if (toolActivity.called.length > 4) {
      lines.push(`  ${dim(`👁 +${toolActivity.called.length - 4} more action calls in trace`)}`);
    }
  }

  lines.push("");
  lines.push(sectionTitle("⏱", timelineHeader(digest), ansi, dim));
  appendTimeline(lines, digest, theme, ansi);

  const evaluations = evaluationRows(digest);
  if (evaluations.length > 0) {
    lines.push("");
    lines.push(sectionTitle("🛡", "Evaluations", ansi, dim));
    for (const item of evaluations)
      lines.push(sectionRow(item.icon, item.label, item.value, theme));
  }

  if (digest.diagnostics && digest.diagnostics.length > 0) {
    lines.push("");
    lines.push(sectionTitle("🧯", "Diagnostics", ansi, dim));
    for (const finding of digest.diagnostics) {
      const glyph =
        finding.severity === "error"
          ? err("⚠")
          : finding.severity === "warning"
            ? fg("warning", "⚠")
            : dim("ⓘ");
      const where = typeof finding.step === "number" ? dim(`step ${finding.step} · `) : "";
      lines.push(`  ${glyph} ${where}${clipLine(finding.message, 180)}`);
    }
  }

  if (digest.errors.length > 0) {
    lines.push("");
    lines.push(sectionTitle("⚠", "Errors", ansi, err));
    for (const e of digest.errors) {
      const where = typeof e.step === "number" ? `step ${e.step}` : (e.type ?? "?");
      lines.push(`  ${err("⚠")} ${dim(where)} ${clipLine(e.message, 200)}`);
    }
  }

  lines.push("");
  lines.push(sectionTitle("📊", "Stats", ansi, dim));
  const stats = digest.stats;
  const rowsToRender = compactTimelineRows(digest.timeline);
  const hiddenRows = digest.timeline.length - rowsToRender.length;
  const internalVarRows = digest.timeline.filter(isInternalVariableRow).length;
  const statsBits = [
    `${ok(`${stats.step_count} step${stats.step_count === 1 ? "" : "s"} raw`)}`,
    hiddenRows > 0 ? `${ok(`${rowsToRender.length} shown`)}` : null,
    `${ok(`${stats.llm_calls} LLM call${stats.llm_calls === 1 ? "" : "s"}`)}`,
    stats.function_calls > 0
      ? `${ok(`${stats.function_calls} action${stats.function_calls === 1 ? "" : "s"}`)}`
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

  lines.push("");
  lines.push(sectionTitle("🔎", "Drill", ansi, dim));
  if (digest.turn.trace_file ?? details.trace_file) {
    const tracePath = digest.turn.trace_file ?? details.trace_file ?? "";
    lines.push(sectionRow("📄", "trace_file", shortenPath(tracePath), theme));
  }
  if (digest.notes && digest.notes.length > 0) {
    for (const n of digest.notes) lines.push(`  ${dim(`ⓘ ${n}`)}`);
  }
  if (sid && digest.turn.plan_id) {
    lines.push(
      sectionRow(
        "💡",
        "trace",
        code(`agentscript_preview trace plan_id=${digest.turn.plan_id}`),
        theme,
      ),
    );
  }

  return lines.join("\n");
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function sectionTitle(
  icon: string,
  label: string,
  ansi: boolean,
  dim: (s: string) => string,
): string {
  return dim(ansi ? `─── ${icon} ${label} ───` : `**${icon} ${label}**`);
}

function sectionRow(icon: string, label: string, value: string, theme?: Theme): string {
  const key = theme ? theme.fg("mdCode", padRightVisible(label, 16)) : padRightVisible(label, 16);
  return `  ${icon} ${key} ${value}`;
}

function formatOutcome(digest: TraceDigest): string | null {
  const response = [...digest.timeline].reverse().find((row) => row.t === "PlannerResponseStep");
  const responseType =
    typeof response?.response_type === "string" ? response.response_type : undefined;
  const safe = response?.is_content_safe;
  const parts: string[] = [];
  if (responseType) parts.push(responseType);
  if (safe === true) parts.push("safety pass");
  else if (safe === false) parts.push("⚠ safety failed");
  const guardrail = [...digest.timeline].reverse().find((row) => /guardrail/i.test(row.t));
  if (guardrail) parts.push("guardrails observed");
  else if (digest.stats.errors === 0) parts.push("no trace errors");
  return parts.length > 0 ? parts.join(" · ") : null;
}

function routePath(digest: TraceDigest): string[] {
  if (digest.route_path && digest.route_path.length > 0) {
    return digest.route_path
      .map((item) => {
        if (item.from && item.to) return `${item.from} → ${item.to}`;
        return item.to ?? item.from ?? "";
      })
      .filter(Boolean);
  }
  if (digest.turn.topic_changed_from && digest.turn.topic) {
    return [`${digest.turn.topic_changed_from} → ${digest.turn.topic}`];
  }
  return digest.turn.topic ? [digest.turn.topic] : [];
}

function formatVariableChange(change: VariableChangeDigest): string {
  const next = change.value_preview ?? "?";
  const previous = change.previous_value_preview;
  const rendered = previous === undefined ? next : `${previous} → ${next}`;
  return clipLine(rendered, 120);
}

function selectStateEntries(vars: Record<string, unknown>): Array<[string, unknown]> {
  const changed = new Set<string>();
  // This function is intentionally generic. Agent-specific prioritization
  // belongs in the trace/digest source, not hardcoded into the renderer.
  const visible = Object.entries(vars).filter(([key]) => !isInternalVariableName(key));
  return visible.filter(([key]) => !changed.has(key));
}

function iconForStateKey(key: string): string {
  if (/verified|auth|check|permission/i.test(key)) return "🔐";
  if (/email|sms|phone|delivery|channel/i.test(key)) return "✉️";
  if (/count|attempt|number|total/i.test(key)) return "🔢";
  if (/ready|enabled|active|done|completed/i.test(key)) return "⚙️";
  return "📦";
}

function formatStateValue(value: unknown): string {
  if (typeof value === "string") return clipLine(shortenIdentifier(value), 120);
  return clipLine(JSON.stringify(value ?? null), 120);
}

function shortenIdentifier(value: string): string {
  if (/^[a-zA-Z0-9]{15,18}$/.test(value)) return `${value.slice(0, 3)}…${value.slice(-3)}`;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return `${value.slice(0, 8)}…`;
  return value;
}

function formatList(values: string[], max: number): string {
  const shown = values.slice(0, max);
  return `${shown.join(", ")}${values.length > max ? `, +${values.length - max} more` : ""}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function appendActionValue(
  lines: string[],
  label: "input" | "output",
  value: ActionValuePreview | undefined,
  theme?: Theme,
): void {
  const dim = (s: string) => (theme ? theme.fg("dim", s) : s);
  const code = (s: string) => (theme ? theme.fg("mdCode", s) : s);
  if (!value || value.fields.length === 0) {
    lines.push(`      ${dim(label)} ${dim("(none captured)")}`);
    return;
  }
  lines.push(`      ${dim(label)}`);
  for (const field of value.fields.slice(0, 12)) {
    const suffix = field.redacted ? dim(" redacted") : "";
    lines.push(`        ${code(padRightVisible(field.path, 28))} ${field.value_preview}${suffix}`);
  }
  const omitted = (value.omitted_fields ?? 0) + Math.max(0, value.fields.length - 12);
  if (omitted > 0) lines.push(`        ${dim(`… ${omitted} more field/path previews in trace`)}`);
}

function evaluationRows(
  digest: TraceDigest,
): Array<{ icon: string; label: string; value: string }> {
  const rows: Array<{ icon: string; label: string; value: string }> = [];
  const response = [...digest.timeline].reverse().find((row) => row.t === "PlannerResponseStep");
  if (response) {
    if (response.is_content_safe === true) {
      rows.push({ icon: "✅", label: "response safety", value: "pass" });
    } else if (response.is_content_safe === false) {
      rows.push({ icon: "⚠", label: "response safety", value: "failed" });
    }
    if (typeof response.safety_score === "number") {
      rows.push({ icon: "📈", label: "safety score", value: response.safety_score.toFixed(3) });
    }
  }
  const outputEval = digest.timeline.find((row) => row.t === "OutputEvaluationStep");
  if (outputEval) {
    rows.push({ icon: "🧪", label: "output eval", value: "observed" });
  }
  const guardrails = digest.timeline.filter((row) => /guardrail/i.test(row.t));
  if (guardrails.length > 0) {
    rows.push({
      icon: "🛡",
      label: "guardrails",
      value: `${guardrails.length} step${guardrails.length === 1 ? "" : "s"} observed`,
    });
  }
  return rows;
}

function timelineHeader(digest: TraceDigest): string {
  const rowsToRender = compactTimelineRows(digest.timeline);
  const hiddenRows = digest.timeline.length - rowsToRender.length;
  return hiddenRows > 0
    ? `Planner Timeline (${rowsToRender.length} shown, ${hiddenRows} internal hidden)`
    : "Planner Timeline";
}

function appendTimeline(
  lines: string[],
  digest: TraceDigest,
  theme: Theme | undefined,
  ansi: boolean,
): void {
  const rows = compactTimelineRows(digest.timeline);
  const dim = (s: string) => (theme ? theme.fg("dim", s) : s);
  const fg = (token: Parameters<Theme["fg"]>[0], s: string): string =>
    theme ? theme.fg(token, s) : s;
  const widths = { time: 8, step: 18, actor: 20 };
  lines.push(
    `  ${dim(padRightVisible("Time", widths.time))} ${dim(padRightVisible("Step", widths.step))} ${dim(
      padRightVisible("Actor/Scope", widths.actor),
    )} ${dim("Details")}`,
  );
  let clock = 0;
  for (const row of rows) {
    const tStr = clock === 0 ? "+0ms" : `+${fmtMs(clock)}`;
    const style = styleForStep(row.t);
    const labelText = `${ansi ? style.glyph : style.glyph} ${stepLabel(row.t)}`;
    const label = fg(style.color, padRightVisible(labelText, widths.step));
    const cells = timelineCells(row);
    lines.push(
      `  ${dim(padRightVisible(tStr, widths.time))} ${label} ${padRightVisible(cells.actor, widths.actor)} ${cells.details}`,
    );
    if (typeof row.ms === "number" && Number.isFinite(row.ms) && row.ms > 0) clock += row.ms;
  }
}

function timelineCells(row: TraceDigest["timeline"][number]): { actor: string; details: string } {
  switch (row.t) {
    case "UserInputStep":
      return { actor: "—", details: typeof row.user === "string" ? `"${row.user}"` : "" };
    case "SessionInitialStateStep": {
      const directive =
        typeof row.directive_context === "string" ? row.directive_context : "on_message";
      const vars = typeof row.vars === "number" ? `${row.vars} vars seeded` : "";
      return { actor: directive, details: vars };
    }
    case "NodeEntryStateStep":
      return { actor: typeof row.node === "string" ? row.node : "—", details: "—" };
    case "BeforeReasoningStep":
    case "BeforeReasoningIterationStep":
    case "AfterReasoningStep":
    case "ReasoningStep":
      return { actor: typeof row.agent === "string" ? row.agent : "—", details: "—" };
    case "UpdateTopicStep":
      return { actor: typeof row.topic === "string" ? row.topic : "—", details: "—" };
    case "TransitionStep":
      return {
        actor: typeof row.from === "string" ? row.from : "—",
        details: typeof row.to === "string" ? `→ ${row.to}` : "—",
      };
    case "EnabledToolsStep": {
      const tools = Array.isArray(row.tools) ? (row.tools as string[]) : [];
      return {
        actor: typeof row.agent === "string" ? row.agent : "—",
        details: tools.length ? formatList(tools, 4) : "—",
      };
    }
    case "LLMStep":
    case "LLMExecutionStep": {
      const prompt =
        typeof row.prompt_chars === "number"
          ? `${Math.round(row.prompt_chars / 100) / 10}k prompt`
          : "prompt ?";
      const response =
        typeof row.response_chars === "number"
          ? `${row.response_chars} response chars`
          : "response ?";
      const calls = Array.isArray(row.tool_calls)
        ? ` · calls ${(row.tool_calls as string[]).join(", ")}`
        : "";
      return {
        actor: typeof row.agent === "string" ? row.agent : "—",
        details: `${prompt} → ${response}${calls}`,
      };
    }
    case "FunctionStep":
    case "FunctionCallStep":
      return {
        actor: typeof row.fn === "string" ? row.fn : "(unknown)",
        details: row.has_output === true ? "output captured" : "no output captured",
      };
    case "VariableUpdateStep":
      return {
        actor: typeof row.var === "string" ? row.var : "(unknown)",
        details: typeof row.value_preview === "string" ? row.value_preview : "?",
      };
    case "PlannerResponseStep": {
      const parts: string[] = [];
      if (typeof row.response_type === "string") parts.push(row.response_type);
      if (row.is_content_safe === true) parts.push("safe ✓");
      else if (row.is_content_safe === false) parts.push("unsafe ⚠");
      if (typeof row.response_chars === "number") parts.push(`${row.response_chars} chars`);
      return {
        actor: typeof row.response_type === "string" ? row.response_type : "—",
        details: parts.join(" · "),
      };
    }
    default:
      return { actor: "—", details: typeof row.hint === "string" ? clipLine(row.hint, 100) : "—" };
  }
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

function shortenPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 4) return path;
  return `…/${parts.slice(-4).join("/")}`;
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
