/* SPDX-License-Identifier: Apache-2.0 */
/** Small orchestration layer shared by the command and Manager TUI surfaces. */
import {
  isSfPiExtensionEnabled,
  type SfPiExtensionId,
} from "../../../lib/common/sf-pi-extension-state.ts";
import { planPresetConflicts, type ConflictPlan } from "./conflict-planner.ts";
import {
  findCanonicalMcpServerNames,
  inspectMcpConfig,
  mcpConfigPath,
  removeCanonicalMcpServerDuplicates,
  replaceMcpServer,
  setMcpServerEnabled,
  upsertMcpServer,
  type McpServerConfig,
} from "./mcp-config.ts";
import {
  createManagedStateStore,
  forgetManagedServer,
  inspectManagedServer,
  recordManagedServer,
  type ManagedServerInspection,
} from "./managed-state.ts";
import { inspectObservedToolDrift, type ObservedToolDrift } from "./observed-tools.ts";
import {
  SALESFORCE_MCP_PRESETS,
  approvedToolsForResolution,
  buildServerConfig,
  getPreset,
  isPresetConfigCompatible,
  type McpPreset,
  type McpPresetId,
  type McpResolution,
  type PresetSetup,
} from "./presets.ts";

export interface PresetRuntimeState {
  preset: McpPreset;
  plan: ConflictPlan;
  managed: ManagedServerInspection;
  drift: ObservedToolDrift;
  scopeConflict?: {
    kind: "project-would-override-global" | "project-overrides-global";
    message: string;
  };
}

export type PresetMutationResult =
  | {
      ok: true;
      preset: McpPreset;
      resolution: McpResolution;
      path: string;
      changed: boolean;
      reloadRequired: boolean;
      message: string;
    }
  | { ok: false; message: string };

export function inspectPresetRuntime(
  cwd: string,
  scope: "global" | "project",
  preset: McpPreset,
): PresetRuntimeState {
  const file = mcpConfigPath(cwd, scope);
  const store = createManagedStateStore(cwd, scope);
  const managed = inspectManagedServer(file, store, {
    serverName: preset.serverName,
    presetId: preset.id,
    presetRevision: preset.revision,
  });
  return {
    preset,
    plan: planPresetConflicts(preset, enabledOverlapOwners(cwd, preset)),
    managed,
    drift: inspectObservedToolDrift(preset, managed.record?.resolution ?? "enable"),
    scopeConflict: inspectScopeConflict(cwd, scope, preset),
  };
}

