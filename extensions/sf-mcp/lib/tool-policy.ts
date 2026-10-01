/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic, drift-safe exposure policy for reviewed Salesforce MCP tools. */
import type { McpServerConfig } from "./mcp-config.ts";
import type { McpPreset } from "./presets.ts";
import { getPresetToolCatalog, inspectPresetTools } from "./tool-catalog.ts";

export type ToolExposureMode = "hidden" | "codemode" | "deferred" | "direct";
export type ToolPolicyProfile =
  "recommended" | "read-only" | "all-approved" | "custom" | "quarantine";

export interface ToolExposurePolicy {
  profile: ToolPolicyProfile;
  exposures: Record<string, ToolExposureMode>;
  locked: string[];
  unavailable: string[];
}

export interface ToolPolicyProfileOption {
  id: ToolPolicyProfile;
  label: string;
  description: string;
}

export const TOOL_POLICY_PROFILES: readonly ToolPolicyProfileOption[] = [
  {
    id: "recommended",
    label: "Recommended",
    description:
      "Use the reviewed SF Pi default. Phase 2 preserves the current approved Code Mode contract.",
  },
  {
    id: "read-only",
    label: "Read-only",
    description: "Expose approved read tools through Code Mode and keep every other tool hidden.",
  },
  {
    id: "all-approved",
    label: "All approved",
    description: "Expose every available tool in the reviewed contract through Code Mode.",
  },
  {
    id: "custom",
    label: "Custom",
    description:
      "Start from the current configuration and choose each tool's exposure individually.",
  },
  {
    id: "quarantine",
    label: "Quarantine",
    description:
      "Keep every reviewed tool hidden while preserving the server connection configuration.",
  },
];

const EXPOSURE_ORDER: readonly ToolExposureMode[] = ["hidden", "codemode", "deferred", "direct"];

export function hasReviewedToolPolicy(preset: McpPreset): boolean {
  return getPresetToolCatalog(preset).tools.length > 0;
}

export function buildToolExposurePolicy(
  preset: McpPreset,
  profile: ToolPolicyProfile,
  currentConfig?: McpServerConfig,
): ToolExposurePolicy {
  const tools = inspectPresetTools(preset);
  const documented = tools.filter((tool) => tool.documented);
  if (documented.length === 0) {
    throw new Error(`${preset.label} has no reviewed per-tool contract to configure.`);
  }
  const hasLiveContract = tools.some((tool) => tool.observed);
  const unavailable = hasLiveContract
    ? documented.filter((tool) => !tool.observed).map((tool) => tool.name)
    : [];
  const locked = tools
    .filter((tool) => !tool.documented && tool.observed)
    .map((tool) => tool.name)
    .sort();
  const unavailableSet = new Set(unavailable);
  const exposures: Record<string, ToolExposureMode> = {};
  for (const tool of documented) {
    exposures[tool.name] = unavailableSet.has(tool.name)
      ? "hidden"
      : exposureForProfile(profile, tool.risk, currentConfig, tool.name);
  }
  return { profile, exposures, locked, unavailable };
}

export function customizeToolExposure(
  preset: McpPreset,
  policy: ToolExposurePolicy,
  toolName: string,
  exposure: ToolExposureMode,
): ToolExposurePolicy {
  const tool = inspectPresetTools(preset).find((candidate) => candidate.name === toolName);
  if (!tool?.documented) {
    throw new Error(`${toolName} is not part of ${preset.label}'s reviewed tool contract.`);
  }
  if (policy.unavailable.includes(toolName)) {
    throw new Error(`${toolName} is not advertised by the connected server.`);
  }
  return {
    ...policy,
    profile: "custom",
    exposures: { ...policy.exposures, [toolName]: exposure },
  };
}

export function cycleToolExposure(
  preset: McpPreset,
  policy: ToolExposurePolicy,
  toolName: string,
  delta: -1 | 1,
): ToolExposurePolicy {
  const current = policy.exposures[toolName] ?? "hidden";
  const index = EXPOSURE_ORDER.indexOf(current);
  const next = EXPOSURE_ORDER[(index + delta + EXPOSURE_ORDER.length) % EXPOSURE_ORDER.length];
  if (!next) return policy;
  return customizeToolExposure(preset, policy, toolName, next);
}

