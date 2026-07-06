/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Native Pi settings adapter for routine sf-guardrail preferences.
 *
 * Routine preferences live under `sfPi.guardrail` in Pi's global settings.json.
 * The advanced rule override file remains the escape hatch for custom patterns
 * and full bundled-rule replacement by stable id.
 */
import {
  globalSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import { normalizePowerToolSettings, type GuardrailPowerToolSettings } from "./power-tool-mode.ts";
import type { GuardrailConfig, RuleBehavior } from "./types.ts";
import { behaviorEnabled } from "./rule-behavior.ts";

export interface GuardrailSettingsRuleBehaviors {
  policies?: Record<string, RuleBehavior>;
  commandGate?: Record<string, RuleBehavior>;
  orgAwareGate?: Record<string, RuleBehavior>;
}

export interface GuardrailPiSettings {
  confirmTimeoutMs?: number;
  productionAliases?: string[];
  ruleBehaviors?: GuardrailSettingsRuleBehaviors;
  powerTool?: GuardrailPowerToolSettings;
}

const SF_PI_KEY = "sfPi";
const GUARDRAIL_KEY = "guardrail";

export function readGuardrailPiSettings(): GuardrailPiSettings {
  const root = readJsonFile(globalSettingsPath());
  return normalizeGuardrailPiSettings(readNestedObject(root, SF_PI_KEY, GUARDRAIL_KEY));
}

export function writeGuardrailPiSettings(settings: GuardrailPiSettings): void {
  const root = readJsonFile(globalSettingsPath());
  const sfPi = objectValue(root[SF_PI_KEY]);
  sfPi[GUARDRAIL_KEY] = pruneEmptyGuardrailSettings(normalizeGuardrailPiSettings(settings));
  root[SF_PI_KEY] = sfPi;
  writeJsonFile(globalSettingsPath(), root);
}

export function updateGuardrailPiSettings(
  updater: (settings: GuardrailPiSettings) => GuardrailPiSettings,
): GuardrailPiSettings {
  const next = updater(readGuardrailPiSettings());
  writeGuardrailPiSettings(next);
  return readGuardrailPiSettings();
}

export function hasGuardrailPiSettings(settings: GuardrailPiSettings): boolean {
  return (
    typeof settings.confirmTimeoutMs === "number" ||
    settings.productionAliases !== undefined ||
    settings.ruleBehaviors !== undefined ||
    settings.powerTool !== undefined
  );
}

export function applyGuardrailPiSettings(
  config: GuardrailConfig,
  settings: GuardrailPiSettings,
): GuardrailConfig {
  if (!hasGuardrailPiSettings(settings)) return config;

  const next: GuardrailConfig = JSON.parse(JSON.stringify(config)) as GuardrailConfig;

  if (typeof settings.confirmTimeoutMs === "number" && settings.confirmTimeoutMs > 0) {
    next.confirmTimeoutMs = settings.confirmTimeoutMs;
  }
  if (settings.productionAliases) {
    next.productionAliases = [...settings.productionAliases];
  }

  applyRuleBehaviors(next, settings.ruleBehaviors);
  return next;
}

export function setGuardrailTimeoutPreference(confirmTimeoutMs: number): GuardrailPiSettings {
  return updateGuardrailPiSettings((settings) => ({ ...settings, confirmTimeoutMs }));
}

export function setGuardrailProductionAliases(aliases: string[]): GuardrailPiSettings {
  return updateGuardrailPiSettings((settings) => ({ ...settings, productionAliases: aliases }));
}

export function setGuardrailPowerToolSettings(
  powerTool: GuardrailPowerToolSettings,
): GuardrailPiSettings {
  return updateGuardrailPiSettings((settings) => ({ ...settings, powerTool }));
}

export function setGuardrailRuleBehaviorPreference(
  section: keyof GuardrailSettingsRuleBehaviors,
  ruleId: string,
  behavior: RuleBehavior,
): GuardrailPiSettings {
  return updateGuardrailPiSettings((settings) => ({
    ...settings,
    ruleBehaviors: {
      ...(settings.ruleBehaviors ?? {}),
      [section]: {
        ...(settings.ruleBehaviors?.[section] ?? {}),
        [ruleId]: behavior,
      },
    },
  }));
}

function applyRuleBehaviors(
  config: GuardrailConfig,
  ruleBehaviors: GuardrailSettingsRuleBehaviors | undefined,
): void {
  for (const rule of config.policies.rules) {
    const behavior = ruleBehaviors?.policies?.[rule.id];
    if (behavior) {
      rule.behavior = behavior;
      rule.enabled = behaviorEnabled(behavior);
    }
  }
  for (const pattern of config.commandGate.patterns) {
    const behavior = ruleBehaviors?.commandGate?.[pattern.id];
    if (behavior) {
      pattern.behavior = behavior;
      pattern.enabled = behaviorEnabled(behavior);
    }
  }
  for (const rule of config.orgAwareGate.rules) {
    const behavior = ruleBehaviors?.orgAwareGate?.[rule.id];
    if (behavior) {
      rule.behavior = behavior;
      rule.enabled = behaviorEnabled(behavior);
    }
  }
}

function normalizeGuardrailPiSettings(input: unknown): GuardrailPiSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const next: GuardrailPiSettings = {};

  if (typeof raw.confirmTimeoutMs === "number" && raw.confirmTimeoutMs > 0) {
    next.confirmTimeoutMs = raw.confirmTimeoutMs;
  }
  if (Array.isArray(raw.productionAliases)) {
    next.productionAliases = raw.productionAliases.filter(
      (v): v is string => typeof v === "string",
    );
  }
  const ruleBehaviors = normalizeRuleBehaviors(raw.ruleBehaviors);
  if (ruleBehaviors) next.ruleBehaviors = ruleBehaviors;
  const powerTool = normalizePowerToolSettings(raw.powerTool);
  if (powerTool) next.powerTool = powerTool;

  return next;
}

function normalizeRuleBehaviors(input: unknown): GuardrailSettingsRuleBehaviors | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const next: GuardrailSettingsRuleBehaviors = {};
  for (const key of ["policies", "commandGate", "orgAwareGate"] as const) {
    const values = normalizeBehaviorMap(raw[key]);
    if (values) next[key] = values;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeBehaviorMap(input: unknown): Record<string, RuleBehavior> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const output: Record<string, RuleBehavior> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === "off" || value === "confirm" || value === "block") output[key] = value;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function pruneEmptyGuardrailSettings(settings: GuardrailPiSettings): GuardrailPiSettings {
  const next: GuardrailPiSettings = {};
  if (typeof settings.confirmTimeoutMs === "number")
    next.confirmTimeoutMs = settings.confirmTimeoutMs;
  if (settings.productionAliases) next.productionAliases = settings.productionAliases;
  if (settings.ruleBehaviors && Object.keys(settings.ruleBehaviors).length > 0) {
    next.ruleBehaviors = settings.ruleBehaviors;
  }
  if (settings.powerTool && Object.keys(settings.powerTool).length > 0) {
    next.powerTool = settings.powerTool;
  }
  return next;
}

function readNestedObject(root: Record<string, unknown>, first: string, second: string): unknown {
  const parent = root[first];
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) return undefined;
  return (parent as Record<string, unknown>)[second];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
