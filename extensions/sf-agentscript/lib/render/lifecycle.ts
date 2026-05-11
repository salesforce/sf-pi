/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Lifecycle (publish/activate/deactivate/list_versions) renderer.
 *
 * publish: a step checklist with measured durations + Studio deep-link.
 * list_versions: a clean version table with Active highlighted.
 * activate / deactivate: single-line status flip.
 */

import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { padRightVisible, visibleWidth } from "./shared.ts";

interface AuthoringBundleResult {
  full_name?: string;
  target?: string;
  created?: boolean;
  error?: string;
}

export interface PublishDetails {
  ok?: boolean;
  agent_api_name?: string;
  bot_id?: string;
  bot_version_id?: string;
  version_developer_name?: string;
  was_new_agent?: boolean;
  activated?: boolean;
  authoring_bundle?: AuthoringBundleResult | null;
  /** Studio URL — populated when we can derive it from the connection. */
  studio_url?: string;
  /** Pre-flight findings (action targets, etc.). */
  preflight?: {
    actions_inspected?: number;
    missing_action_targets?: Array<{
      name: string;
      target: string;
      scheme: string;
      ref_name: string;
      detail: string;
      /** Human-readable metadata type label (e.g. "Flow", "ApexClass"). */
      metadata_label?: string;
    }>;
    skipped?: string;
  };
}

export interface VersionRow {
  bot_version_id: string;
  version_number: number;
  status: string;
  created_date?: string;
  developer_name?: string;
}

export interface ListVersionsDetails {
  ok?: boolean;
  agent_api_name?: string;
  bot_id?: string;
  versions?: VersionRow[];
}

export interface ActivateDetails {
  ok?: boolean;
  agent_api_name?: string;
  bot_version_id?: string;
  version_number?: number;
  status?: string;
}

interface LifecycleArgs {
  action?: string;
  agent_file?: string;
  agent_api_name?: string;
  version?: number;
  activate?: boolean;
}

// ─── renderCall ───────────────────────────────────────────────────────────────

export function renderLifecycleCall(args: LifecycleArgs, theme: Theme): Text {
  const label = theme.fg("toolTitle", theme.bold("🚀 Agent Script lifecycle "));
  const action = args.action ?? "?";
  let summary = action;
  switch (action) {
    case "publish":
      summary = `publish · ${args.agent_file ?? "?"}${args.activate ? " (+activate)" : ""}`;
      break;
    case "activate":
    case "deactivate":
      summary = `${action} · ${args.agent_api_name ?? "?"}${args.version ? ` v${args.version}` : ""}`;
      break;
    case "list_versions":
      summary = `list_versions · ${args.agent_api_name ?? "?"}`;
      break;
  }
  return new Text(label + theme.fg("muted", summary), 0, 0);
}

// ─── renderResult dispatch ────────────────────────────────────────────────────

export function renderLifecycleResult(
  result: { details?: unknown; content?: unknown[] },
  opts: { isPartial?: boolean; expanded?: boolean },
  theme: Theme,
): Text {
  if (opts.isPartial) return new Text(theme.fg("warning", "🚀 lifecycle · running…"), 0, 0);
  const details = (result.details ?? {}) as Record<string, unknown>;
  if (details.ok === false) {
    return new Text(
      theme.fg("error", `✗ ${getFirstText(result.content) || "lifecycle call failed"}`),
      0,
      0,
    );
  }
  // publish: has bot_version_id + was_new_agent
  if (details.bot_version_id !== undefined && details.was_new_agent !== undefined) {
    return new Text(formatPublishBody(details as PublishDetails, theme, /*ansi=*/ true), 0, 0);
  }
  // list_versions: has versions[]
  if (Array.isArray(details.versions)) {
    return new Text(
      formatVersionsTable(details as ListVersionsDetails, theme, /*ansi=*/ true),
      0,
      0,
    );
  }
  // activate / deactivate: has bot_version_id + status
  if (details.bot_version_id !== undefined && details.status !== undefined) {
    return new Text(formatActivateLine(details as ActivateDetails, theme, /*ansi=*/ true), 0, 0);
  }
  // Fallback to default text rendering.
  return new Text(getFirstText(result.content), 0, 0);
}

// ─── Markdown emitters ────────────────────────────────────────────────────────

export function publishMarkdown(details: PublishDetails): string {
  return formatPublishBody(details, undefined, /*ansi=*/ false);
}

export function versionsTableMarkdown(details: ListVersionsDetails): string {
  return formatVersionsTable(details, undefined, /*ansi=*/ false);
}

// ─── Body formatters ──────────────────────────────────────────────────────────

