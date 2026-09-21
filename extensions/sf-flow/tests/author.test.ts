/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { buildAuthoringPlan, inferFlowFamily } from "../lib/author.ts";

const cases = [
  ["Collect request details from a user on a screen", "screen"],
  ["Create reusable logic called by another flow", "autolaunched"],
  ["Update the triggering record before it is saved", "record-triggered"],
  ["Run every day at midnight", "schedule-triggered"],
  ["Handle a platform event message", "platform-event-triggered"],
] as const;

describe("SF Flow authoring plans", () => {
  it.each(cases)("infers %s as %s", (intent, family) => {
    expect(inferFlowFamily(intent)).toEqual({ family, ambiguous: false });
  });

  it("does not silently choose before-save versus after-save", () => {
    const inferred = inferFlowFamily("When an account changes, update records");

    expect(inferred.family).toBe("record-triggered");
    expect(inferred.ambiguous).toBe(true);
    expect(inferred.choices).toEqual(expect.arrayContaining(["before-save", "after-save"]));
  });

  it("includes an interactive element in the Screen Flow skeleton", async () => {
    const result = await buildAuthoringPlan(
      { action: "author.plan", intent: "Collect request details from a user", flow_type: "screen" },
      process.cwd(),
    );

    expect(String(result.details.skeleton)).toContain("<screens>");
    expect(String(result.details.skeleton)).toContain(
      "<targetReference>TODO_Screen</targetReference>",
    );
  });

  it("ignores blank optional event values when an object is provided", async () => {
    const result = await buildAuthoringPlan(
      {
        action: "author.plan",
        intent: "Update the triggering account before save",
        flow_type: "record-triggered",
        object: "Account",
        event: "",
        trigger_timing: "before-save",
        record_event: "update",
      },
      process.cwd(),
    );

    expect(result.content[0]?.text).toContain("Object/Event: Account");
  });

  it("returns a structured blueprint and minimal metadata skeleton", async () => {
    const result = await buildAuthoringPlan(
      {
        action: "author.plan",
        intent: "Update the triggering account before save",
        flow_type: "record-triggered",
        object: "Account",
        trigger_timing: "before-save",
      },
      process.cwd(),
    );
    const plan = result.details.digest as Record<string, unknown>;

    expect(result.details.ok).toBe(true);
    expect(plan).toMatchObject({ action: "author.plan", kind: "flow_authoring_plan" });
    expect(result.details.blueprint).toMatchObject({
      family: "record-triggered",
      process_type: "AutoLaunchedFlow",
      trigger_type: "RecordBeforeSave",
      record_trigger_type: "Update",
    });
    expect(String(result.details.skeleton)).toContain(
      "<triggerType>RecordBeforeSave</triggerType>",
    );
    expect(String(result.details.skeleton)).toContain(
      "<recordTriggerType>Update</recordTriggerType>",
    );
    expect(String(result.details.skeleton)).toContain("<object>Account</object>");
  });
});
