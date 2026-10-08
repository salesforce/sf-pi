/* SPDX-License-Identifier: Apache-2.0 */
/** Pure renderers for SF MCP's embedded Manager workflow pages. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ConflictPlan } from "./conflict-planner.ts";
import type { ManagedServerStatus } from "./managed-state.ts";
import type { McpServerConfig } from "./mcp-config.ts";
import type { McpPreset, McpResolution } from "./presets.ts";
import type { PresetRuntimeState } from "./service.ts";
import type { PresetSetupForm } from "./setup-form.ts";
import type { McpToolDetail } from "./tool-catalog.ts";
import {
  exposureLabel,
  profileLabel,
  toolPolicyWarnings,
  type ToolExposurePolicy,
} from "./tool-policy.ts";

export type ConflictOption = {
  label: string;
  description: string;
  resolution?: McpResolution;
};

export type ReconcileOption = {
  label: string;
  description: string;
};

export type PresetOverviewOption = {
  label: string;
  description: string;
};

export type ConnectionOption = {
  label: string;
  description: string;
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
  const contentWidth = Math.max(24, width - 3);
  const enabled = input.states.filter((state) => state.managed.status === "managed-enabled").length;
  const lines = [
    ` ${t.fg("accent", t.bold("☁  Salesforce MCPs"))}`,
    ` ${t.fg("dim", "Salesforce-published presets. Nothing connects until you explicitly enable it.")}`,
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", `${input.scope.toUpperCase()} SCOPE`)}  ${t.fg("dim", `· ${enabled}/${input.states.length} enabled · Pi native MCP`)}`,
    "",
  ];

  let category: McpPreset["category"] | undefined;
  for (let index = 0; index < input.states.length; index++) {
    const state = input.states[index];
    if (!state) continue;
    if (state.preset.category !== category) {
      category = state.preset.category;
      const prefix = `◆ ${category.toUpperCase()} `;
      const rule = "─".repeat(Math.max(0, contentWidth - visibleWidth(prefix) - 1));
      lines.push(` ${t.fg("accent", t.bold(`${prefix}${rule}`))}`, "");
    }
    const selected = index === input.cursor;
    const cursor = selected ? t.fg("accent", "❯") : " ";
    const label = selected
      ? t.fg("accent", t.bold(`${state.preset.icon}  ${state.preset.label}`))
      : t.fg("text", `${state.preset.icon}  ${state.preset.label}`);
    const status = `${supportTag(t, state.preset)}${renderStatus(t, state.managed.status, state.preset)}`;
    const action = renderAction(t, state.managed.status);
    const left = ` ${cursor} ${label}`;
    const right = `${status}  ${action}`;
    const gap = Math.max(2, contentWidth - visibleWidth(left) - visibleWidth(right) - 1);
    lines.push(`${left}${" ".repeat(gap)}${right}`);
    lines.push(
      ...wrapText(state.preset.description, Math.max(24, contentWidth - 6)).map(
        (line) => `     ${t.fg("dim", line)}`,
      ),
    );
    if (selected) {
      lines.push(
        ...wrapText(selectedDetail(state), Math.max(24, contentWidth - 6)).map(
          (line) => `     ${t.fg("muted", line)}`,
        ),
      );
    }
    lines.push("");
  }

  if (input.message) {
    lines.push(
      ...wrapText(input.message, Math.max(24, contentWidth - 3)).map(
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

export function renderPresetOverviewPage(input: {
  theme: Theme;
  width: number;
  state: PresetRuntimeState;
  instances: readonly PresetRuntimeState[];
  capabilities: readonly string[];
  catalogNote?: string;
  tools: readonly McpToolDetail[];
  options: readonly PresetOverviewOption[];
  selected: number;
}): string[] {
  const { theme: t, width, state } = input;
  const documented = input.tools.filter((tool) => tool.documented).length;
  const observed = input.tools.filter((tool) => tool.observed).length;
  const conflicts = state.plan.conflicts.map((conflict) => conflict.nativeExtensionId);
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${state.preset.label} › Overview`))}`,
    "",
    ` ${t.fg("accent", t.bold(`${state.preset.icon}  ${state.preset.label}`))}`,
    ` ${t.fg("muted", `${state.preset.support.toUpperCase()} · ${state.preset.transport.toUpperCase()} · ${riskLabel(state.preset.risk)} risk · ${plainStatus(state.managed.status)}`)}`,
    ...wrapText(state.preset.description, Math.max(24, width - 3)).map(
      (line) => ` ${t.fg("dim", line)}`,
    ),
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "CONNECTIONS")}`,
    ...renderInstanceSummary(t, input.instances),
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "CAPABILITIES")}`,
    ...input.capabilities.flatMap((capability) =>
      wrapText(capability, Math.max(24, width - 8)).map(
        (line, index) =>
          `    ${index === 0 ? `${t.fg("success", "✓")} ` : "  "}${t.fg("text", line)}`,
      ),
    ),
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "TOOLS")}`,
    `    ${t.fg("text", `${documented} documented · ${observed} observed in this session`)}`,
  ];
  if (input.catalogNote) {
    lines.push(
      ...wrapText(input.catalogNote, Math.max(24, width - 8)).map(
        (line) => `    ${t.fg("dim", line)}`,
      ),
    );
  }
  lines.push("", ` ${t.fg("accent", "▰")} ${t.fg("muted", "CONFLICTS")}`);
  if (conflicts.length === 0) {
    lines.push(
      `    ${t.fg("success", "✓")} ${t.fg("text", "No active SF Pi capability overlap detected")}`,
    );
  } else {
    lines.push(
      `    ${t.fg("warning", "⚠")} ${t.fg("warning", `${conflicts.length} active capability overlap${conflicts.length === 1 ? "" : "s"} · review before enabling tools`)}`,
    );
  }
  if (state.drift.status === "review") {
    lines.push(
      `    ${t.fg("warning", "⚠")} ${t.fg("warning", `Contract drift: +${state.drift.added.length} / -${state.drift.removed.length}`)}`,
    );
  }
  lines.push(
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "DOCUMENTATION")}`,
    ...wrapText(state.preset.docsUrl, Math.max(24, width - 8)).map(
      (line) => `    ${t.fg("dim", line)}`,
    ),
    "",
    ` ${t.fg("muted", "Actions")}`,
    "",
  );
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

export function renderConnectionsPage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  instances: readonly PresetRuntimeState[];
}): string[] {
  const { theme: t, width } = input;
  const configured = input.instances.filter((state) => state.managed.status !== "missing");
  const orgBound = configured.filter((state) => state.managed.record?.orgBinding);
  const unbound = configured.filter((state) => !state.managed.record?.orgBinding);
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Connections`))}`,
    "",
    ` ${t.fg("accent", t.bold(`${configured.length} configured connection${configured.length === 1 ? "" : "s"}`))}`,
    ` ${t.fg("success", "🔗")} ${t.fg("text", `${orgBound.length} org-bound`)}  ${t.fg("warning", "⚠")} ${t.fg("text", `${unbound.length} org not recorded`)}`,
    ...wrapText(
      "SF CLI aliases prove org identity during setup. Pi MCP keeps separate OAuth credentials for every native connection name and URL.",
      Math.max(24, width - 3),
    ).map((line) => ` ${t.fg("dim", line)}`),
    "",
  ];

  if (orgBound.length > 0) {
    lines.push(` ${t.fg("accent", "▰")} ${t.fg("muted", "🔗 ORG-BOUND")}`, "");
    for (const instance of orgBound) lines.push(...renderConnectionInstance(t, width, instance));
  }
  if (unbound.length > 0) {
    lines.push(
      ` ${t.fg("warning", "▰")} ${t.fg("muted", "⚠ EXISTING CONNECTION · ORG NOT RECORDED")}`,
      ...wrapText(
        "This is not proof of another Salesforce org. SF MCP has no stored org mapping for this existing connection; Pi /mcp may still hold its OAuth grant.",
        Math.max(24, width - 3),
      ).map((line) => ` ${t.fg("dim", line)}`),
      "",
    );
    for (const instance of unbound) lines.push(...renderConnectionInstance(t, width, instance));
  }
  if (configured.length === 0) lines.push(` ${t.fg("muted", "No configured connections")}`, "");

  lines.push(
    ` ${t.fg("dim", "OAuth status and grant time remain in Pi's native /mcp runtime.")}`,
    ` ${t.fg("accent", "❯ [ Back to overview ]")}`,
    "",
    ` ${t.fg("dim", "Enter/Esc continue")}`,
  );
  return lines;
}

export function renderToolListPage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  runtime: PresetRuntimeState;
  tools: readonly McpToolDetail[];
  cursor: number;
  catalogNote?: string;
}): string[] {
  const { theme: t, width } = input;
  const windowSize = 10;
  const start = Math.max(
    0,
    Math.min(input.cursor - Math.floor(windowSize / 2), input.tools.length - windowSize),
  );
  const end = Math.min(input.tools.length, start + windowSize);
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Tools`))}`,
    "",
    ` ${t.fg("muted", input.tools.length > 0 ? `Showing ${start + 1}–${end} of ${input.tools.length}` : "No tool names are available before connection")}`,
    "",
  ];
  if (input.tools.length === 0 && input.catalogNote) {
    lines.push(
      ...wrapText(input.catalogNote, Math.max(24, width - 3)).map(
        (line) => ` ${t.fg("dim", line)}`,
      ),
      "",
    );
  }
  for (let index = start; index < end; index++) {
    const tool = input.tools[index];
    if (!tool) continue;
    const selected = index === input.cursor;
    const status = tool.documented
      ? tool.observed
        ? "documented · observed"
        : "documented"
      : "observed only · unapproved";
    const exposure = configuredToolExposure(input.runtime.managed.config, tool.name, tool.exposure);
    const heading = `${selected ? "❯" : " "} ${tool.name}`;
    lines.push(
      ` ${selected ? t.fg("accent", t.bold(truncateToWidth(heading, Math.max(20, width - 2)))) : t.fg("text", truncateToWidth(heading, Math.max(20, width - 2)))}`,
    );
    lines.push(
      ...wrapText(
        `${tool.capability} · ${riskLabel(tool.risk)} risk · ${exposure} · ${status}`,
        Math.max(24, width - 5),
      ).map((line) => `   ${t.fg(tool.documented ? "dim" : "warning", line)}`),
    );
    if (selected) {
      lines.push(
        ...wrapText(tool.description, Math.max(24, width - 5)).map(
          (line) => `   ${t.fg("muted", line)}`,
        ),
      );
    }
    lines.push("");
  }
  lines.push(
    ` ${t.fg("dim", input.tools.length > 0 ? "↑/↓ navigate · Enter inspect · Esc overview" : "Esc overview")}`,
  );
  return lines;
}

export function renderToolDetailPage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  runtime: PresetRuntimeState;
  tool: McpToolDetail;
  exposureOverride?: string;
}): string[] {
  const { theme: t, width, tool } = input;
  const exposure =
    input.exposureOverride ??
    configuredToolExposure(input.runtime.managed.config, tool.name, tool.exposure);
  const contract = tool.documented
    ? tool.observed
      ? "Documented and observed live"
      : "Documented · not observed in this session"
    : "Observed live · not in the reviewed preset contract";
  const descriptionSource =
    tool.descriptionSource === "observed" ? "Observed live" : "Documented contract";
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › ${tool.name}`))}`,
    "",
    ` ${t.fg("accent", t.bold(tool.name))}`,
    ...wrapText(tool.description, Math.max(24, width - 3)).map((line) => ` ${t.fg("text", line)}`),
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "CONTRACT")}`,
    `    Capability         ${t.fg("text", tool.capability)}`,
    `    Risk               ${t.fg(tool.risk === "read" ? "success" : "warning", riskLabel(tool.risk))}`,
    `    Exposure           ${t.fg("text", exposure)}`,
    `    Status             ${t.fg(tool.documented ? "text" : "warning", contract)}`,
    `    Description source ${t.fg("text", descriptionSource)}`,
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "RUNTIME METADATA")}`,
    ...renderAnnotations(t, tool, width),
    ...renderSchemaSummary(t, tool.parameters, width),
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "DOCUMENTATION")}`,
    ...wrapText(input.preset.docsUrl, Math.max(24, width - 8)).map(
      (line) => `    ${t.fg("dim", line)}`,
    ),
    "",
    ` ${t.fg("dim", `Enter/Esc back to ${input.exposureOverride ? "configuration" : "tools"}`)}`,
  ];
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

export function renderReconcilePage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  status: ManagedServerStatus;
  message?: string;
  options: ReconcileOption[];
  selected: number;
}): string[] {
  const { theme: t, width } = input;
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Configuration Review`))}`,
    "",
    ` ${t.fg("warning", t.bold(`Existing entry: ${input.status}`))}`,
  ];
  if (input.message) {
    lines.push(
      ...wrapText(input.message, Math.max(24, width - 3)).map(
        (line) => ` ${t.fg("warning", line)}`,
      ),
    );
  }
  lines.push("", ` ${t.fg("muted", "Choose one explicit reconciliation action")}`, "");
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

export function renderConnectionPage(input: {
  theme: Theme;
  width: number;
  state: PresetRuntimeState;
  options: readonly ConnectionOption[];
  selected: number;
}): string[] {
  const { theme: t, width, state } = input;
  const config = state.managed.config ?? state.managed.override;
  const status = plainStatus(state.managed.status);
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${state.preset.label} › Connection & Authentication`))}`,
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "CONNECTION")}`,
    `    Status             ${t.fg(state.managed.status === "managed-enabled" ? "success" : "warning", status.toUpperCase())}`,
    `    Server             ${t.fg("text", state.managed.configuredName ?? state.preset.serverName)}`,
    `    Transport          ${t.fg("text", state.preset.transport)}`,
    ...wrapText(
      config ? describeTransport(config as McpServerConfig) : "Not configured",
      Math.max(24, width - 24),
    ).map((line, index) =>
      index === 0
        ? `    Endpoint           ${t.fg("dim", line)}`
        : `                       ${t.fg("dim", line)}`,
    ),
    `    Authentication     ${t.fg("text", describeAuthentication(config as McpServerConfig | undefined))}`,
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "BOUNDARY")}`,
    `    ${t.fg("success", "✓")} Connection changes are reviewed separately from tool access`,
    `    ${t.fg("success", "✓")} OAuth consent and tokens remain owned by Pi`,
    `    ${t.fg("success", "✓")} New connections start with tools hidden`,
    "",
    ` ${t.fg("muted", "Actions")}`,
    "",
  ];
  for (let index = 0; index < input.options.length; index++) {
    const option = input.options[index];
    if (!option) continue;
    const selected = index === input.selected;
    lines.push(
      ` ${selected ? t.fg("accent", "❯") : " "} ${selected ? t.fg("accent", t.bold(option.label)) : t.fg("text", option.label)}`,
      ...wrapText(option.description, Math.max(24, width - 5)).map(
        (line) => `   ${t.fg("dim", line)}`,
      ),
      "",
    );
  }
  lines.push(` ${t.fg("dim", "↑/↓ choose · Enter continue · Esc overview")}`);
  return lines;
}

export function renderToolAccessUnavailablePage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  title: string;
  message: string;
  observedTools: number;
}): string[] {
  const { theme: t, width } = input;
  return [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Tool Access`))}`,
    "",
    ` ${t.fg("warning", t.bold(input.title))}`,
    ...wrapText(input.message, Math.max(24, width - 3)).map((line) => ` ${t.fg("dim", line)}`),
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "SAFETY")}`,
    `    ${t.fg("text", `${input.observedTools} tool${input.observedTools === 1 ? "" : "s"} observed in this session`)}`,
    `    ${t.fg("success", "✓")} Unreviewed tools remain Hidden`,
    `    ${t.fg("success", "✓")} Connection settings remain unchanged`,
    "",
    ` ${t.fg("dim", "Enter/Esc back to overview")}`,
  ];
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
  configDiff?: string[];
  selected: number;
  toolPolicy?: ToolExposurePolicy;
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
    `    Server name        ${t.fg("text", input.runtime.managed.configuredName ?? input.preset.serverName)}`,
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
  ];
  if (input.toolPolicy) {
    const counts = Object.values(input.config.toolExposure ?? input.toolPolicy.exposures).reduce<
      Record<string, number>
    >((current, exposure) => ({ ...current, [exposure]: (current[exposure] ?? 0) + 1 }), {});
    lines.push(
      "",
      ` ${t.fg("accent", "▰")} ${t.fg("muted", "TOOL EXPOSURE")}`,
      `    Profile            ${t.fg("text", profileLabel(input.toolPolicy.profile))}`,
      ...(["hidden", "codemode", "deferred", "direct"] as const).map(
        (exposure) =>
          `    ${exposureLabel(exposure).padEnd(19)}${t.fg("text", String(counts[exposure] ?? 0))}`,
      ),
    );
    for (const warning of toolPolicyWarnings(input.preset, input.toolPolicy)) {
      lines.push(
        ...wrapText(warning, Math.max(24, width - 8)).map((line, index) =>
          index === 0 ? `    ${t.fg("warning", `⚠ ${line}`)}` : `      ${t.fg("warning", line)}`,
        ),
      );
    }
  }
  if (input.configDiff && input.configDiff.length > 0) {
    lines.push(
      "",
      ` ${t.fg("accent", "▰")} ${t.fg("muted", "CHANGES")}`,
      ...input.configDiff.flatMap((change) =>
        wrapText(change, Math.max(24, width - 8)).map((line) => `    ${t.fg("warning", line)}`),
      ),
    );
  }
  lines.push(
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "SAFETY")}`,
    `    ${t.fg("success", "✓")} Existing entries change only after explicit diff review`,
    `    ${t.fg("success", "✓")} OAuth and connection state remain Pi-owned`,
    `    ${t.fg("success", "✓")} Guardrail mediates managed mutation surfaces`,
  );
  if (input.preset.supportNote) {
    lines.push(`    ${t.fg("warning", "⚠")} ${t.fg("warning", input.preset.supportNote)}`);
  }
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
    `   ${renderButton(t, "Save configuration", input.selected === 0)}  ${renderButton(t, "Back", input.selected === 1)}`,
    "",
    ` ${t.fg("dim", "←/→ or ↑/↓ choose · Enter save · Esc back")}`,
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

function describeAuthentication(config: McpServerConfig | undefined): string {
  if (!config) return "Not configured";
  if ("oauth" in config && config.oauth) {
    const secret = config.oauth.clientSecret ? " · secret environment reference" : "";
    return `OAuth client configured${secret}`;
  }
  if ("env" in config && config.env && Object.keys(config.env).length > 0) {
    return "Environment references";
  }
  return "None required or server-managed";
}

function configuredToolExposure(
  config: McpServerConfig | undefined,
  toolName: string,
  observedExposure?: string,
): string {
  if (!config) return displayExposure(observedExposure) ?? "not configured";
  const entries = Object.entries(config.toolExposure ?? {});
  const exact = entries.find(([pattern]) => pattern === toolName)?.[1];
  if (exact) return displayExposure(exact) ?? exact;
  for (const [pattern, exposure] of entries) {
    if (!pattern.includes("*")) continue;
    const expression = new RegExp(
      `^${pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
    );
    if (expression.test(toolName)) return displayExposure(exposure) ?? exposure;
  }
  return displayExposure(observedExposure ?? config.exposure) ?? "Code Mode";
}

function displayExposure(value: string | undefined): string | undefined {
  if (value === "hidden" || value === "codemode" || value === "deferred" || value === "direct") {
    return exposureLabel(value);
  }
  return value;
}

function renderAnnotations(theme: Theme, tool: McpToolDetail, width: number): string[] {
  const annotations = tool.annotations;
  if (!annotations) return [`    ${theme.fg("dim", "Annotations        Not observed")}`];
  const values = [
    annotations.readOnlyHint === true
      ? "read-only"
      : annotations.readOnlyHint === false
        ? "writes"
        : undefined,
    annotations.destructiveHint === true
      ? "destructive"
      : annotations.destructiveHint === false
        ? "non-destructive"
        : undefined,
    annotations.idempotentHint === true
      ? "idempotent"
      : annotations.idempotentHint === false
        ? "non-idempotent"
        : undefined,
    annotations.openWorldHint === true
      ? "open-world"
      : annotations.openWorldHint === false
        ? "closed-world"
        : undefined,
  ].filter((value): value is string => value !== undefined);
  return wrapText(values.join(" · ") || "No explicit hints", Math.max(20, width - 23)).map(
    (line, index) =>
      index === 0
        ? `    Annotations        ${theme.fg("text", line)}`
        : `                       ${theme.fg("text", line)}`,
  );
}

function renderSchemaSummary(theme: Theme, parameters: unknown, width: number): string[] {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    return [`    ${theme.fg("dim", "Input schema       Not observed")}`];
  }
  const schema = parameters as { properties?: unknown; required?: unknown };
  const properties =
    schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? Object.keys(schema.properties as Record<string, unknown>)
      : [];
  const required = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];
  if (properties.length === 0)
    return [`    Input schema       ${theme.fg("text", "No parameters")}`];
  const fields = properties.map((name) => (required.includes(name) ? `${name}*` : name)).join(", ");
  return [
    ...wrapText(fields, Math.max(20, width - 23)).map((line, index) =>
      index === 0
        ? `    Input schema       ${theme.fg("text", line)}`
        : `                       ${theme.fg("text", line)}`,
    ),
    `    ${theme.fg("dim", "* required")}`,
  ];
}

function plainStatus(status: ManagedServerStatus): string {
  switch (status) {
    case "managed-enabled":
      return "enabled";
    case "managed-disabled":
      return "disabled";
    case "manual":
      return "manual configuration";
    case "modified":
      return "review changes";
    case "project-override":
      return "project override";
    case "managed-outdated":
      return "preset update available";
    case "name-conflict":
      return "name conflict";
    case "invalid-config":
      return "invalid configuration";
    default:
      return "not configured";
  }
}

function riskLabel(risk: McpPreset["risk"] | McpToolDetail["risk"]): string {
  if (risk === "destructive") return "Destructive";
  return `${risk.slice(0, 1).toUpperCase()}${risk.slice(1)}`;
}

function renderConnectionInstance(
  theme: Theme,
  width: number,
  state: PresetRuntimeState,
): string[] {
  const binding = state.managed.record?.orgBinding;
  const name = state.managed.configuredName ?? state.connectionName;
  const label = binding?.alias ?? binding?.targetOrg ?? "Existing connection (org not recorded)";
  const headingIcon = binding ? "☁" : "⚠";
  const headingTone = binding ? "success" : "warning";
  const cliRelationship = binding
    ? `Alias ${binding.alias ?? binding.targetOrg} supplied the org identity during setup; SF CLI and MCP credentials are separate`
    : "Not linked to an SF CLI alias · this connection is independent of the org-bound entries";
  const setupMethod = state.managed.record
    ? `SF MCP managed preset · ${resolutionLabel(state.managed.record.resolution)}`
    : "Existing Pi native MCP configuration · not managed by SF MCP";
  const lines = [
    `    ${theme.fg(headingTone, headingIcon)} ${theme.fg("text", theme.bold(label))}`,
  ];
  lines.push(
    ...renderConnectionDetail(
      theme,
      width,
      "●",
      "Status",
      state.managed.status === "managed-enabled"
        ? "Configured and enabled"
        : plainStatus(state.managed.status),
      state.managed.status === "managed-enabled" ? "success" : "warning",
    ),
    ...renderConnectionDetail(
      theme,
      width,
      "🔗",
      "Binding",
      binding ? `Org-pinned · ${binding.orgType}` : "Org mapping not recorded or verified",
      binding ? "text" : "warning",
    ),
    ...(binding
      ? renderConnectionDetail(theme, width, "🌐", "Org URL", binding.authorizationIssuer, "text")
      : []),
    ...renderConnectionDetail(theme, width, "🧭", "SF CLI", cliRelationship, "dim"),
    ...renderConnectionDetail(
      theme,
      width,
      "🔐",
      "Authentication",
      authenticationMethod(state.managed.config),
    ),
    ...renderConnectionDetail(theme, width, "🛠", "Configured through", setupMethod),
    ...renderConnectionDetail(
      theme,
      width,
      "🕒",
      "Authorization time",
      "Not exposed to SF MCP · Pi native /mcp owns the OAuth grant",
      "dim",
    ),
    ...renderConnectionDetail(theme, width, "◇", "Native name", name, "dim"),
    "",
  );
  return lines;
}

function renderConnectionDetail(
  theme: Theme,
  width: number,
  icon: string,
  label: string,
  value: string,
  tone: "text" | "dim" | "success" | "warning" = "text",
): string[] {
  const prefix = `      ${icon} ${label}: `;
  const continuation = " ".repeat(visibleWidth(prefix));
  return wrapText(value, Math.max(16, width - visibleWidth(prefix) - 1)).map((line, index) =>
    index === 0
      ? `${theme.fg("muted", prefix)}${theme.fg(tone, line)}`
      : `${continuation}${theme.fg(tone, line)}`,
  );
}

function authenticationMethod(config: McpServerConfig | undefined): string {
  if (!config) return "Unknown · inspect Pi native /mcp";
  if ("oauth" in config && config.oauth) {
    return "OAuth 2.0 Authorization Code + PKCE · Pi native token store";
  }
  if ("headers" in config && config.headers && Object.keys(config.headers).length > 0) {
    return "Configured HTTP authorization header";
  }
  if ("command" in config) return "Local stdio process";
  return "No OAuth configuration";
}

function renderInstanceSummary(theme: Theme, instances: readonly PresetRuntimeState[]): string[] {
  const configured = instances.filter((state) => state.managed.status !== "missing");
  if (configured.length === 0) return [`    ${theme.fg("muted", "No configured connections")}`];
  return configured.slice(0, 4).map((state) => {
    const binding = state.managed.record?.orgBinding;
    const label = binding?.alias ?? binding?.targetOrg ?? "Existing connection · org not recorded";
    const status = state.managed.status === "managed-enabled" ? "●" : "○";
    const tone = state.managed.status === "managed-enabled" ? "success" : "warning";
    return `    ${theme.fg(tone, status)} ${theme.fg("text", label)}${binding ? theme.fg("muted", ` · ${binding.orgType}`) : ""}`;
  });
}

function renderStatus(theme: Theme, status: ManagedServerStatus, preset: McpPreset): string {
  if (status === "managed-enabled") return theme.fg("success", "● ENABLED");
  if (status === "managed-disabled") return theme.fg("muted", "○ DISABLED");
  if (status === "manual") return theme.fg("warning", "◐ MANUAL CONFIG");
  if (status === "modified") return theme.fg("warning", "▲ REVIEW CHANGES");
  if (status === "project-override") return theme.fg("muted", "◐ PROJECT OVERRIDE");
  if (status === "managed-outdated") return theme.fg("warning", "▲ PRESET UPDATE");
  if (status === "name-conflict") return theme.fg("error", "● NAME CONFLICT");
  if (status === "invalid-config") return theme.fg("error", "● INVALID CONFIG");
  if (preset.risk === "delete") return theme.fg("error", "▲ ELEVATED RISK");
  if (preset.setup === "ready") return theme.fg("success", "● READY");
  return theme.fg("warning", "◐ NEEDS SETUP");
}

function renderAction(theme: Theme, status: ManagedServerStatus): string {
  if (status === "managed-enabled") return theme.fg("dim", "D Disable");
  if (status === "managed-disabled") return theme.fg("accent", "Enter Enable");
  if (
    status === "manual" ||
    status === "modified" ||
    status === "managed-outdated" ||
    status === "name-conflict"
  ) {
    return theme.fg("warning", "Enter Review");
  }
  if (status === "project-override" || status === "invalid-config") {
    return theme.fg("warning", "Open /mcp");
  }
  return theme.fg("accent", "Enter Set up");
}

function selectedDetail(state: PresetRuntimeState): string {
  if (state.scopeConflict) return `⚠ ${state.scopeConflict.message}`;
  if (state.drift.status === "review") {
    return `⚠ tool contract changed · added: ${state.drift.added.join(", ") || "none"} · removed: ${state.drift.removed.join(", ") || "none"}`;
  }
  if (state.managed.status === "manual") {
    return "Existing native entry detected; review adoption or an explicit preset reset.";
  }
  if (state.managed.status === "modified") {
    return "Managed entry changed outside SF MCP; review it before repair.";
  }
  if (state.managed.status === "project-override") {
    return state.managed.message ?? "Pi applies a project override to the matching global entry.";
  }
  if (state.managed.status === "managed-outdated") {
    return "A newer reviewed preset revision is available.";
  }
  if (state.managed.status === "name-conflict") {
    return state.managed.message ?? "Canonical MCP server names conflict.";
  }
  if (state.plan.conflicts.length === 0) {
    return `${state.preset.transport} · no active SF Pi capability overlap detected`;
  }
  const owners = state.plan.conflicts.map((conflict) => conflict.nativeExtensionId).join(", ");
  return `⚠ overlap with ${owners} · ${state.plan.recommendation.summary}`;
}

function supportTag(theme: Theme, preset: McpPreset): string {
  if (preset.support === "ga") return "";
  return `${theme.fg(preset.support === "alpha" ? "warning" : "muted", `${preset.support.toUpperCase()} `)}`;
}

function resolutionLabel(resolution: McpResolution): string {
  switch (resolution) {
    case "complement-native":
      return "Complement SF Pi";
    case "side-by-side":
      return "Full MCP side-by-side";
    case "native-only":
      return "Native SF Pi owner only";
    default:
      return "Enable preset";
  }
}

function describeTransport(config: McpServerConfig): string {
  if ("url" in config) return config.url;
  return [config.command, ...(config.args ?? [])].filter(Boolean).join(" ");
}

function renderButton(theme: Theme, label: string, selected: boolean): string {
  const text = `[ ${label} ]`;
  return selected ? theme.fg("accent", theme.bold(`❯ ${text}`)) : theme.fg("muted", `  ${text}`);
}
