/* SPDX-License-Identifier: Apache-2.0 */
/** Pure LLM follow-up builder for deferred Code Analyzer auto-scans. */
import { renderActionableFindings } from "./display.ts";
import type { CodeAnalyzerRunJson, CodeAnalyzerViolation } from "./types.ts";

export interface AutoScanFollowUpGroup {
  selector: string;
  targetCount: number;
  reportFile?: string;
  violations: CodeAnalyzerViolation[];
}

export interface AutoScanFollowUpInput {
  groups: AutoScanFollowUpGroup[];
  broaderValidation?: string;
}

export function buildAutoScanFollowUp(input: AutoScanFollowUpInput): string | undefined {
  const violations = input.groups.flatMap((group) => group.violations);
  if (violations.length === 0) return undefined;

  const run: CodeAnalyzerRunJson = { violations };
  const findings = renderActionableFindings(run);
  if (!findings) return undefined;

  return [
    "<sf_code_analyzer>",
    "Deferred Code Analyzer scan completed after the edit pass.",
    "",
    "Groups:",
    ...input.groups.map(formatGroup),
    "",
    "Reports:",
    ...input.groups.map((group) => `- ${group.selector}: ${group.reportFile ?? "none"}`),
    "",
    findings,
    input.broaderValidation ? "" : undefined,
    input.broaderValidation ? "Optional broader validation:" : undefined,
    input.broaderValidation,
    "",
    "Please fix the actionable findings, then run relevant verification.",
    "</sf_code_analyzer>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function formatGroup(group: AutoScanFollowUpGroup): string {
  const targetLabel = `${group.targetCount} target${group.targetCount === 1 ? "" : "s"}`;
  const findingLabel = `${group.violations.length} finding${group.violations.length === 1 ? "" : "s"}`;
  return `- ${group.selector} (${targetLabel}, ${findingLabel})`;
}
