/* SPDX-License-Identifier: Apache-2.0 */
/** Small orchestration layer shared by the command and Manager TUI surfaces. */
import {
  isSfPiExtensionEnabled,
  type SfPiExtensionId,
} from "../../../lib/common/sf-pi-extension-state.ts";
import { planPresetConflicts, type ConflictPlan } from "./conflict-planner.ts";
import {
  inspectMcpConfig,
  mcpConfigPath,
  replaceMcpServer,
  setMcpServerEnabled,
  upsertMcpServer,
  type McpServerConfig,
} from "./mcp-config.ts";
import {
  createManagedStateStore,
  inspectManagedServer,
  recordManagedServer,
  type ManagedServerInspection,
} from "./managed-state.ts";
import {
  SALESFORCE_MCP_PRESETS,
  buildServerConfig,
  getPreset,
  type McpPreset,
  type McpPresetId,
  type McpResolution,
  type PresetSetup,
} from "./presets.ts";

export interface PresetRuntimeState {
  preset: McpPreset;
  plan: ConflictPlan;
  managed: ManagedServerInspection;
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
  return {
    preset,
    plan: planPresetConflicts(preset, enabledOverlapOwners(cwd, preset)),
    managed: inspectManagedServer(file, store, preset.serverName),
    scopeConflict: inspectScopeConflict(cwd, scope, preset),
  };
}

export function installPreset(input: {
  cwd: string;
  scope: "global" | "project";
  presetId: McpPresetId;
  resolution: McpResolution;
  setup?: PresetSetup;
}): PresetMutationResult {
  const preset = getPreset(input.presetId);
  if (input.resolution === "native-only") {
    return {
      ok: true,
      preset,
      resolution: input.resolution,
      path: mcpConfigPath(input.cwd, input.scope),
      changed: false,
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
  const managed = inspectManagedServer(file, store, preset.serverName);
  if (managed.status === "manual") {
    return {
      ok: false,
      message: `${preset.serverName} already exists as a manual Pi MCP entry. SF MCP will not overwrite it.`,
    };
  }
  if (managed.status === "modified") {
    return {
      ok: false,
      message: `${preset.serverName} changed outside SF MCP. Review it in /mcp before replacing it.`,
    };
  }
  if (managed.status === "invalid-config") {
    return { ok: false, message: managed.message ?? "The native MCP configuration is invalid." };
  }

  const mutation =
    managed.status === "missing"
      ? upsertMcpServer(file, preset.serverName, config)
      : replaceMcpServer(file, preset.serverName, config);
  if (mutation.ok === false) return { ok: false, message: mutation.message };

  recordManagedServer(store, preset.serverName, {
    presetId: preset.id,
    resolution: input.resolution,
    config,
  });
  return {
    ok: true,
    preset,
    resolution: input.resolution,
    path: file,
    changed: true,
    message: `Enabled ${preset.label} in ${file}. Reload Pi, then use /mcp to connect or sign in.`,
  };
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
  const managed = inspectManagedServer(file, store, preset.serverName);
  if (managed.status !== "managed-enabled" && managed.status !== "managed-disabled") {
    return {
      ok: false,
      message: `${preset.label} is not an unchanged SF MCP-managed entry. It was not modified.`,
    };
  }

  const mutation = setMcpServerEnabled(file, preset.serverName, input.enabled);
  if (mutation.ok === false) return { ok: false, message: mutation.message };
  const inspected = inspectMcpConfig(file);
  if (inspected.ok === false) return { ok: false, message: inspected.message };
  const config = inspected.servers[preset.serverName];
  if (!config) return { ok: false, message: `${preset.serverName} disappeared after update.` };
  recordManagedServer(store, preset.serverName, {
    presetId: preset.id,
    resolution: managed.record?.resolution ?? "enable",
    config,
  });
  return {
    ok: true,
    preset,
    resolution: managed.record?.resolution ?? "enable",
    path: file,
    changed: true,
    message: `${input.enabled ? "Enabled" : "Disabled"} ${preset.label} in ${file}.`,
  };
}

function inspectScopeConflict(
  cwd: string,
  scope: "global" | "project",
  preset: McpPreset,
): PresetRuntimeState["scopeConflict"] {
  const otherScope = scope === "global" ? "project" : "global";
  const other = inspectMcpConfig(mcpConfigPath(cwd, otherScope));
  if (other.ok === false || !other.servers[preset.serverName]) return undefined;
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
