/* SPDX-License-Identifier: Apache-2.0 */
/** Pi settings-backed preferences for SF Feedback. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import type { IssueKind } from "./types.ts";

export const FEEDBACK_DEFAULT_KINDS = ["bug", "feature", "setup", "feedback"] as const;
export type FeedbackSettingsScope = "global" | "project";

export interface FeedbackSettings {
  defaultIssueKind: IssueKind;
}

export interface EffectiveFeedbackSettings extends FeedbackSettings {
  source: FeedbackSettingsScope | "default";
  path?: string;
}

export const DEFAULT_FEEDBACK_SETTINGS: FeedbackSettings = { defaultIssueKind: "feedback" };

export function readEffectiveFeedbackSettings(cwd: string): EffectiveFeedbackSettings {
  const projectPath = projectSettingsPath(cwd);
  const project = readSettingsFile(projectPath);
  if (project.exists) return { ...project.settings, source: "project", path: projectPath };
  const globalPath = globalSettingsPath();
  const global = readSettingsFile(globalPath);
  if (global.exists) return { ...global.settings, source: "global", path: globalPath };
  return { ...DEFAULT_FEEDBACK_SETTINGS, source: "default" };
}

export function writeScopedFeedbackSettings(
  cwd: string,
  scope: FeedbackSettingsScope,
  settings: FeedbackSettings,
): EffectiveFeedbackSettings {
  const filePath = scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
  const root = readJsonFile(filePath);
  const sfPi = { ...nestedRecord(root, "sfPi") };
  sfPi.feedback = normalizeFeedbackSettings(settings);
  root.sfPi = sfPi;
  writeJsonFile(filePath, root);
  return { ...normalizeFeedbackSettings(settings), source: scope, path: filePath };
}

export function normalizeFeedbackSettings(value: unknown): FeedbackSettings {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    defaultIssueKind: FEEDBACK_DEFAULT_KINDS.includes(candidate.defaultIssueKind as IssueKind)
      ? (candidate.defaultIssueKind as IssueKind)
      : DEFAULT_FEEDBACK_SETTINGS.defaultIssueKind,
  };
}

function readSettingsFile(filePath: string): { settings: FeedbackSettings; exists: boolean } {
  const root = readJsonFile(filePath);
  const feedback = nestedRecord(nestedRecord(root, "sfPi"), "feedback");
  return {
    settings: normalizeFeedbackSettings(feedback),
    exists: Object.prototype.hasOwnProperty.call(feedback, "defaultIssueKind"),
  };
}

function nestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