function formatPublishBody(
  details: PublishDetails,
  theme: Theme | undefined,
  ansi: boolean,
): string {
  const fg = (token: Parameters<Theme["fg"]>[0], s: string): string =>
    theme ? theme.fg(token, s) : s;
  const bold = (s: string): string => (theme ? theme.bold(s) : `**${s}**`);
  const dim = (s: string): string => fg("dim", s);
  const ok = (s: string): string => fg("success", s);
  const err = (s: string): string => fg("error", s);
  const code = (s: string): string => fg("mdCode", s);

  const lines: string[] = [];
  const header = bold(
    `🚀 Published ${code(details.agent_api_name ?? "?")} ${
      details.was_new_agent ? dim("(new agent)") : dim("(new version)")
    }`,
  );
  lines.push(header);
  lines.push("");
  lines.push(`  ${ok("✓")} Local + server compile clean`);

  const ab = details.authoring_bundle;
  if (ab) {
    if (ab.error) {
      lines.push(
        `  ${err("✗")} AiAuthoringBundle deploy failed ${dim(`— Studio will fall back to legacy builder`)}`,
      );
      lines.push(`     ${dim(ab.error.slice(0, 200))}`);
    } else {
      lines.push(
        `  ${ok("✓")} AiAuthoringBundle ${code(ab.full_name ?? "")} ${dim(`(target=${ab.target ?? "?"}, ${ab.created ? "created" : "updated"})`)}`,
      );
    }
  }

  if (details.activated) {
    // version_developer_name typically already starts with 'v' (e.g. 'v3'),
    // so we surface it as-is rather than prefixing another 'v'.
    const verLabel = details.version_developer_name ?? "?";
    lines.push(`  ${ok("✓")} Activated ${code(verLabel)}`);
  } else {
    lines.push(
      `  ${dim("·")} Not activated ${dim(`(set activate=true to chain publish + activate)`)}`,
    );
  }

  // Pre-flight: surface missing action targets as a clear card so the user
  // sees them on a successful publish (publish itself doesn't block on
  // these — the runtime will, but the heads-up here saves a round-trip).
  const missing = details.preflight?.missing_action_targets ?? [];
  if (missing.length > 0) {
    lines.push("");
    lines.push(
      `  ${err("⚠")}  ${bold(`${missing.length} action target(s) missing in org`)} ${dim("(preview will fail until deployed)")}`,
    );
    for (const m of missing.slice(0, 6)) {
      const badge = m.metadata_label ? dim(` [${m.metadata_label}]`) : "";
      lines.push(
        `     ${err("•")} ${code(m.name)}${badge}  ${dim(`→ ${m.scheme}://${m.ref_name}`)}`,
      );
    }
    if (missing.length > 6) {
      lines.push(
        `     ${dim(`…and ${missing.length - 6} more in details.preflight.missing_action_targets`)}`,
      );
    }
    lines.push(
      `  ${dim("deploy with")} ${code("sf project deploy start -m Flow:<X> -m ApexClass:<Y>")}`,
    );
  }

  if (details.studio_url) {
    lines.push("");
    lines.push(`  🪟 ${bold("Open in Studio:")} ${fg("mdLink", details.studio_url)}`);
  }

  lines.push("");
  const footerBits: string[] = [];
  if (details.bot_id) footerBits.push(dim(`bot_id=${details.bot_id}`));
  if (details.bot_version_id) footerBits.push(dim(`bot_version_id=${details.bot_version_id}`));
  if (footerBits.length > 0) lines.push("  " + footerBits.join("  "));

  void ansi;
  return lines.join("\n");
}

function formatVersionsTable(
  details: ListVersionsDetails,
  theme: Theme | undefined,
  ansi: boolean,
): string {
  const fg = (token: Parameters<Theme["fg"]>[0], s: string): string =>
    theme ? theme.fg(token, s) : s;
  const bold = (s: string): string => (theme ? theme.bold(s) : `**${s}**`);
  const dim = (s: string): string => fg("dim", s);
  const ok = (s: string): string => fg("success", s);
  const code = (s: string): string => fg("mdCode", s);

  const lines: string[] = [];
  lines.push(bold(`📚 Versions of ${code(details.agent_api_name ?? "?")}`));
  lines.push(dim(`bot_id ${details.bot_id ?? "?"}`));
  lines.push("");

  const versions = details.versions ?? [];
  // Sort by version_number desc — newest first.
  const sorted = [...versions].sort((a, b) => b.version_number - a.version_number);

  // Column widths
  const verW = 4;
  const statusW = sorted.reduce((m, v) => Math.max(m, visibleWidth(v.status)), 8);
  const nameW = sorted.reduce(
    (m, v) => Math.max(m, visibleWidth(v.developer_name ?? "")),
    visibleWidth("DeveloperName"),
  );

  // Header
  const hVer = padRightVisible(dim("v"), verW);
  const hStatus = padRightVisible(dim("Status"), statusW + 2);
  const hCreated = padRightVisible(dim("Created"), 22);
  const hName = padRightVisible(dim("DeveloperName"), nameW + 2);
  lines.push(`  ${hVer} ${hStatus} ${hCreated} ${hName}`);

  for (const v of sorted) {
    const isActive = v.status === "Active";
    const flag = isActive ? ok("●") : dim("·");
    const ver = padRightVisible(
      `${flag} ${isActive ? bold(`v${v.version_number}`) : `v${v.version_number}`}`,
      verW + 4,
    );
    const status = padRightVisible(isActive ? ok("Active") : dim("Inactive"), statusW + 2);
    const created = padRightVisible(
      dim(
        v.created_date ? new Date(v.created_date).toISOString().slice(0, 19).replace("T", " ") : "",
      ),
      22,
    );
    const name = padRightVisible(code(v.developer_name ?? ""), nameW + 2);
    lines.push(`  ${ver} ${status} ${created} ${name}`);
  }

  void ansi;
  return lines.join("\n");
}

function formatActivateLine(
  details: ActivateDetails,
  theme: Theme | undefined,
  _ansi: boolean,
): string {
  const fg = (token: Parameters<Theme["fg"]>[0], s: string): string =>
    theme ? theme.fg(token, s) : s;
  const bold = (s: string): string => (theme ? theme.bold(s) : `**${s}**`);
  const ok = (s: string): string => fg("success", s);
  const dim = (s: string): string => fg("dim", s);
  const code = (s: string): string => fg("mdCode", s);

  const isActive = details.status === "Active";
  const flag = isActive ? ok("● Active") : dim("○ Inactive");
  return `${bold("🚀")}  ${code(details.agent_api_name ?? "?")} ${code(`v${details.version_number ?? "?"}`)} → ${flag}`;
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
