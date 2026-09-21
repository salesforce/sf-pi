/* SPDX-License-Identifier: Apache-2.0 */
/** Profile-aware SF Flow quality execution with explicit coverage. */

import type { FlowFinding } from "../types.ts";
import type { FlowQualityFacts } from "./facts.ts";
import { FLOW_QUALITY_RULES, type FlowQualityProfile, type FlowQualityRule } from "./catalog.ts";
import { QUALITY_EVALUATORS } from "./rules.ts";

export interface FlowQualityRun {
  findings: FlowFinding[];
  ran: string[];
  skipped: Array<{ id: string; reason: string }>;
}

export function runFlowQuality(
  facts: FlowQualityFacts,
  profile: FlowQualityProfile,
): FlowQualityRun {
  const findings: FlowFinding[] = [];
  const ran: string[] = [];
  const skipped: FlowQualityRun["skipped"] = [];
  const seen = new Set<string>();

  for (const rule of FLOW_QUALITY_RULES) {
    if (!rule.profiles.includes(profile) || rule.engine === "core") continue;
    if (rule.implementation === "planned") {
      skipped.push({ id: rule.id, reason: "planned rule has no local evaluator yet" });
      continue;
    }
    if (!supportsFamily(rule, facts.model.family)) {
      skipped.push({ id: rule.id, reason: `not applicable to ${facts.model.family}` });
      continue;
    }
    const evaluator = QUALITY_EVALUATORS[rule.id];
    if (!evaluator) {
      skipped.push({ id: rule.id, reason: "implemented catalog entry has no evaluator" });
      continue;
    }
    evaluator(facts, (input) => {
      const finding: FlowFinding = {
        rule_id: rule.id,
        severity: input.severity ?? rule.default_severity,
        message: input.message ?? rule.message,
        line: input.node?.line ?? 1,
        column: input.node?.column ?? 1,
        element: input.element,
      };
      const key = `${finding.rule_id}:${finding.line}:${finding.column}:${finding.element ?? ""}:${finding.message}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push(finding);
    });
    ran.push(rule.id);
  }
  return { findings, ran, skipped };
}

function supportsFamily(
  rule: FlowQualityRule,
  family: FlowQualityFacts["model"]["family"],
): boolean {
  return (
    rule.supported_families[0] === "all" ||
    (rule.supported_families as readonly string[]).includes(family)
  );
}
