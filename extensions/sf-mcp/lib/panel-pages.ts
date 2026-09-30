/* SPDX-License-Identifier: Apache-2.0 */
/** Pure renderers for SF MCP's embedded Manager workflow pages. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ConflictPlan } from "./conflict-planner.ts";
import type { ManagedServerStatus } from "./managed-state.ts";
import type { McpServerConfig } from "./mcp-config.ts";
import type { McpPreset, McpResolution } from "./presets.ts";
import type { PresetRuntimeState } from "./service.ts";
import type { PresetSetupForm } from "./setup-form.ts";

export type ConflictOption = {
  label: string;
  description: string;
  resolution?: McpResolution;
};

export function renderCatalogPage(input: {
  theme: Theme;
  width: number;
  scope: "global" | "project";
  states: PresetRuntimeState[];
  cursor: number;
  message: string;
  messageTone: "success" | "warning" | "error";
}): string[] {
  const { theme: t, width } = input;
  const enabled = input.states.filter((state) => state.managed.status === "managed-enabled").length;
  const lines = [
    ` ${t.fg("accent", t.bold("☁  Salesforce MCPs"))}`,
    ` ${t.fg("dim", "Salesforce-published presets. Nothing connects until you explicitly enable it.")}`,
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", `${input.scope.toUpperCase()} SCOPE`)}  ${t.fg("dim", `· ${enabled}/${input.states.length} enabled · Pi native MCP`)}`,
    "",
  ];

  for (let index = 0; index < input.states.length; index++) {
    const state = input.states[index];
    if (!state) continue;
    const selected = index === input.cursor;
    const cursor = selected ? t.fg("accent", "❯") : " ";
    const label = selected
      ? t.fg("accent", t.bold(`${state.preset.icon}  ${state.preset.label}`))
      : t.fg("text", `${state.preset.icon}  ${state.preset.label}`);
    const status = renderStatus(t, state.managed.status, state.preset);
    const action = renderAction(t, state.managed.status);
    const left = ` ${cursor} ${label}`;
    const right = `${status}  ${action}`;
    const gap = Math.max(2, width - visibleWidth(left) - visibleWidth(right) - 1);
    lines.push(`${left}${" ".repeat(gap)}${right}`);
    lines.push(
      ...wrapText(state.preset.description, Math.max(24, width - 6)).map(
        (line) => `     ${t.fg("dim", line)}`,
      ),
    );
    if (selected) {
      lines.push(
        ...wrapText(selectedDetail(state), Math.max(24, width - 6)).map(
          (line) => `     ${t.fg("muted", line)}`,
        ),
      );
    }
    lines.push("");
  }

  if (input.message) {
    lines.push(
      ...wrapText(input.message, Math.max(24, width - 3)).map(
        (line) => ` ${t.fg(input.messageTone, line)}`,
      ),
    );
    lines.push("");
  }
  lines.push(
    ` ${t.fg("dim", "↑/↓ navigate · Enter/Space configure · D disable managed preset · Esc back")}`,
  );
  return lines;
}

export function renderConflictPage(input: {
  theme: Theme;
  width: number;
  source: McpPreset;
  plan: ConflictPlan;
  options: ConflictOption[];
  selected: number;
}): string[] {
  const { theme: t, width } = input;
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.source.label} › Capability Review`))}`,
    "",
    ` ${t.fg("warning", t.bold("⚠  Capability overlap detected"))}`,
    "",
  ];
  for (const conflict of input.plan.conflicts) {
    lines.push(
      ` ${t.fg("muted", `${conflict.relationship === "direct" ? "Direct" : "Partial"} overlap with ${conflict.nativeExtensionId}`)}`,
    );
    lines.push(
      ...wrapText(conflict.reason, Math.max(24, width - 5)).map(
        (line) => `   ${t.fg("dim", line)}`,
      ),
    );
    lines.push("");
  }
  lines.push(` ${t.fg("muted", "Resolution")}`, "");
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
    );
    lines.push("");
  }
  lines.push(` ${t.fg("dim", "↑/↓ choose · Enter continue · Esc catalog")}`);
  return lines;
}

export function renderSetupPage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  form: PresetSetupForm;
  focused: boolean;
}): string[] {
  return [
    ` ${input.theme.fg("accent", input.theme.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Setup`))}`,
    "",
    ` ${input.theme.fg("accent", input.theme.bold(`${input.preset.icon}  ${input.preset.label}`))}`,
    ...wrapText(input.preset.description, Math.max(24, input.width - 3)).map(
      (line) => ` ${input.theme.fg("dim", line)}`,
    ),
    "",
    ...input.form.renderContent(input.width, input.focused),
  ];
}

export function renderReviewPage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  scope: "global" | "project";
  configPath: string;
  runtime: PresetRuntimeState;
  config: McpServerConfig;
  resolution: McpResolution;
  selected: number;
}): string[] {
  const { theme: t, width } = input;
  const endpoint = describeTransport(input.config);
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Review`))}`,
    "",
    ` ${t.fg("muted", "Review the native Pi MCP configuration before applying it.")}`,
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "TARGET")}`,
    `    Scope              ${t.fg("text", input.scope)}`,
    ...wrapText(input.configPath, Math.max(24, width - 24)).map((line, index) =>
      index === 0
        ? `    File               ${t.fg("dim", line)}`
        : `                       ${t.fg("dim", line)}`,
    ),
    `    Server name        ${t.fg("text", input.preset.serverName)}`,
    `    Existing entry     ${t.fg("text", input.runtime.managed.status === "missing" ? "none" : input.runtime.managed.status)}`,
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "CONNECTION")}`,
    `    Transport          ${t.fg("text", input.preset.transport)}`,
    `    Exposure           ${t.fg("text", input.config.exposure ?? "codemode")}`,
    ...wrapText(endpoint, Math.max(24, width - 24)).map((line, index) =>
      index === 0
        ? `    Endpoint           ${t.fg("dim", line)}`
        : `                       ${t.fg("dim", line)}`,
    ),
    `    Resolution         ${t.fg("text", resolutionLabel(input.resolution))}`,
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "SAFETY")}`,
    `    ${t.fg("success", "✓")} Manual or modified entries are never overwritten`,
    `    ${t.fg("success", "✓")} OAuth and connection state remain Pi-owned`,
    `    ${t.fg("success", "✓")} Guardrail mediates managed mutation surfaces`,
  ];
  if (input.runtime.scopeConflict) {
    lines.push(
      ...wrapText(input.runtime.scopeConflict.message, Math.max(24, width - 8)).map(
        (line, index) =>
          index === 0
            ? `    ${t.fg("warning", "⚠")} ${t.fg("warning", line)}`
            : `      ${t.fg("warning", line)}`,
      ),
    );
  }
  lines.push(
    "",
    ` ${t.fg("muted", "Actions")}`,
    `   ${renderButton(t, "Apply preset", input.selected === 0)}  ${renderButton(t, "Back", input.selected === 1)}`,
    "",
    ` ${t.fg("dim", "←/→ or ↑/↓ choose · Enter apply · Esc back")}`,
  );
  return lines;
}

export function renderTogglePage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  enable: boolean;
  selected: number;
}): string[] {
  const { theme: t } = input;
  const action = input.enable ? "Enable" : "Disable";
  return [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › ${action}`))}`,
    "",
    ` ${t.fg(input.enable ? "success" : "warning", t.bold(`${action} ${input.preset.label}?`))}`,
    ...wrapText(
      input.enable
        ? "This re-enables the existing unchanged native MCP entry."
        : "This persists enabled=false. The entry stays available in Pi's native /mcp manager.",
      Math.max(24, input.width - 3),
    ).map((line) => ` ${t.fg("dim", line)}`),
    "",
    `   ${renderButton(t, action, input.selected === 0)}  ${renderButton(t, "Cancel", input.selected === 1)}`,
    "",
    ` ${t.fg("dim", "←/→ or ↑/↓ choose · Enter confirm · Esc cancel")}`,
  ];
}

export function renderResultPage(input: {
  theme: Theme;
  width: number;
  title: string;
  message: string;
  tone: "success" | "warning" | "error";
  needsReload: boolean;
}): string[] {
  const { theme: t } = input;
  const icon = input.tone === "success" ? "✓" : input.tone === "warning" ? "⚠" : "✗";
  const lines = [
    ` ${t.fg(input.tone, t.bold(`${icon} ${input.title}`))}`,
    "",
    ...wrapText(input.message, Math.max(24, input.width - 3)).map(
      (line) => ` ${t.fg(input.tone, line)}`,
    ),
    "",
  ];
  if (input.needsReload) {
    lines.push(
      ` ${t.fg("muted", "Next")}`,
      `   ${t.fg("text", "1. Press Enter to return to the extension detail")}`,
      `   ${t.fg("text", "2. Close the Manager to reload Pi")}`,
      `   ${t.fg("text", "3. Open /mcp to connect or sign in")}`,
      "",
      ` ${t.fg("accent", "❯ [ Continue — reload pending ]")}`,
    );
  } else {
    lines.push(` ${t.fg("accent", "❯ [ Back to Salesforce MCPs ]")}`);
  }
  lines.push("", ` ${t.fg("dim", "Enter/Esc continue")}`);
  return lines;
}

export function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

export function wrapText(text: string, width: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (visibleWidth(next) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (visibleWidth(word) <= width) {
      current = word;
      continue;
    }
    const chunks = splitToken(word, width);
    lines.push(...chunks.slice(0, -1));
    current = chunks.at(-1) ?? "";
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function splitToken(value: string, width: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const character of value) {
    if (current && visibleWidth(`${current}${character}`) > width) {
      chunks.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function renderStatus(theme: Theme, status: ManagedServerStatus, preset: McpPreset): string {
  if (status === "managed-enabled") return theme.fg("success", "● ENABLED");
  if (status === "managed-disabled") return theme.fg("muted", "○ DISABLED");
  if (status === "manual") return theme.fg("warning", "◐ MANUAL CONFIG");
  if (status === "modified") return theme.fg("warning", "▲ REVIEW CHANGES");
  if (status === "invalid-config") return theme.fg("error", "● INVALID CONFIG");
  if (preset.risk === "delete" || preset.id === "sobject-all") {
    return theme.fg("error", "▲ ELEVATED RISK");
  }
  if (preset.setup === "ready") return theme.fg("success", "● READY");
  return theme.fg("warning", "◐ NEEDS SETUP");
}

function renderAction(theme: Theme, status: ManagedServerStatus): string {
  if (status === "managed-enabled") return theme.fg("dim", "D Disable");
  if (status === "managed-disabled") return theme.fg("accent", "Enter Enable");
  if (status === "manual" || status === "modified" || status === "invalid-config") {
    return theme.fg("warning", "Open /mcp");
  }
  return theme.fg("accent", "Enter Set up");
}

function selectedDetail(state: PresetRuntimeState): string {
  if (state.scopeConflict) return `⚠ ${state.scopeConflict.message}`;
  if (state.managed.status === "manual") {
    return "Existing native entry detected; SF MCP will not overwrite it.";
  }
  if (state.managed.status === "modified") {
    return "Managed entry changed outside SF MCP; review it before repair.";
  }
  if (state.plan.conflicts.length === 0) {
    return `${state.preset.transport} · no active SF Pi capability overlap detected`;
  }
  const owners = state.plan.conflicts.map((conflict) => conflict.nativeExtensionId).join(", ");
  return `⚠ overlap with ${owners} · ${state.plan.recommendation.summary}`;
}

function resolutionLabel(resolution: McpResolution): string {
  switch (resolution) {
    case "complement-native":
      return "Complement SF Pi";
    case "side-by-side":
      return "Full MCP side-by-side";
    case "use-sobject-mutations":
      return "SF SOQL + SObject Mutations";
    case "native-only":
      return "Native SF Pi owner only";
    default:
      return "Enable preset";
  }
}

function describeTransport(config: McpServerConfig): string {
  if (config.url) return config.url;
  return [config.command, ...(config.args ?? [])].filter(Boolean).join(" ");
}

function renderButton(theme: Theme, label: string, selected: boolean): string {
  const text = `[ ${label} ]`;
  return selected ? theme.fg("accent", theme.bold(`❯ ${text}`)) : theme.fg("muted", `  ${text}`);
}
