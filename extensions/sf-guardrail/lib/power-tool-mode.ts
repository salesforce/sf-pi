/* SPDX-License-Identifier: Apache-2.0 */
/** Persisted Power Tool Mode helpers for SF Guardrail. */
import type { ClassifiedDecision } from "./types.ts";

export type GuardrailPowerToolMode = "off" | "native" | "all";
export type GuardrailNativeToolFamily =
  "apex" | "agentscript" | "data360" | "browser" | "slack" | "soql";

export interface GuardrailPowerToolSettings {
  mode?: GuardrailPowerToolMode;
  nativeFamilies?: GuardrailNativeToolFamily[];
  productionUnknown?: boolean;
}

export const NATIVE_TOOL_FAMILIES: Array<{
  id: GuardrailNativeToolFamily;
  label: string;
  description: string;
}> = [
  { id: "apex", label: "Apex Anonymous Apex", description: "sf_apex anon.run" },
  {
    id: "agentscript",
    label: "AgentScript lifecycle",
    description: "publish, activate, provision",
  },
  { id: "data360", label: "Data 360 execution", description: "confirmed Data 360 actions" },
  { id: "browser", label: "SF Browser commits", description: "Save/Delete/Activate UI gestures" },
  { id: "slack", label: "Slack Canvas writes", description: "slack_canvas create/edit" },
  { id: "soql", label: "SOQL disclosures", description: "export, queryAll, unbounded reads" },
];

export function defaultNativeFamilies(): GuardrailNativeToolFamily[] {
  return NATIVE_TOOL_FAMILIES.map((family) => family.id);
}

export function normalizePowerToolSettings(input: unknown): GuardrailPowerToolSettings | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const mode = isPowerToolMode(raw.mode) ? raw.mode : undefined;
  const nativeFamilies = Array.isArray(raw.nativeFamilies)
    ? raw.nativeFamilies.filter(isNativeToolFamily)
    : undefined;
  const productionUnknown =
    typeof raw.productionUnknown === "boolean" ? raw.productionUnknown : undefined;
  const next: GuardrailPowerToolSettings = {};
  if (mode) next.mode = mode;
  if (nativeFamilies) next.nativeFamilies = [...new Set(nativeFamilies)];
  if (productionUnknown !== undefined) next.productionUnknown = productionUnknown;
  return Object.keys(next).length ? next : undefined;
}

export function powerToolModeLabel(mode: GuardrailPowerToolMode | undefined): string {
  switch (mode ?? "off") {
    case "native":
      return "Native tools only";
    case "all":
      return "All confirm-class decisions";
    case "off":
      return "Off";
  }
}

export function enabledNativeFamilies(
  settings: GuardrailPowerToolSettings | undefined,
): Set<GuardrailNativeToolFamily> {
  const families = settings?.nativeFamilies?.length
    ? settings.nativeFamilies
    : defaultNativeFamilies();
  return new Set(families);
}

export function shouldPowerToolAutoApprove(
  decision: ClassifiedDecision,
  settings: GuardrailPowerToolSettings | undefined,
): boolean {
  const mode = settings?.mode ?? "off";
  if (mode === "off") return false;
  if (isProductionLikeDecision(decision) && settings?.productionUnknown !== true) return false;
  if (mode === "all") return true;
  if (decision.feature !== "nativeToolGate") return false;
  const family = nativeToolFamilyForDecision(decision);
  return !!family && enabledNativeFamilies(settings).has(family);
}

export function nativeToolFamilyForDecision(
  decision: Pick<ClassifiedDecision, "feature" | "approvalScope" | "ruleId">,
): GuardrailNativeToolFamily | undefined {
  if (decision.feature !== "nativeToolGate") return undefined;
  const family = decision.approvalScope?.operationFamily ?? "";
  if (family === "anonymous apex") return "apex";
  if (family.startsWith("agent ")) return "agentscript";
  if (family.startsWith("data360")) return "data360";
  if (family === "browser commit") return "browser";
  if (family === "slack canvas write") return "slack";
  if (family.startsWith("soql ")) return "soql";
  return undefined;
}

function isProductionLikeDecision(decision: ClassifiedDecision): boolean {
  return decision.orgType === "production" || decision.orgResolutionGuessed === true;
}

function isPowerToolMode(value: unknown): value is GuardrailPowerToolMode {
  return value === "off" || value === "native" || value === "all";
}

function isNativeToolFamily(value: unknown): value is GuardrailNativeToolFamily {
  return typeof value === "string" && NATIVE_TOOL_FAMILIES.some((family) => family.id === value);
}