export function installPreset(input: {
  cwd: string;
  scope: "global" | "project";
  presetId: McpPresetId;
  resolution: McpResolution;
  setup?: PresetSetup;
  replaceExisting?: boolean;
}): PresetMutationResult {
  const preset = getPreset(input.presetId);
  if (input.resolution === "native-only") {
    return {
      ok: true,
      preset,
      resolution: input.resolution,
      path: mcpConfigPath(input.cwd, input.scope),
      changed: false,
      reloadRequired: false,
      message: `Kept ${preset.label} off; the native SF Pi owner remains preferred.`,
    };
  }

  if (input.resolution === "use-sobject-mutations") {
    return installPreset({
      ...input,
      presetId: "sobject-mutations",
      resolution: "complement-native",
    });
  }

  let config: McpServerConfig;
  try {
    config = buildServerConfig(preset, input.resolution, input.setup);
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  const file = mcpConfigPath(input.cwd, input.scope);
  const store = createManagedStateStore(input.cwd, input.scope);
  const managed = inspectManagedServer(file, store, {
    serverName: preset.serverName,
    presetId: preset.id,
    presetRevision: preset.revision,
  });
  if (managed.status === "name-conflict") {
    return { ok: false, message: managed.message ?? "Canonical MCP server names conflict." };
  }
  if (
    !input.replaceExisting &&
    ["manual", "modified", "managed-outdated"].includes(managed.status)
  ) {
    return {
      ok: false,
      message: `${managed.configuredName ?? preset.serverName} already has configuration requiring review. Adopt it or explicitly reset it to the preset.`,
    };
  }
  if (managed.status === "invalid-config") {
    return { ok: false, message: managed.message ?? "The native MCP configuration is invalid." };
  }

  const configuredName = managed.configuredName ?? preset.serverName;
  const mutation =
    managed.status === "missing"
      ? upsertMcpServer(file, preset.serverName, config)
      : replaceMcpServer(file, configuredName, config);
  if (mutation.ok === false) return { ok: false, message: mutation.message };

  recordManagedServer(store, configuredName, {
    presetId: preset.id,
    presetRevision: preset.revision,
    resolution: input.resolution,
    config,
  });
  return {
    ok: true,
    preset,
    resolution: input.resolution,
    path: file,
    changed: true,
    reloadRequired: true,
    message: `${input.replaceExisting ? "Reset" : "Enabled"} ${preset.label} in ${file}. Reload Pi, then use /mcp to connect or sign in.`,
  };
}

export function adoptPreset(input: {
  cwd: string;
  scope: "global" | "project";
  presetId: McpPresetId;
}): PresetMutationResult {
  const preset = getPreset(input.presetId);
  const file = mcpConfigPath(input.cwd, input.scope);
  const store = createManagedStateStore(input.cwd, input.scope);
  const managed = inspectManagedServer(file, store, {
    serverName: preset.serverName,
    presetId: preset.id,
    presetRevision: preset.revision,
  });
  if (!managed.config || !managed.configuredName) {
    return { ok: false, message: `${preset.label} has no single existing entry to adopt.` };
  }
  if (!["manual", "modified", "managed-outdated"].includes(managed.status)) {
    return { ok: false, message: `${preset.label} does not require adoption.` };
  }
  const compatibility = isPresetConfigCompatible(preset, managed.config);
  if (!compatibility.compatible) {
    return {
      ok: false,
      message:
        compatibility.reason ?? `${managed.configuredName} is not compatible with this preset.`,
    };
  }
  const resolution = managed.record?.resolution ?? inferResolution(preset, managed.config);
  recordManagedServer(store, managed.configuredName, {
    presetId: preset.id,
    presetRevision: preset.revision,
    resolution,
    config: managed.config,
  });
  return {
    ok: true,
    preset,
    resolution,
    path: file,
    changed: false,
    reloadRequired: false,
    message: `Adopted ${managed.configuredName} without changing Pi's native MCP configuration.`,
  };
}

export function reconcileCanonicalServerNames(input: {
  cwd: string;
  scope: "global" | "project";
  presetId: McpPresetId;
  keepName: string;
}): PresetMutationResult {
  const preset = getPreset(input.presetId);
  const file = mcpConfigPath(input.cwd, input.scope);
  const inspected = inspectMcpConfig(file);
  if (inspected.ok === false) return { ok: false, message: inspected.message };
  const matches = findCanonicalMcpServerNames(inspected.servers, preset.serverName);
  if (matches.length < 2) {
    return { ok: false, message: `${preset.label} has no canonical duplicate names to resolve.` };
  }
  const mutation = removeCanonicalMcpServerDuplicates(file, preset.serverName, input.keepName);
  if (mutation.ok === false) return { ok: false, message: mutation.message };
  const store = createManagedStateStore(input.cwd, input.scope);
  for (const name of matches) {
    if (name !== input.keepName) forgetManagedServer(store, name);
  }
  return {
    ok: true,
    preset,
    resolution: "enable",
    path: file,
    changed: true,
    reloadRequired: true,
    message: `Kept ${input.keepName} and removed ${matches.filter((name) => name !== input.keepName).join(", ")} from ${file}. Review the kept entry before adoption.`,
  };
}

export function summarizeConfigDiff(
  current: McpServerConfig | undefined,
  proposed: McpServerConfig,
): string[] {
  const before = summarizeConfig(current);
  const after = summarizeConfig(proposed);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys
    .filter((key) => before[key] !== after[key])
    .map((key) => `${key}: ${before[key] ?? "<absent>"} → ${after[key] ?? "<absent>"}`);
}

export function buildMcpRoutingGuidelines(cwd: string): string[] {
  const lines: string[] = [];
  for (const preset of SALESFORCE_MCP_PRESETS) {
    const project = inspectPresetRuntime(cwd, "project", preset);
    const global = inspectPresetRuntime(cwd, "global", preset);
    const effective = project.managed.status === "missing" ? global : project;
    if (
      effective.managed.status !== "managed-enabled" ||
      effective.managed.record?.resolution !== "side-by-side" ||
      effective.plan.conflicts.length === 0
    ) {
      continue;
    }
    const owners = effective.plan.conflicts
      .map((conflict) => conflict.nativeExtensionId)
      .join(", ");
    lines.push(
      `${preset.label} MCP is enabled side-by-side with ${owners}; prefer the specialized SF Pi family tool unless the user explicitly requests MCP behavior or needs an MCP-only capability.`,
    );
  }
  return lines;
}

export function setManagedPresetEnabled(input: {
  cwd: string;
  scope: "global" | "project";
  presetId: McpPresetId;
  enabled: boolean;
}): PresetMutationResult {
  const preset = getPreset(input.presetId);
  const file = mcpConfigPath(input.cwd, input.scope);
  const store = createManagedStateStore(input.cwd, input.scope);
  const managed = inspectManagedServer(file, store, {
    serverName: preset.serverName,
    presetId: preset.id,
    presetRevision: preset.revision,
  });
  if (managed.status !== "managed-enabled" && managed.status !== "managed-disabled") {
    return {
      ok: false,
      message: `${preset.label} is not an unchanged SF MCP-managed entry. It was not modified.`,
    };
  }

  const configuredName = managed.configuredName ?? preset.serverName;
  const mutation = setMcpServerEnabled(file, configuredName, input.enabled);
  if (mutation.ok === false) return { ok: false, message: mutation.message };
  const inspected = inspectMcpConfig(file);
  if (inspected.ok === false) return { ok: false, message: inspected.message };
  const config = inspected.servers[configuredName];
  if (!config) return { ok: false, message: `${configuredName} disappeared after update.` };
  recordManagedServer(store, configuredName, {
    presetId: preset.id,
    presetRevision: preset.revision,
    resolution: managed.record?.resolution ?? "enable",
    config,
  });
  return {
    ok: true,
    preset,
    resolution: managed.record?.resolution ?? "enable",
    path: file,
    changed: true,
    reloadRequired: true,
    message: `${input.enabled ? "Enabled" : "Disabled"} ${preset.label} in ${file}.`,
  };
}

function inferResolution(preset: McpPreset, config: McpServerConfig): McpResolution {
  if (config.exposure !== "hidden") return "enable";
  const configured = Object.keys(config.toolExposure ?? {}).sort();
  const complementary = approvedToolsForResolution(preset, "complement-native")?.sort() ?? [];
  const full = approvedToolsForResolution(preset, "enable")?.sort() ?? [];
  if (
    configured.length === complementary.length &&
    configured.every((name, index) => name === complementary[index]) &&
    configured.some((name, index) => name !== full[index])
  ) {
    return "complement-native";
  }
  return "enable";
}

function summarizeConfig(config: McpServerConfig | undefined): Record<string, string> {
  if (!config) return {};
  const summary: Record<string, string> = {};
  if ("command" in config && config.command) summary.command = config.command;
  if ("args" in config && config.args) summary.args = `${config.args.length} argument(s)`;
  if ("url" in config && config.url) summary.url = redactedUrl(config.url);
  if (config.exposure) summary.exposure = config.exposure;
  if (config.enabled !== undefined) summary.enabled = String(config.enabled);
  if (config.timeout !== undefined) summary.timeout = String(config.timeout);
  if ("oauth" in config && config.oauth?.clientId) summary.oauthClientId = "<configured>";
  if ("oauth" in config && config.oauth?.callbackPort !== undefined) {
    summary.oauthCallbackPort = String(config.oauth.callbackPort);
  }
  if (config.toolExposure) {
    summary.tools = Object.entries(config.toolExposure)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, exposure]) => `${name}:${exposure}`)
      .join(",");
  }
  if ("env" in config && config.env) summary.env = Object.keys(config.env).sort().join(",");
  if ("headers" in config && config.headers) {
    summary.headers = Object.keys(config.headers).sort().join(",");
  }
  return summary;
}

function redactedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<configured>";
  }
}

function inspectScopeConflict(
  cwd: string,
  scope: "global" | "project",
  preset: McpPreset,
): PresetRuntimeState["scopeConflict"] {
  const otherScope = scope === "global" ? "project" : "global";
  const other = inspectMcpConfig(mcpConfigPath(cwd, otherScope));
  if (
    other.ok === false ||
    findCanonicalMcpServerNames(other.servers, preset.serverName).length === 0
  ) {
    return undefined;
  }
  if (scope === "project") {
    return {
      kind: "project-would-override-global",
      message: `A global ${preset.serverName} entry already exists. A project entry with the same name will override it in this trusted project.`,
    };
  }
  return {
    kind: "project-overrides-global",
    message: `A project ${preset.serverName} entry already exists and will continue to override this global entry in the current project.`,
  };
}

function enabledOverlapOwners(cwd: string, preset: McpPreset): Set<string> {
  const enabled = new Set<string>();
  for (const overlap of preset.overlaps) {
    if (isSfPiExtensionEnabled(cwd, overlap.nativeExtensionId as SfPiExtensionId)) {
      enabled.add(overlap.nativeExtensionId);
    }
  }
  return enabled;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
