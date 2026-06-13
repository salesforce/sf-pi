/* SPDX-License-Identifier: Apache-2.0 */
/**
 * File-policy risk gate.
 *
 * Evaluates file Safety Subjects against configured policy rules and returns a
 * Guardrail Decision when the matching protection blocks the current tool.
 */
import { fingerprintPath } from "./fingerprint.ts";
import { blockedTools, matchPath } from "./policies.ts";
import type { ClassifiedDecision, FileSafetySubject, GuardrailConfig } from "./types.ts";

export function evaluateFilePolicy(
  subject: FileSafetySubject,
  cwd: string,
  config: GuardrailConfig,
): ClassifiedDecision | undefined {
  if (!config.enabled || !config.features.policies) return undefined;

  const matched = matchPath(subject.path, cwd, config.policies.rules);
  if (!matched) return undefined;

  const blocked = blockedTools(matched.rule.protection);
  if (!blocked.includes(subject.toolName)) return undefined;

  return {
    ruleId: matched.rule.id,
    feature: "policies",
    action: "block",
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
