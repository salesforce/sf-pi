/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Inspect (structure) renderer.
 *
 * Renders the navigable component graph as a tree with:
 *   - section icons per component type
 *   - line-number gutter (right-aligned)
 *   - cross-reference edges (→ uses @actions.X / @variables.X / @subagent.X)
 */

import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { padRightVisible, visibleWidth, clipLine } from "./shared.ts";

interface ComponentSummary {
  name: string;
  line?: number;
  description?: string;
  action_refs?: string[];
  subagent_refs?: string[];
  variable_refs?: string[];
  response_format_refs?: string[];
  utility_refs?: string[];
}

interface VariableSummary {
  name: string;
  type?: string;
  modifier?: string;
  mutable?: boolean;
  linked?: boolean;
  line?: number;
  default?: unknown;
  source?: string;
}

interface ConnectionSummary extends ComponentSummary {
  response_formats?: Array<{
    name: string;
    source?: string;
    target?: string;
    input_names?: string[];
  }>;
  response_actions?: string[];
}

interface ModalitySummary {
  name: string;
  line?: number;
  fields?: Record<string, unknown>;
}

export interface InspectStructureDetails {
  ok?: boolean;
  action?: string;
  path?: string;
  dialect?: { name?: string; version?: string };
  components?: {
    config?: Record<string, unknown>;
    system?: { instructions?: string };
    start_agents?: ComponentSummary[];
    topics: ComponentSummary[];
    subagents: ComponentSummary[];
    variables: VariableSummary[];
    actions: ComponentSummary[];
    connections?: ConnectionSummary[];
    modalities?: ModalitySummary[];
  };
  stats?: {
    start_agents?: number;
    topics?: number;
    subagents?: number;
    variables?: number;
    actions?: number;
    connections?: number;
    modalities?: number;
  };
  has_parse_errors?: boolean;
  parse_error_count?: number;
}

interface InspectArgs {
  action?: string;
  path?: string;
  symbol?: string;
}

// ─── renderCall ───────────────────────────────────────────────────────────────

export function renderInspectCall(args: InspectArgs, theme: Theme): Text {
  const label = theme.fg("toolTitle", theme.bold("🔍 Agent Script inspect "));
  const action = args.action ?? "structure";
  const summary =
    action === "structure"
      ? `${action} · ${args.path ?? "?"}`
      : `${action} · ${args.symbol ?? "?"} in ${args.path ?? "?"}`;
  return new Text(label + theme.fg("muted", summary), 0, 0);
}

// ─── renderResult ─────────────────────────────────────────────────────────────

export function renderInspectResult(
  result: { details?: InspectStructureDetails | unknown; content?: unknown[] },
  opts: { isPartial?: boolean; expanded?: boolean },
  theme: Theme,
): Text {
  if (opts.isPartial) return new Text(theme.fg("warning", "🔍 inspect · running…"), 0, 0);
  const details = (result.details ?? {}) as InspectStructureDetails;
  if (!details.ok) {
    return new Text(
      theme.fg("error", `✗ ${getFirstText(result.content) || "inspect failed"}`),
      0,
      0,
    );
  }
  if (details.action !== "structure") {
    // find_references / definition keep their existing summary rendering;
    // only structure gets the tree view in Phase 2.
    return new Text(getFirstText(result.content), 0, 0);
  }
  return new Text(formatStructureBody(details, theme, /*ansi=*/ true), 0, 0);
}

// ─── Markdown emitter ─────────────────────────────────────────────────────────

export function inspectStructureMarkdown(details: InspectStructureDetails): string {
  return formatStructureBody(details, undefined, /*ansi=*/ false);
}

// ─── Shared body formatter ────────────────────────────────────────────────────

