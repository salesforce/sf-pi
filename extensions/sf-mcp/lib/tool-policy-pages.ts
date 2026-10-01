/* SPDX-License-Identifier: Apache-2.0 */
/** Pure Manager pages for reviewed per-tool MCP exposure policy. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { McpPreset } from "./presets.ts";
import type { McpToolDetail } from "./tool-catalog.ts";
import {
  exposureLabel,
  profileLabel,
  toolPolicyWarnings,
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
  lines.push(` ${t.fg("dim", "↑/↓ choose · Enter review tools · Esc overview")}`);
  return lines;
}

export function renderToolPolicyPage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  policy: ToolExposurePolicy;
  tools: readonly McpToolDetail[];
  cursor: number;
}): string[] {
  const { theme: t, width, policy } = input;
  const tools = input.tools.filter((tool) => tool.documented);
  const windowSize = 10;
  const start = Math.max(
    0,
    Math.min(input.cursor - Math.floor(windowSize / 2), tools.length - windowSize),
  );
  const end = Math.min(tools.length, start + windowSize);
  const warnings = toolPolicyWarnings(input.preset, policy);
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Tool Exposure Policy`))}`,
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "PROFILE")}  ${t.fg("text", profileLabel(policy.profile).toUpperCase())}`,
    ` ${t.fg("dim", `Showing ${start + 1}–${end} of ${tools.length} reviewed tools`)}`,
    ...wrapText(
      "Hidden: off · Code Mode: callable from scripts · Deferred: loaded by tool search · Direct: always declared",
      Math.max(24, width - 2),
    ).map((line) => ` ${t.fg("dim", line)}`),
    "",
  ];
  for (let index = start; index < end; index++) {
    const tool = tools[index];
    if (!tool) continue;
    const selected = index === input.cursor;
    const unavailable = policy.unavailable.includes(tool.name);
    const exposure = policy.exposures[tool.name] ?? "hidden";
    const heading = `${selected ? "❯" : " "} ${tool.name}`;
    lines.push(
      ` ${selected ? t.fg("accent", t.bold(truncateToWidth(heading, Math.max(20, width - 2)))) : t.fg("text", truncateToWidth(heading, Math.max(20, width - 2)))}`,
    );
    lines.push(
      ...wrapText(
        `${tool.capability} · ${riskLabel(tool.risk)} risk · ${exposureLabel(exposure)}${unavailable ? " · unavailable (locked)" : ""}`,
        Math.max(24, width - 5),
      ).map((line) => `   ${t.fg(unavailable ? "warning" : selected ? "accent" : "text", line)}`),
    );
    if (selected) {
      lines.push(
        ...wrapText(tool.description, Math.max(24, width - 5)).map(
          (line) => `   ${t.fg("text", line)}`,
        ),
      );
      const warning = warnings.find((item) => item.startsWith(`${tool.name} `));
      if (warning) {
        lines.push(
          ...wrapText(warning, Math.max(24, width - 5)).map(
            (line) => `   ${t.fg("warning", `⚠ ${line}`)}`,
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
        Math.max(24, width - 3),
      ).map((line) => ` ${t.fg("warning", line)}`),
      "",
    );
  }
  lines.push(
    ...wrapText(
      "←/→ change exposure · ↑/↓ navigate · A review/continue · P profiles · Esc overview",
      Math.max(24, width - 2),
    ).map((line) => ` ${t.fg("dim", line)}`),
  );
  return lines;
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
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Tool Policy Review`))}`,
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
    `   ${renderButton(t, "Apply tool policy", input.selected === 0)}  ${renderButton(t, "Back", input.selected === 1)}`,
    "",
    ` ${t.fg("dim", "←/→ or ↑/↓ choose · Enter apply · Esc back")}`,
  );
  return lines;
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
