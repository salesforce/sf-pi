/* SPDX-License-Identifier: Apache-2.0 */
/** Browser Evidence Display Policy for automatic SF Browser checkpoints. */
import type { LightningWaitModeValue } from "./lightning-wait.ts";

const MUTATION_REASON_PATTERN =
  /\b(save|deploy|enable|disable|delete|remove|assign|create|update|submit|activate|deactivate)\b/i;

export function shouldCaptureMutationBefore(input: {
  mutation?: boolean;
  reason?: string;
}): boolean {
  if (input.mutation === true) return true;
  if (input.mutation === false) return false;
  return MUTATION_REASON_PATTERN.test(input.reason ?? "");
}

export function evidenceLabelForMutationBefore(action: "click" | "press", target: string): string {
  return `before-mutation-${action}-${target}`;
}

export function checkpointEvidenceLabel(input: {
  lightning?: LightningWaitModeValue;
  checkpointEvidence?: boolean;
}): string | undefined {
  if (input.checkpointEvidence === false) return undefined;
  if (input.lightning === "navigation-ready") return "checkpoint-navigation-ready";
  if (input.lightning === "record-view") return "checkpoint-record-view";
  if (input.lightning === "save-result") return "after-mutation-save-result";
  if (input.checkpointEvidence === true && input.lightning) {
    return `checkpoint-${input.lightning}`;
  }
  return undefined;
}
