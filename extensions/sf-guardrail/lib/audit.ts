/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Audit trail for sf-guardrail decisions.
 *
 * Every classified decision — whether allowed, blocked, or deferred to the
 * user — emits a `sf-guardrail-decision` entry. The entries participate in
 * session navigation (/tree, /fork, /resume) and are read back by
 * `/sf-guardrail audit`.
 */
import type { ExtensionAPI, ExtensionContext, CustomEntry } from "@mariozechner/pi-coding-agent";
import {
  DECISION_ENTRY_TYPE,
  type ClassifiedDecision,
  type DecisionEntryData,
  type DecisionOutcome,
} from "./types.ts";

export function record(
  pi: ExtensionAPI,
  decision: ClassifiedDecision,
  outcome: DecisionOutcome,
  toolName: string,
): void {
  const data: DecisionEntryData = {
    timestamp: Date.now(),
    ruleId: decision.ruleId,
    feature: decision.feature,
    outcome,
    toolName,
    subject: decision.subject,
    fingerprint: decision.fingerprint,
    orgAlias: decision.orgAlias,
    orgType: decision.orgType,
    reason: decision.reason,
  };
  pi.appendEntry(DECISION_ENTRY_TYPE, data);
}

function isDecisionEntry(entry: unknown): entry is CustomEntry<DecisionEntryData> {
  if (!entry || typeof entry !== "object") return false;
  const c = entry as { type?: string; customType?: string; data?: { ruleId?: unknown } };
  return c.type === "custom" && c.customType === DECISION_ENTRY_TYPE && !!c.data?.ruleId;
}

export function readRecent(ctx: ExtensionContext, limit = 50): DecisionEntryData[] {
  const out: DecisionEntryData[] = [];
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
    const entry = entries[i];
    if (isDecisionEntry(entry)) out.push(entry.data);
  }
  return out;
}
