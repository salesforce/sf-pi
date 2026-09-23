/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { buildAuthoringPlan, inferFlowFamily } from "../lib/author.ts";

const cases = [
  ["Collect request details from a user on a screen", "screen"],
  ["Create reusable logic called by another flow", "autolaunched"],
  ["Update the triggering record before it is saved", "record-triggered"],
  ["Run every day at midnight", "schedule-triggered"],
  ["Handle a platform event message", "platform-event-triggered"],
  ["Use an Omni-Channel flow to route work to a queue", "omni-channel"],
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

  it("returns a queue-routing Omni-Channel blueprint and metadata skeleton", async () => {
    const result = await buildAuthoringPlan(
      {
        action: "author.plan",
        intent: "Route an Omni-Channel work item to a queue",
        flow_type: "omni-channel",
      },
      process.cwd(),
    );

    expect(result.details.blueprint).toMatchObject({
      family: "omni-channel",
      process_type: "RoutingFlow",
      destination: "queue",
    });
    expect(String(result.details.skeleton)).toContain("<processType>RoutingFlow</processType>");
    expect(String(result.details.skeleton)).toContain("<actionName>routeWork</actionName>");
    expect(String(result.details.skeleton)).toContain("<versionString>2.0.0</versionString>");
    expect(String(result.details.skeleton)).toContain("<name>recordId</name>");
  });

  it("authors direct-agent routing with availability and a fallback queue", async () => {
    const result = await buildAuthoringPlan(
      {
        action: "author.plan",
        intent: "Check availability and route Omni-Channel work directly to an agent",
        flow_type: "omni-channel",
        omni_destination: "agent",
        omni_check_availability: true,
      },
      process.cwd(),
    );
    const skeleton = String(result.details.skeleton);

    expect(result.details.blueprint).toMatchObject({
      family: "omni-channel",
      destination: "agent",
      check_availability: true,
    });
    expect(skeleton).toContain("<actionName>checkAvailabilityForRouting</actionName>");
    expect(skeleton).toContain("<stringValue>Agent</stringValue>");
    expect(skeleton).toContain("<name>agentId</name>");
    expect(skeleton).toContain("<name>fallbackQueueId</name>");
    expect(skeleton).toContain("<name>reasonForNotRouting</name>");
  });

  it("authors skills routing with target-org skills-based routing rules", async () => {
    const result = await buildAuthoringPlan(
      {
        action: "author.plan",
        intent: "Route Omni-Channel work using explicitly defined skills",
        flow_type: "omni-channel",
        omni_destination: "skills",
      },
      process.cwd(),
    );
    const skeleton = String(result.details.skeleton);

    expect(result.details.blueprint).toMatchObject({
      family: "omni-channel",
      destination: "skills",
    });
    expect(skeleton).not.toContain("<actionName>addSkillRequirements</actionName>");
    expect(skeleton).toContain("<stringValue>SkillsBased</stringValue>");
    expect(skeleton).toContain("<stringValue>RunSBRRules</stringValue>");
    expect(skeleton).toContain("<name>routingConfigId</name>");
  });

  it("authors an intentional no-route path with a public output reason", async () => {
    const result = await buildAuthoringPlan(
      {
        action: "author.plan",
        intent: "Route an Omni-Channel work item or return a no-route reason",
        flow_type: "omni-channel",
        omni_no_route: true,
      },
      process.cwd(),
    );
    const skeleton = String(result.details.skeleton);

    expect(skeleton).toContain("<name>reasonForNotRouting</name>");
    expect(skeleton).toContain("<isOutput>true</isOutput>");
    expect(skeleton).toContain("<name>Set_Reason_For_Not_Routing</name>");
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
