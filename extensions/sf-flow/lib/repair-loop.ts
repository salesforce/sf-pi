/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded, progress-gated repair-loop state for Flow edit feedback. */

import { createHash } from "node:crypto";
import type { FlowFinding } from "./types.ts";

const DEFAULT_MAX_ROUNDS = 3;

interface FileRepairState {
  round: number;
  signature: string;
}

export interface FlowRepairLoopState {
  files: Map<string, FileRepairState>;
}

export interface FlowRepairDecision {
  status: "clean" | "continue" | "stopped";
  round: number;
  max_rounds: number;
  signature?: string;
  reason?: "repeated-signature" | "round-limit";
  actionable: FlowFinding[];
  message: string;
}

export function createRepairLoopState(): FlowRepairLoopState {
  return { files: new Map() };
}

export function advanceRepairLoop(
  state: FlowRepairLoopState,
  file: string,
  findings: FlowFinding[],
  maxRounds = DEFAULT_MAX_ROUNDS,
): FlowRepairDecision {
  const actionable = findings.filter(
    (finding) => finding.severity === "high" || finding.severity === "moderate",
  );
  if (!actionable.length) {
    state.files.delete(file);
    return {
      status: "clean",
      round: 0,
      max_rounds: maxRounds,
      actionable,
      message: "No High or Moderate generation findings remain.",
    };
  }

  const signature = findingSignature(actionable);
  const prior = state.files.get(file);
  if (prior?.signature === signature) {
    return {
      status: "stopped",
      round: prior.round,
      max_rounds: maxRounds,
      signature,
      reason: "repeated-signature",
      actionable,
      message: "Repair loop stopped because the actionable finding signature did not change.",
    };
  }
  if (prior && prior.round >= maxRounds) {
    return {
      status: "stopped",
      round: prior.round,
      max_rounds: maxRounds,
      signature,
      reason: "round-limit",
      actionable,
      message: `Repair loop stopped after ${maxRounds} actionable rounds.`,
    };
  }

  const round = (prior?.round ?? 0) + 1;
  state.files.set(file, { round, signature });
  return {
    status: "continue",
    round,
    max_rounds: maxRounds,
    signature,
    actionable,
    message: `Repair round ${round}/${maxRounds}: fix the reported High and Moderate findings with the smallest relevant edit.`,
  };
}

export function findingSignature(findings: FlowFinding[]): string {
  const identity = findings
    .map(
      (finding) => `${finding.rule_id}:${finding.line}:${finding.column}:${finding.element ?? ""}`,
    )
    .sort()
    .join("|");
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}
