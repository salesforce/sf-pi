/* SPDX-License-Identifier: Apache-2.0 */
/** Pi settings-backed preferences for SF Agent Script. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";

export const PREVIEW_MOCK_MODES = ["Mock", "Live Test"] as const;
export const EVAL_TRACE_MODES = ["failed", "all", "off"] as const;
export const EVAL_CONCURRENCY_VALUES = [4, 8, 16] as const;

export type AgentScriptSettingsScope = "global" | "project";
export type PreviewMockMode = (typeof PREVIEW_MOCK_MODES)[number];
export type EvalTraceMode = (typeof EVAL_TRACE_MODES)[number];
export type EvalConcurrency = (typeof EVAL_CONCURRENCY_VALUES)[number];

export interface AgentScriptSettings {
  previewMockMode: PreviewMockMode;
  evalTracesMode: EvalTraceMode;
  evalConcurrency: EvalConcurrency;
}

export interface EffectiveAgentScriptSettings extends AgentScriptSettings {
  source: AgentScriptSettingsScope | "default";
  path?: string;
}

export const DEFAULT_AGENT_SCRIPT_SETTINGS: AgentScriptSettings = {
  previewMockMode: "Mock",
  evalTracesMode: "failed",
  evalConcurrency: 8,
};

export function readEffectiveAgentScriptSettings(cwd: string): EffectiveAgentScriptSettings {
  const projectPath = projectSettingsPath(cwd);
  const project = readSettingsFile(projectPath);
  if (project.exists) return { ...project.settings, source: "project", path: projectPath };
  const globalPath = globalSettingsPath();
  const global = readSettingsFile(globalPath);
  if (global.exists) return { ...global.settings, source: "global", path: globalPath };
  return { ...DEFAULT_AGENT_SCRIPT_SETTINGS, source: "default" };
}

export function writeScopedAgentScriptSettings(
  cwd: string,
  scope: AgentScriptSettingsScope,
  settings: AgentScriptSettings,
): EffectiveAgentScriptSettings {
  const filePath = scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
  const root = readJsonFile(filePath);
  const sfPi = { ...nestedRecord(root, "sfPi") };
  sfPi.agentScript = normalizeAgentScriptSettings(settings);
  root.sfPi = sfPi;
  writeJsonFile(filePath, root);
  return { ...normalizeAgentScriptSettings(settings), source: scope, path: filePath };
}

export function normalizeAgentScriptSettings(value: unknown): AgentScriptSettings {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    previewMockMode: PREVIEW_MOCK_MODES.includes(candidate.previewMockMode as PreviewMockMode)
      ? (candidate.previewMockMode as PreviewMockMode)
      : DEFAULT_AGENT_SCRIPT_SETTINGS.previewMockMode,
    evalTracesMode: EVAL_TRACE_MODES.includes(candidate.evalTracesMode as EvalTraceMode)
      ? (candidate.evalTracesMode as EvalTraceMode)
      : DEFAULT_AGENT_SCRIPT_SETTINGS.evalTracesMode,
    evalConcurrency: EVAL_CONCURRENCY_VALUES.includes(candidate.evalConcurrency as EvalConcurrency)
      ? (candidate.evalConcurrency as EvalConcurrency)
      : DEFAULT_AGENT_SCRIPT_SETTINGS.evalConcurrency,
  };
}

function readSettingsFile(filePath: string): { settings: AgentScriptSettings; exists: boolean } {
  const root = readJsonFile(filePath);
  const agentScript = nestedRecord(nestedRecord(root, "sfPi"), "agentScript");
  return {
    settings: normalizeAgentScriptSettings(agentScript),
    exists:
      Object.prototype.hasOwnProperty.call(agentScript, "previewMockMode") ||
      Object.prototype.hasOwnProperty.call(agentScript, "evalTracesMode") ||
      Object.prototype.hasOwnProperty.call(agentScript, "evalConcurrency"),
  };
}

function nestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