function formatStructureBody(
  details: InspectStructureDetails,
  theme: Theme | undefined,
  ansi: boolean,
): string {
  const fg = (token: Parameters<Theme["fg"]>[0], s: string): string =>
    theme ? theme.fg(token, s) : s;
  const bold = (s: string): string => (theme ? theme.bold(s) : `**${s}**`);
  const dim = (s: string): string => fg("dim", s);
  const code = (s: string): string => fg("mdCode", s);
  const accent = (s: string): string => fg("accent", s);
  const heading = (s: string): string => fg("mdHeading", s);

  const lines: string[] = [];
  const components = details.components ?? {
    topics: [],
    subagents: [],
    variables: [],
    actions: [],
  };
  const stats = details.stats ?? {};
  const dialect = details.dialect
    ? `${details.dialect.name ?? ""}${details.dialect.version ? ` ${details.dialect.version}` : ""}`
    : "unknown";

  // Header
  const path = details.path ?? "?";
  const baseName = path.split("/").pop() ?? path;
  lines.push(bold(`📋 ${baseName}`) + "  " + dim(dialect));

  // System / config
  if (components.system) {
    const at = ""; // The current inspect doesn't return a line for system / config.
    lines.push(`  ${accent("🪪")} ${bold("system")}${at ? "  " + dim(at) : ""}`);
  }
  if (components.config && Object.keys(components.config).length > 0) {
    lines.push(`  ${accent("⚙ ")} ${bold("config")}`);
  }

  // Start agents
  if (components.start_agents && components.start_agents.length > 0) {
    lines.push(`  ${heading("🚦")} ${bold(`start_agents (${components.start_agents.length})`)}`);
    for (const s of components.start_agents) {
      const ln = s.line !== undefined ? dim(padRightVisible(`L${s.line}`, 5)) : dim("     ");
      const util = s.utility_refs?.length
        ? dim(` · utils ${s.utility_refs.map(code).join(", ")}`)
        : "";
      lines.push(`     ${ln} 🏁 ${code(s.name)}${util}`);
    }
  }

  // Topics
  if ((stats.topics ?? components.topics?.length ?? 0) > 0) {
    lines.push(`  ${heading("🗂 ")} ${bold(`topics (${components.topics.length})`)}`);
    const widestName = components.topics.reduce((m, t) => Math.max(m, visibleWidth(t.name)), 0);
    for (const t of components.topics) {
      const ln = t.line !== undefined ? dim(padRightVisible(`L${t.line}`, 5)) : dim("     ");
      const nm = padRightVisible(code(t.name), widestName + 2);
      const refsParts: string[] = [];
      if (t.subagent_refs?.length) refsParts.push(`→ ${t.subagent_refs.map(code).join(", ")}`);
      if (t.action_refs?.length) refsParts.push(`uses ${t.action_refs.map(code).join(", ")}`);
      if (t.variable_refs?.length) refsParts.push(`reads ${t.variable_refs.map(code).join(", ")}`);
      const desc = t.description ? dim(`— ${clipLine(t.description, 40)}`) : "";
      const refs = refsParts.length > 0 ? dim(refsParts.join("  ")) : desc;
      lines.push(`     ${ln} 📌 ${nm}${refs}`);
    }
  }

  // Subagents
  if (components.subagents.length > 0) {
    lines.push(`  ${heading("🤝")} ${bold(`subagents (${components.subagents.length})`)}`);
    for (const s of components.subagents) {
      const ln = s.line !== undefined ? dim(padRightVisible(`L${s.line}`, 5)) : dim("     ");
      lines.push(`     ${ln} 🤖 ${code(s.name)}`);
    }
  }

  // Actions
  if (components.actions.length > 0) {
    lines.push(`  ${heading("🔧")} ${bold(`actions (${components.actions.length})`)}`);
    for (const a of components.actions) {
      const ln = a.line !== undefined ? dim(padRightVisible(`L${a.line}`, 5)) : dim("     ");
      const util = a.utility_refs?.length
        ? dim(` · utils ${a.utility_refs.map(code).join(", ")}`)
        : "";
      lines.push(`     ${ln} ${code(a.name)}${util}`);
    }
  }

  // Connections / response formats
  if (components.connections && components.connections.length > 0) {
    lines.push(`  ${heading("🔌")} ${bold(`connections (${components.connections.length})`)}`);
    for (const c of components.connections) {
      const ln = c.line !== undefined ? dim(padRightVisible(`L${c.line}`, 5)) : dim("     ");
      const formats = c.response_formats?.length
        ? dim(` · formats ${c.response_formats.map((f) => code(f.name)).join(", ")}`)
        : "";
      lines.push(`     ${ln} ${code(c.name)}${formats}`);
    }
  }

  // Modalities (voice, etc.)
  if (components.modalities && components.modalities.length > 0) {
    lines.push(`  ${heading("🎙 ")} ${bold(`modalities (${components.modalities.length})`)}`);
    for (const m of components.modalities) {
      const ln = m.line !== undefined ? dim(padRightVisible(`L${m.line}`, 5)) : dim("     ");
      const fieldCount = m.fields ? Object.keys(m.fields).length : 0;
      lines.push(`     ${ln} ${code(m.name)} ${fieldCount ? dim(`(${fieldCount} field(s))`) : ""}`);
    }
  }

  // Variables
  if (components.variables.length > 0) {
    lines.push(`  ${heading("🪣")} ${bold(`variables (${components.variables.length})`)}`);
    for (const v of components.variables) {
      const ln = v.line !== undefined ? dim(padRightVisible(`L${v.line}`, 5)) : dim("     ");
      const modifier = v.modifier ?? (v.linked ? "linked" : v.mutable ? "mutable" : undefined);
      const flags = [v.type, modifier].filter(Boolean).join(", ");
      const tag = flags ? dim(`(${flags})`) : "";
      const source = v.source ? dim(` ← ${v.source}`) : "";
      lines.push(`     ${ln} ${code(v.name)} ${tag}${source}`);
    }
  }

  // Footer
  lines.push("");
  const refTotals = totalRefs(components.topics);
  const footerBits = [
    `${stats.start_agents ?? components.start_agents?.length ?? 0} start`,
    `${stats.topics ?? 0} topics`,
    `${stats.subagents ?? 0} subagents`,
    `${stats.actions ?? 0} actions`,
    `${stats.variables ?? 0} variables`,
    `${stats.connections ?? components.connections?.length ?? 0} connections`,
    `${stats.modalities ?? components.modalities?.length ?? 0} modalities`,
    refTotals > 0 ? `${refTotals} @-refs` : null,
  ].filter(Boolean) as string[];
  lines.push(dim(footerBits.join(" · ")));

  if (details.has_parse_errors) {
    lines.push("");
    lines.push(
      fg(
        "warning",
        `⚠ ${details.parse_error_count ?? 1} parse error(s) — run agentscript_compile first`,
      ),
    );
  }

  void ansi;
  return lines.join("\n");
}

function totalRefs(topics: ComponentSummary[]): number {
  let n = 0;
  for (const t of topics) {
    n += t.action_refs?.length ?? 0;
    n += t.subagent_refs?.length ?? 0;
    n += t.variable_refs?.length ?? 0;
  }
  return n;
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
