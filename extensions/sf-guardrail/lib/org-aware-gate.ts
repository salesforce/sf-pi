/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Org-aware gate — evaluate tokenized bash commands against the configured
 * `orgAwareGate.rules` in the context of the resolved target-org type.
 *
 * A rule fires only when both the AST match and the org-type filter match.
 * First fire wins; classify.ts stops iterating.
 */
import { matches, tokenize } from "./bash-ast.ts";
import type { OrgContext } from "./org-context.ts";
import type { OrgAwareRule } from "./types.ts";

export interface OrgAwareOutcome {
  rule: OrgAwareRule;
  command: string;
  org: OrgContext;
}

export function evaluateOrgAware(
  command: string,
  rules: OrgAwareRule[],
  org: OrgContext,
): OrgAwareOutcome | undefined {
  const tokens = tokenize(command);
  if (!tokens) return undefined;

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (!rule.whenOrgType.includes(org.type)) continue;
    if (!matches(tokens, rule.match.ast)) continue;
    return { rule, command, org };
  }
  return undefined;
}
