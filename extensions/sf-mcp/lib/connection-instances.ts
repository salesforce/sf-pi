/* SPDX-License-Identifier: Apache-2.0 */
/** Preset-first projections for SF MCP connection-instance Manager views. */

import type { McpPreset } from "./presets.ts";
import {
  inspectPresetInstances,
  inspectPresetRuntime,
  type PresetRuntimeState,
} from "./service.ts";

export function inspectInstanceSummary(
  cwd: string,
  scope: "global" | "project",
  preset: McpPreset,
): {
  instances: PresetRuntimeState[];
  configured: PresetRuntimeState[];
  primary: PresetRuntimeState;
} {
  const instances = inspectPresetInstances(cwd, scope, preset);
  const configured = instances.filter((instance) => instance.managed.status !== "missing");
  return {
    instances,
    configured,
    primary: configured[0] ?? instances[0] ?? inspectPresetRuntime(cwd, scope, preset),
  };
}

export function formatInstances(instances: readonly PresetRuntimeState[]): string {
  return instances
    .map((instance) => {
      const binding = instance.managed.record?.orgBinding;
      const label = binding?.alias ?? binding?.targetOrg ?? "Unbound existing connection";
      return `${label} · ${instance.managed.configuredName ?? instance.connectionName} · ${instance.managed.status}`;
    })
    .join("\n");
}
