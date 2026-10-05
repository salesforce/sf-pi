/* SPDX-License-Identifier: Apache-2.0 */
/** Pure Manager pages for reviewed per-tool MCP exposure policy. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ManagedServerStatus } from "./managed-state.ts";
import type { McpPreset } from "./presets.ts";
import type { McpToolDetail } from "./tool-catalog.ts";
import type { ActiveToolConflict } from "./tool-conflicts.ts";
import {
  exposureLabel,
  profileLabel,
  toolPolicyWarnings,
  type ToolExposureMode,
  type ToolExposurePolicy,
  type ToolPolicyProfileOption,
} from "./tool-policy.ts";
import { wrapText } from "./panel-pages.ts";

export function renderToolProfilesPage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  options: readonly ToolPolicyProfileOption[];
  selected: number;
}): string[] {
  const { theme: t, width } = input;
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Tool Exposure Profiles`))}`,
    "",
    ...wrapText(
      "Choose a starting policy. No native configuration changes on this page.",
      Math.max(24, width - 2),
    ).map((line) => ` ${t.fg("muted", line)}`),
    "",
  ];
  for (let index = 0; index < input.options.length; index++) {
    const option = input.options[index];
    if (!option) continue;
    const selected = index === input.selected;
    lines.push(
      ` ${selected ? t.fg("accent", "❯") : " "} ${selected ? t.fg("accent", t.bold(option.label)) : t.fg("text", option.label)}`,
    );
    lines.push(
      ...wrapText(option.description, Math.max(24, width - 5)).map(
        (line) => `   ${t.fg("dim", line)}`,
      ),
      "",
    );
  }
  lines.push(` ${t.fg("dim", "↑/↓ choose · Enter use profile · Esc configuration")}`);
  return lines;
}

export function renderToolPolicyPage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  policy: ToolExposurePolicy;
  tools: readonly McpToolDetail[];
  cursor: number;
  connection?: { status: ManagedServerStatus; message?: string };
  conflicts?: readonly ActiveToolConflict[];
}): string[] {
  const { theme: t, width, policy } = input;
  const contentWidth = Math.max(24, width - 3);
  const tools = input.tools.filter((tool) => tool.documented);
  const windowSize = 8;
  const start = Math.max(
    0,
    Math.min(input.cursor - Math.floor(windowSize / 2), tools.length - windowSize),
  );
  const end = Math.min(tools.length, start + windowSize);
  const warnings = toolPolicyWarnings(input.preset, policy);
  const conflicts = input.conflicts ?? [];
  const conflictByTool = new Map(conflicts.map((conflict) => [conflict.toolName, conflict]));
  const counts = countExposures(policy);
  const available = tools.length - policy.unavailable.length;
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Tool Access`))}`,
    "",
  ];
  if (input.connection) {
    const status = connectionStatus(input.connection.status);
    lines.push(
      ` ${t.fg("accent", "▰")} ${t.fg("muted", "CONNECTION")}  ${t.fg(status.tone, t.bold(status.label))}`,
      `    Server ${t.fg("text", input.preset.serverName)}`,
      ...wrapText(connectionGuidance(input.connection.status), Math.max(24, contentWidth - 6)).map(
        (line) => `    ${t.fg("dim", line)}`,
      ),
    );
    if (input.connection.message) {
      lines.push(
        ...wrapText(input.connection.message, Math.max(24, contentWidth - 6)).map(
          (line) => `    ${t.fg("dim", line)}`,
        ),
      );
    }
    lines.push("");
  }
  lines.push(
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "TOOL ACCESS")}  ${t.fg("text", `${tools.length} reviewed · ${available} available`)}`,
    `    Profile ${t.fg("accent", t.bold(profileLabel(policy.profile).toUpperCase()))}  ${t.fg("dim", "· P change profile")}`,
    ...renderModeSummary(t, counts, contentWidth),
    `    ${t.fg("dim", `Showing ${start + 1}–${end} of ${tools.length} tools`)}`,
  );
  if (conflicts.length > 0) {
    const guidance =
      policy.profile === "recommended"
        ? "recommended modes applied"
        : "review highlighted conflicts before saving";
    lines.push(
      ...wrapText(
        `⚠ ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} annotated inline · ${guidance}`,
        Math.max(24, contentWidth - 4),
      ).map((line) => `    ${t.fg("warning", line)}`),
    );
  }
  lines.push("");

  for (let index = start; index < end; index++) {
    const tool = tools[index];
    if (!tool) continue;
    const selected = index === input.cursor;
    const unavailable = policy.unavailable.includes(tool.name);
    const exposure = policy.exposures[tool.name] ?? "hidden";
    const badgeText = exposureBadgeText(exposure);
    const heading = `${selected ? "❯" : " "} ${index + 1}. ${tool.name}`;
    const headingWidth = Math.max(18, contentWidth - visibleWidth(badgeText) - 3);
    const renderedHeading = truncateToWidth(heading, headingWidth);
    const gap = Math.max(
      2,
      contentWidth - visibleWidth(renderedHeading) - visibleWidth(badgeText) - 1,
    );
    lines.push(
      ` ${selected ? t.fg("accent", t.bold(renderedHeading)) : t.fg("text", renderedHeading)}${" ".repeat(gap)}${renderExposureBadge(t, exposure)}`,
    );
    const descriptionWidth = Math.max(24, contentWidth - 4);
    if (selected) {
      lines.push(
        ...wrapText(tool.description, descriptionWidth).map((line) => `    ${t.fg("text", line)}`),
      );
    } else {
      lines.push(`    ${t.fg("dim", truncateToWidth(tool.description, descriptionWidth))}`);
    }
    lines.push(
      ...wrapText(
        `Purpose: ${tool.capability} · Risk: ${riskLabel(tool.risk).toUpperCase()}${unavailable ? " · UNAVAILABLE (LOCKED)" : ""}`,
        descriptionWidth,
      ).map((line) => `    ${t.fg(unavailable ? "warning" : "muted", line)}`),
    );
    const conflict = conflictByTool.get(tool.name);
    if (conflict) {
      lines.push(
        ...wrapText(
          `⚠ overlaps ${conflict.owners.join(" · ")} · recommended ${exposureLabel(conflict.recommendedExposure)}`,
          descriptionWidth,
        ).map((line) => `    ${t.fg("warning", line)}`),
      );
    }
    if (selected) {
      const warning = warnings.find((item) => item.startsWith(`${tool.name} `));
      if (warning) {
        lines.push(
          ...wrapText(warning, descriptionWidth).map(
            (line) => `    ${t.fg("warning", `⚠ ${line}`)}`,
          ),
        );
      }
    }
    lines.push("");
  }
  if (policy.locked.length > 0) {
    lines.push(
      ...wrapText(
        `${policy.locked.length} observed unapproved tool(s) remain locked hidden: ${policy.locked.join(", ")}`,
        Math.max(24, contentWidth - 3),
      ).map((line) => ` ${t.fg("warning", line)}`),
      "",
    );
  }
  const selectedTool = tools[input.cursor];
  const selectedExposure = selectedTool
    ? (policy.exposures[selectedTool.name] ?? "hidden")
    : "hidden";
  lines.push(
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "SELECTED MODE")}`,
    ...wrapText(
      `${exposureLabel(selectedExposure)} — ${modeDescription(selectedExposure)}`,
      Math.max(24, contentWidth - 4),
    ).map((line) => `    ${t.fg("dim", line)}`),
    "",
    ...wrapText(
      "↑/↓ Select · ←/→ or Space Change mode · Enter Details · P Profiles · ? Mode help · S Review & Save · Esc Overview",
      Math.max(24, contentWidth - 1),
    ).map((line) => ` ${t.fg("accent", line)}`),
  );
  return lines;
}

export function renderToolModeHelpPage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
}): string[] {
  const { theme: t, width } = input;
  const contentWidth = Math.max(24, width - 3);
  return [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Tool Access Modes`))}`,
    "",
    ` ${t.fg("muted", "Choose the narrowest exposure that supports the intended workflow.")}`,
    "",
    ...renderModeGuidance(t, "hidden", modeDescription("hidden"), contentWidth),
    "",
    ...renderModeGuidance(t, "codemode", modeDescription("codemode"), contentWidth),
    "",
    ...renderModeGuidance(t, "deferred", modeDescription("deferred"), contentWidth),
    "",
    ...renderModeGuidance(t, "direct", modeDescription("direct"), contentWidth),
    "",
    ` ${t.fg("dim", "Enter/Esc back to tool access")}`,
  ];
}

export function renderToolPolicyReviewPage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  policy: ToolExposurePolicy;
  configDiff: readonly string[];
  selected: number;
}): string[] {
  const { theme: t, width, policy } = input;
  const counts = countExposures(policy);
  const warnings = toolPolicyWarnings(input.preset, policy);
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Review & Save`))}`,
    "",
    ` ${t.fg("muted", "Review the exact native MCP exposure change before applying it.")}`,
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "POLICY")}`,
    `    Profile            ${t.fg("text", profileLabel(policy.profile))}`,
    `    Hidden             ${t.fg("text", String(counts.hidden))}`,
    `    Code Mode          ${t.fg("text", String(counts.codemode))}`,
    `    Deferred           ${t.fg("text", String(counts.deferred))}`,
    `    Direct             ${t.fg("text", String(counts.direct))}`,
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "CHANGES")}`,
  ];
  if (input.configDiff.length === 0) {
    lines.push(`    ${t.fg("dim", "No native configuration fields would change.")}`);
  } else {
    lines.push(
      ...input.configDiff.flatMap((change) =>
        wrapText(change, Math.max(24, width - 8)).map((line) => `    ${t.fg("warning", line)}`),
      ),
    );
  }
  lines.push(
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "SAFETY")}`,
    `    ${t.fg("success", "✓")} Server default remains hidden`,
    `    ${t.fg("success", "✓")} Unapproved tools remain unreachable`,
    `    ${t.fg("success", "✓")} Salesforce permissions and Guardrail still apply`,
  );
  for (const warning of warnings) {
    lines.push(
      ...wrapText(warning, Math.max(24, width - 8)).map((line, index) =>
        index === 0 ? `    ${t.fg("warning", `⚠ ${line}`)}` : `      ${t.fg("warning", line)}`,
      ),
    );
  }
  lines.push(
    "",
    ` ${t.fg("muted", "Actions")}`,
    `   ${renderButton(t, "Save configuration", input.selected === 0)}  ${renderButton(t, "Back", input.selected === 1)}`,
    "",
    ` ${t.fg("dim", "←/→ or ↑/↓ choose · Enter save · Esc back")}`,
  );
  return lines;
}

function modeDescription(mode: ToolExposureMode): string {
  switch (mode) {
    case "codemode":
      return "Callable from codemode scripts; not declared directly.";
    case "deferred":
      return "Loaded on demand through tool search.";
    case "direct":
      return "Always declared to the model on every turn.";
    default:
      return "Off; the model cannot call this tool.";
  }
}

function renderModeGuidance(
  theme: Theme,
  mode: ToolExposureMode,
  description: string,
  contentWidth: number,
): string[] {
  const badge = renderExposureBadge(theme, mode);
  const prefix = `    ${badge}  `;
  const continuation = " ".repeat(4 + visibleWidth(exposureBadgeText(mode)) + 2);
  return wrapText(description, Math.max(20, contentWidth - visibleWidth(continuation))).map(
    (line, index) => `${index === 0 ? prefix : continuation}${theme.fg("dim", line)}`,
  );
}

function renderModeSummary(
  theme: Theme,
  counts: Record<ToolExposureMode, number>,
  contentWidth: number,
): string[] {
  const badges = (["hidden", "codemode", "deferred", "direct"] as const).map((mode) =>
    renderModeCount(theme, mode, counts[mode]),
  );
  const combined = `    ${badges.join("  ")}`;
  if (visibleWidth(combined) <= contentWidth) return [combined];
  return [`    ${badges.slice(0, 2).join("  ")}`, `    ${badges.slice(2).join("  ")}`];
}

function renderModeCount(theme: Theme, mode: ToolExposureMode, count: number): string {
  return theme.fg(exposureTone(mode), `[ ${exposureLabel(mode).toUpperCase()} ${count} ]`);
}

function renderExposureBadge(theme: Theme, mode: ToolExposureMode): string {
  return theme.fg(exposureTone(mode), theme.bold(exposureBadgeText(mode)));
}

function exposureBadgeText(mode: ToolExposureMode): string {
  return `[ ${exposureLabel(mode).toUpperCase()} ]`;
}

function exposureTone(mode: ToolExposureMode): "muted" | "accent" | "warning" | "error" {
  switch (mode) {
    case "codemode":
      return "accent";
    case "deferred":
      return "warning";
    case "direct":
      return "error";
    default:
      return "muted";
  }
}

function connectionStatus(status: ManagedServerStatus): {
  label: string;
  tone: "success" | "warning" | "error" | "muted";
} {
  switch (status) {
    case "managed-enabled":
      return { label: "ENABLED", tone: "success" };
    case "managed-disabled":
      return { label: "DISABLED", tone: "warning" };
    case "missing":
      return { label: "NOT CONFIGURED", tone: "warning" };
    case "invalid-config":
    case "name-conflict":
      return { label: status.replaceAll("-", " ").toUpperCase(), tone: "error" };
    default:
      return { label: status.replaceAll("-", " ").toUpperCase(), tone: "muted" };
  }
}

function connectionGuidance(status: ManagedServerStatus): string {
  if (status === "missing") return "Save continues to connection setup and final review.";
  if (status === "managed-enabled") return "Editing the current managed configuration.";
  if (status === "managed-disabled") return "Configuration is saved but the server is disabled.";
  return "Existing configuration requires review before replacement.";
}

function countExposures(
  policy: ToolExposurePolicy,
): Record<"hidden" | "codemode" | "deferred" | "direct", number> {
  const counts = { hidden: 0, codemode: 0, deferred: 0, direct: 0 };
  for (const exposure of Object.values(policy.exposures)) counts[exposure] += 1;
  return counts;
}

function riskLabel(risk: McpToolDetail["risk"]): string {
  return `${risk.slice(0, 1).toUpperCase()}${risk.slice(1)}`;
}

function renderButton(theme: Theme, label: string, selected: boolean): string {
  const text = `[ ${label} ]`;
  return selected ? theme.fg("accent", theme.bold(`❯ ${text}`)) : theme.fg("muted", `  ${text}`);
}
