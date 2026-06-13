/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Canonical off / confirm / hard-block rule behavior helpers.
 */
import type { RuleBehavior } from "./types.ts";

export interface BehaviorLike {
  behavior?: RuleBehavior;
  enabled?: boolean;
  action?: "confirm" | "block";
  protection?: "none" | string;
}

export function resolveRuleBehavior(rule: BehaviorLike): RuleBehavior {
  if (rule.enabled === false) return "off";
  if (rule.behavior === "off" || rule.behavior === "confirm" || rule.behavior === "block") {
    return rule.behavior;
  }
  if (rule.protection === "none") return "off";
  if (rule.action === "block") return "block";
  return "confirm";
}

export function behaviorEnabled(behavior: RuleBehavior): boolean {
  return behavior !== "off";
}

export function behaviorToAction(behavior: RuleBehavior): "confirm" | "block" | undefined {
  if (behavior === "off") return undefined;
  return behavior;
}

export function labelForRuleBehavior(behavior: RuleBehavior): "off" | "confirm" | "hard block" {
  return behavior === "block" ? "hard block" : behavior;
}

export function ruleBehaviorFromLabel(value: string): RuleBehavior | undefined {
  if (value === "hard block" || value === "block") return "block";
  if (value === "confirm" || value === "off") return value;
  return undefined;
}
