/* SPDX-License-Identifier: Apache-2.0 */
/** Pure contracts for the deeper sf-flow runtime proofs. */

export const ASYNC_BULK_COUNT = 200;
export const SCHEDULE_BULK_COUNT = 201;
export const COMPOSITE_TRANSACTION_LIMIT = 200;
export const DEPTH_CORRELATION_PREFIX = "SFPI-DEPTH-";
export const INTENTIONAL_UNHANDLED_FAULT_FLOW = "SfPi_Advanced_Subflow_Grandchild";
export const PROBE_OBJECT = "SfPi_Flow_Probe__c";

export const DEPTH_FLOW_API_NAMES = [
  "SfPi_Advanced_Async_Bulk",
  "SfPi_Advanced_Scheduled_Bulk",
  "SfPi_Advanced_Order_Before_First",
  "SfPi_Advanced_Order_Before_Second",
  "SfPi_Advanced_Order_After_First",
  "SfPi_Advanced_Order_After_Second",
  "SfPi_Advanced_Order_Equal_Before_A",
  "SfPi_Advanced_Order_Equal_Before_B",
  "SfPi_Advanced_Order_Unspecified_Before",
  "SfPi_Advanced_Order_Equal_After_A",
  "SfPi_Advanced_Order_Equal_After_B",
  "SfPi_Advanced_Subflow_Grandchild",
  "SfPi_Advanced_Subflow_Chain_Child",
  "SfPi_Advanced_Subflow_None_Child",
  "SfPi_Advanced_Subflow_Chain_Parent",
] as const;

export const PROBE_TRIGGERED_DEPTH_FLOWS = [
  "SfPi_Advanced_Async_Bulk",
  "SfPi_Advanced_Scheduled_Bulk",
  "SfPi_Advanced_Order_Before_First",
  "SfPi_Advanced_Order_Before_Second",
  "SfPi_Advanced_Order_After_First",
  "SfPi_Advanced_Order_After_Second",
  "SfPi_Advanced_Order_Equal_Before_A",
  "SfPi_Advanced_Order_Equal_Before_B",
  "SfPi_Advanced_Order_Unspecified_Before",
  "SfPi_Advanced_Order_Equal_After_A",
  "SfPi_Advanced_Order_Equal_After_B",
] as const;

export const EXPLICIT_ORDER_TOKENS = ["B10", "B20"] as const;
export const UNORDERED_BEFORE_TOKENS = ["E0", "E1", "E2"] as const;
export const UNORDERED_AFTER_TOKENS = ["A1", "A2"] as const;
export const SUCCESS_CHAIN_OUTPUT = "chain|grand";
export const HANDLED_CHAIN_OUTPUT = "handled";
export const NONE_TRIGGER_SUCCESS_OUTPUT = "chain|none";
export const NONE_TRIGGER_FAULT_OUTPUT = "none-trigger-fault";

export interface RecordCoverage {
  missing: string[];
  duplicates: string[];
  unexpected: string[];
}

export function compareRecordCoverage(
  expected: readonly string[],
  actual: readonly string[],
): RecordCoverage {
  const expectedSet = new Set(expected);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unexpected: string[] = [];
  for (const key of actual) {
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
    if (!expectedSet.has(key)) unexpected.push(key);
  }
  return {
    missing: expected.filter((key) => !seen.has(key)),
    duplicates,
    unexpected,
  };
}

export function recordCoverageFailure(coverage: RecordCoverage): string | undefined {
  if (!coverage.missing.length && !coverage.duplicates.length && !coverage.unexpected.length) {
    return undefined;
  }
  return `missing=${coverage.missing.length} duplicates=${coverage.duplicates.length} unexpected=${coverage.unexpected.length}`;
}

/** One sObject collection request is one transaction and cannot exceed the platform limit. */
export function assertSingleTransaction(count: number, records: readonly unknown[]): void {
  if (count !== records.length) {
    throw new Error(`Expected ${count} records in one transaction, received ${records.length}.`);
  }
  if (count > COMPOSITE_TRANSACTION_LIMIT) {
    throw new Error(
      `A single sObject collection transaction cannot exceed ${COMPOSITE_TRANSACTION_LIMIT} records.`,
    );
  }
}

export function sequenceTokens(value: string | undefined): string[] {
  return (value ?? "")
    .split(";")
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Accepts any order. Callers must not require one concatenation for equal or omitted triggerOrder. */
export function hasSameTokens(actual: string | undefined, expected: readonly string[]): boolean {
  const actualTokens = sequenceTokens(actual).sort();
  const expectedTokens = [...expected].sort();
  return (
    actualTokens.length === expectedTokens.length &&
    actualTokens.every((token, index) => token === expectedTokens[index])
  );
}

export function foreignProbeAutomation(input: {
  flows: ReadonlyArray<{ ApiName?: string }>;
  triggers: ReadonlyArray<{ Name?: string }>;
  allowed: readonly string[];
}): string[] {
  const allowed = new Set(input.allowed);
  const flows = input.flows
    .map((flow) => flow.ApiName)
    .filter((name): name is string => Boolean(name) && !allowed.has(name));
  const triggers = input.triggers
    .map((trigger) => trigger.Name)
    .filter((name): name is string => Boolean(name))
    .map((name) => `trigger:${name}`);
  return [...flows, ...triggers];
}

export function probeIsolationFailure(input: {
  flows: ReadonlyArray<{ ApiName?: string }>;
  triggers: ReadonlyArray<{ Name?: string }>;
  allowed: readonly string[];
  requireComplete: boolean;
}): string | undefined {
  const foreign = foreignProbeAutomation(input);
  if (foreign.length) return `foreign automation: ${foreign.join(", ")}`;
  if (input.requireComplete && input.flows.length !== input.allowed.length) {
    return `expected ${input.allowed.length} probe flows, found ${input.flows.length}`;
  }
  return undefined;
}

export function generationDiagnosisAccepted(
  fileName: string,
  findings: ReadonlyArray<{ rule_id: string; severity: string }>,
): boolean {
  const actionable = findings.filter(
    (finding) => finding.severity === "high" || finding.severity === "moderate",
  );
  if (fileName === `${INTENTIONAL_UNHANDLED_FAULT_FLOW}.flow-meta.xml`) {
    return (
      actionable.length === 1 &&
      actionable[0]?.rule_id === "missing-fault-path" &&
      actionable[0]?.severity === "moderate"
    );
  }
  return actionable.length === 0;
}

export function scheduleWaitSecondsFromFire(nextFire: number | undefined, now: number): number {
  if (nextFire === undefined || nextFire <= now || nextFire - now > 30 * 60_000) return 600;
  return Math.ceil((nextFire + 600_000 - now) / 1_000);
}

export function noneTriggerSubflowRejected(result: {
  isSuccess?: boolean;
  outputText?: string;
  faultMessage?: string;
}): boolean {
  if (result.outputText === NONE_TRIGGER_SUCCESS_OUTPUT) return false;
  return (
    result.isSuccess !== true ||
    result.outputText === NONE_TRIGGER_FAULT_OUTPUT ||
    Boolean(result.faultMessage)
  );
}
