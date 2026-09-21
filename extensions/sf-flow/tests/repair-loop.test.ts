/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { advanceRepairLoop, createRepairLoopState } from "../lib/repair-loop.ts";
import type { FlowFinding } from "../lib/types.ts";

function finding(rule_id: string, line: number): FlowFinding {
  return {
    rule_id,
    severity: "high",
    message: `${rule_id} finding`,
    line,
    column: 1,
  };
}

describe("bounded SF Flow repair loop", () => {
  it("continues for changed actionable findings and resets when clean", () => {
    const state = createRepairLoopState();
    expect(advanceRepairLoop(state, "A.flow", [finding("dml-in-loop", 10)])).toMatchObject({
      status: "continue",
      round: 1,
    });
    expect(advanceRepairLoop(state, "A.flow", [finding("missing-fault-path", 20)])).toMatchObject({
      status: "continue",
      round: 2,
    });
    expect(advanceRepairLoop(state, "A.flow", [])).toMatchObject({ status: "clean", round: 0 });
    expect(advanceRepairLoop(state, "A.flow", [finding("hardcoded-id", 30)])).toMatchObject({
      status: "continue",
      round: 1,
    });
  });

  it("stops on a repeated finding signature", () => {
    const state = createRepairLoopState();
    const findings = [finding("dml-in-loop", 10)];
    advanceRepairLoop(state, "A.flow", findings);

    expect(advanceRepairLoop(state, "A.flow", findings)).toMatchObject({
      status: "stopped",
      reason: "repeated-signature",
      round: 1,
    });
  });

  it("stops after three repair rounds", () => {
    const state = createRepairLoopState();
    advanceRepairLoop(state, "A.flow", [finding("one", 1)]);
    advanceRepairLoop(state, "A.flow", [finding("two", 2)]);
    advanceRepairLoop(state, "A.flow", [finding("three", 3)]);

    expect(advanceRepairLoop(state, "A.flow", [finding("four", 4)])).toMatchObject({
      status: "stopped",
      reason: "round-limit",
      round: 3,
    });
  });

  it("ignores Low and Info findings for agent steering", () => {
    const state = createRepairLoopState();
    const low: FlowFinding = { ...finding("missing-auto-layout", 1), severity: "low" };

    expect(advanceRepairLoop(state, "A.flow", [low])).toMatchObject({
      status: "clean",
      round: 0,
    });
  });
});