export function applyToolExposurePolicy(
  preset: McpPreset,
  config: McpServerConfig,
  policy: ToolExposurePolicy,
): McpServerConfig {
  validateToolExposurePolicy(preset, policy);
  const toolExposure = Object.fromEntries(
    getPresetToolCatalog(preset).tools.map((tool) => [
      tool.name,
      policy.exposures[tool.name] ?? "hidden",
    ]),
  );
  return { ...config, exposure: "hidden", toolExposure };
}

export function validateToolExposurePolicy(preset: McpPreset, policy: ToolExposurePolicy): void {
  const reviewed = getPresetToolCatalog(preset).tools.map((tool) => tool.name);
  const reviewedSet = new Set(reviewed);
  const configured = Object.keys(policy.exposures);
  const missing = reviewed.filter((tool) => !(tool in policy.exposures));
  const unknown = configured.filter((tool) => !reviewedSet.has(tool));
  const unavailableExposed = policy.unavailable.filter(
    (tool) => policy.exposures[tool] !== "hidden",
  );
  if (missing.length > 0 || unknown.length > 0 || unavailableExposed.length > 0) {
    throw new Error(
      `${preset.label} tool policy is not valid` +
        `${missing.length > 0 ? `; missing ${missing.join(", ")}` : ""}` +
        `${unknown.length > 0 ? `; unknown ${unknown.join(", ")}` : ""}` +
        `${unavailableExposed.length > 0 ? `; unavailable tools must stay hidden: ${unavailableExposed.join(", ")}` : ""}.`,
    );
  }
}

export function toolPolicyWarnings(preset: McpPreset, policy: ToolExposurePolicy): string[] {
  const tools = new Map(inspectPresetTools(preset).map((tool) => [tool.name, tool]));
  const warnings: string[] = [];
  for (const [name, exposure] of Object.entries(policy.exposures)) {
    if (exposure !== "direct") continue;
    const risk = tools.get(name)?.risk ?? "unknown";
    if (risk === "read") continue;
    warnings.push(
      `${name} uses Direct exposure with ${riskLabel(risk)} risk; it will be declared to the model on every turn.`,
    );
  }
  return warnings;
}

export function profileLabel(profile: ToolPolicyProfile): string {
  return TOOL_POLICY_PROFILES.find((option) => option.id === profile)?.label ?? profile;
}

export function exposureLabel(exposure: ToolExposureMode): string {
  switch (exposure) {
    case "codemode":
      return "Code Mode";
    case "deferred":
      return "Deferred";
    case "direct":
      return "Direct";
    default:
      return "Hidden";
  }
}

function exposureForProfile(
  profile: ToolPolicyProfile,
  risk: ReturnType<typeof inspectPresetTools>[number]["risk"],
  currentConfig: McpServerConfig | undefined,
  toolName: string,
): ToolExposureMode {
  if (profile === "quarantine") return "hidden";
  if (profile === "read-only") return risk === "read" ? "codemode" : "hidden";
  if (profile === "custom") return configuredExposure(currentConfig, toolName);
  return "codemode";
}

function configuredExposure(
  config: McpServerConfig | undefined,
  toolName: string,
): ToolExposureMode {
  if (!config) return "codemode";
  const exact = config.toolExposure?.[toolName];
  if (isToolExposureMode(exact)) return exact;
  for (const [pattern, exposure] of Object.entries(config.toolExposure ?? {})) {
    if (!pattern.includes("*") || !isToolExposureMode(exposure)) continue;
    if (matchesPattern(pattern, toolName)) return exposure;
  }
  return isToolExposureMode(config.exposure) ? config.exposure : "codemode";
}

function matchesPattern(pattern: string, toolName: string): boolean {
  const expression = new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );
  return expression.test(toolName);
}

function isToolExposureMode(value: unknown): value is ToolExposureMode {
  return typeof value === "string" && EXPOSURE_ORDER.includes(value as ToolExposureMode);
}

function riskLabel(risk: string): string {
  return `${risk.slice(0, 1).toUpperCase()}${risk.slice(1)}`;
}
