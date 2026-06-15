/* SPDX-License-Identifier: Apache-2.0 */
/**
 * File-policy risk gate.
 *
 * Evaluates file Safety Subjects against configured policy rules and returns a
 * Guardrail Decision when the matching protection blocks the current tool.
 */
import { fingerprintPath } from "./fingerprint.ts";
import { blockedTools, matchPath } from "./policies.ts";
import { behaviorToAction, resolveRuleBehavior } from "./rule-behavior.ts";
import type { ClassifiedDecision, FileSafetySubject, GuardrailConfig } from "./types.ts";

export function evaluateFilePolicy(
  subject: FileSafetySubject,
  cwd: string,
  config: GuardrailConfig,
): ClassifiedDecision | undefined {
  const matched = matchPath(subject.path, cwd, config.policies.rules);
  if (!matched) return undefined;

  const behavior = resolveRuleBehavior(matched.rule);
  const action = behaviorToAction(behavior);
  if (!action) return undefined;

  const blocked = blockedTools(matched.rule.protection);
  if (!blocked.includes(subject.toolName)) return undefined;

  return {
    ruleId: matched.rule.id,
    feature: "policies",
    action,
    reason: renderBlockMessage(matched.rule.blockMessage, { file: subject.path }),
    fingerprint: fingerprintPath(subject.path),
    subject: subject.path,
  };
}

function renderBlockMessage(template: string | undefined, vars: Record<string, string>): string {
  const fallback = `Blocked by sf-guardrail.`;
  const source = template ?? fallback;
  return source.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
}
