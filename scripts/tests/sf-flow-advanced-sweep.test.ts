/* SPDX-License-Identifier: Apache-2.0 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeFlowFile } from "../../extensions/sf-flow/lib/analyzer.ts";
import {
  ASYNC_BULK_COUNT,
  DEPTH_FLOW_API_NAMES,
  HANDLED_CHAIN_OUTPUT,
  NONE_TRIGGER_FAULT_OUTPUT,
  NONE_TRIGGER_SUCCESS_OUTPUT,
  PROBE_TRIGGERED_DEPTH_FLOWS,
  SCHEDULE_BULK_COUNT,
  SUCCESS_CHAIN_OUTPUT,
  UNORDERED_BEFORE_TOKENS,
  assertSingleTransaction,
  compareRecordCoverage,
  generationDiagnosisAccepted,
  hasSameTokens,
  noneTriggerSubflowRejected,
  probeIsolationFailure,
  recordCoverageFailure,
  scheduleWaitSecondsFromFire,
} from "../e2e/lib/sf-flow-depth-proofs.ts";
import {
  advancedFlowDefinitionDeactivationSource,
  APEX_TEST_CLASSES,
  FLOW_API_NAMES,
  parseAdvancedArgs,
  stageActiveFlowSource,
  stageScheduleSource,
} from "../e2e/sf-flow-advanced-sweep.ts";

describe("SF Flow advanced runtime sweep", () => {
  it("defaults to check-only and requires explicit deployment and runtime", () => {
    expect(parseAdvancedArgs(["--org", "developer-org"])).toEqual({
      org: "developer-org",
      deploy: false,
      runtime: false,
      cleanup: false,
    });
    expect(parseAdvancedArgs(["--org", "developer-org", "--deploy"])).toEqual({
      org: "developer-org",
      deploy: true,
      runtime: false,
      cleanup: false,
    });
    expect(parseAdvancedArgs(["--org", "developer-org", "--runtime"])).toEqual({
      org: "developer-org",
      deploy: true,
      runtime: true,
      cleanup: false,
    });
    expect(parseAdvancedArgs(["--org", "developer-org", "--cleanup"])).toEqual({
      org: "developer-org",
      deploy: false,
      runtime: false,
      cleanup: true,
    });
  });

  it("rejects incomplete or unknown arguments", () => {
    expect(() => parseAdvancedArgs(["--org"])).toThrow(/requires an alias/i);
    expect(() => parseAdvancedArgs(["--org", "developer-org", "--mutate"])).toThrow(
      /unknown argument/i,
    );
  });

  it("stages only Draft Flow status as Active", () => {
    expect(stageActiveFlowSource("<Flow><status>Draft</status></Flow>")).toContain(
      "<status>Active</status>",
    );
    expect(() => stageActiveFlowSource("<Flow><status>Active</status></Flow>")).toThrow(
      /expected one Draft status/i,
    );
  });

  it("stages an exact scheduled start without changing unrelated metadata", () => {
    const source =
      "<Flow><schedule><startDate>2027-01-01</startDate><startTime>00:00:00.000Z</startTime></schedule><status>Draft</status></Flow>";
    expect(stageScheduleSource(source, "2026-09-21", "14:03:00.000Z")).toContain(
      "<startDate>2026-09-21</startDate><startTime>14:03:00.000Z</startTime>",
    );
    expect(() => stageScheduleSource("<Flow/>", "2026-09-21", "14:03:00.000Z")).toThrow(
      /expected one schedule start/i,
    );
  });

  it("tracks every broad-coverage Flow and targeted Apex test class", () => {
    expect(FLOW_API_NAMES).toHaveLength(48);
    expect(new Set(FLOW_API_NAMES).size).toBe(FLOW_API_NAMES.length);
    expect(FLOW_API_NAMES).toEqual(
      expect.arrayContaining([
        "SfPi_Advanced_Trigger_Create_Update",
        "SfPi_Advanced_Conditions_And",
        "SfPi_Advanced_Conditions_Or",
        "SfPi_Advanced_Conditions_Custom",
        "SfPi_Advanced_Conditions_Formula",
        "SfPi_Advanced_Related_Async",
        "SfPi_Advanced_Data_Operations",
        "SfPi_Advanced_Custom_Error",
        "SfPi_Advanced_Email_Action",
        "SfPi_Advanced_Rollback",
        "SfPi_Advanced_Forced_Faults",
        "SfPi_Advanced_Related_Delete",
        "SfPi_Advanced_Record_Variables",
        "SfPi_Advanced_Multi_Sort",
        "SfPi_Advanced_Create_Upsert",
        "SfPi_Advanced_Upsert_Collection",
        "SfPi_Advanced_Transform_Aggregate",
        "SfPi_Advanced_Transform_Nested",
        "SfPi_Advanced_Transform_Join",
        "SfPi_Advanced_Wait_Resume",
        ...DEPTH_FLOW_API_NAMES,
      ]),
    );
    expect(APEX_TEST_CLASSES).toHaveLength(18);
    expect(new Set(APEX_TEST_CLASSES).size).toBe(APEX_TEST_CLASSES.length);
    expect(APEX_TEST_CLASSES).toContain("SfPiFlowSliceOneRuntimeTest");
  });

  it("uses FlowDefinition activeVersionNumber zero for cleanup", () => {
    const source = advancedFlowDefinitionDeactivationSource();
    expect(source).toContain("<FlowDefinition");
    expect(source).toContain("<activeVersionNumber>0</activeVersionNumber>");
    expect(source).not.toContain("<status>Draft</status>");
  });

  it("proves record coverage without treating batch partitions as stable", () => {
    expect(ASYNC_BULK_COUNT).toBe(200);
    expect(SCHEDULE_BULK_COUNT).toBe(201);
    assertSingleTransaction(200, Array.from({ length: 200 }));
    expect(() => assertSingleTransaction(201, Array.from({ length: 201 }))).toThrow(
      /cannot exceed 200/,
    );
    const coverage = compareRecordCoverage(["a", "b"], ["b", "a"]);
    expect(recordCoverageFailure(coverage)).toBeUndefined();
    expect(
      recordCoverageFailure(compareRecordCoverage(["a"], ["a", "a"])).includes("duplicates=1"),
    ).toBe(true);
  });

  it("accepts every equal or omitted trigger-order sequence and only one explicit sequence", () => {
    expect(hasSameTokens("E2;E0;E1", UNORDERED_BEFORE_TOKENS)).toBe(true);
    expect(hasSameTokens("E0;E1;E2", UNORDERED_BEFORE_TOKENS)).toBe(true);
    expect(hasSameTokens("E1;E2", UNORDERED_BEFORE_TOKENS)).toBe(false);
    expect("B10;B20").not.toBe("B20;B10");
  });

  it("rejects a successful triggerType None subflow and accepts a fault sentinel", () => {
    expect(
      noneTriggerSubflowRejected({ isSuccess: true, outputText: NONE_TRIGGER_SUCCESS_OUTPUT }),
    ).toBe(false);
    expect(
      noneTriggerSubflowRejected({ isSuccess: true, outputText: NONE_TRIGGER_FAULT_OUTPUT }),
    ).toBe(true);
    expect(noneTriggerSubflowRejected({ isSuccess: false, outputText: undefined })).toBe(true);
    expect(SUCCESS_CHAIN_OUTPUT).toBe("chain|grand");
    expect(HANDLED_CHAIN_OUTPUT).toBe("handled");
  });

  it("fails probe isolation on foreign flows or triggers", () => {
    expect(
      probeIsolationFailure({
        flows: PROBE_TRIGGERED_DEPTH_FLOWS.map((ApiName) => ({ ApiName })),
        triggers: [],
        allowed: PROBE_TRIGGERED_DEPTH_FLOWS,
        requireComplete: true,
      }),
    ).toBeUndefined();
    expect(
      probeIsolationFailure({
        flows: [{ ApiName: "Customer_Flow" }],
        triggers: [{ Name: "CustomerTrigger" }],
        allowed: PROBE_TRIGGERED_DEPTH_FLOWS,
        requireComplete: false,
      }),
    ).toMatch(/Customer_Flow/);
  });

  it("waits through a near schedule fire and does not treat a later daily fire as the proof window", () => {
    const now = Date.parse("2026-09-22T20:00:00.000Z");
    expect(scheduleWaitSecondsFromFire(now + 5 * 60_000, now)).toBeGreaterThan(600);
    expect(scheduleWaitSecondsFromFire(now + 25 * 60_000, now)).toBeGreaterThan(600);
    expect(scheduleWaitSecondsFromFire(now + 24 * 60 * 60_000, now)).toBe(600);
    expect(scheduleWaitSecondsFromFire(undefined, now)).toBe(600);
  });

  it("accepts generation diagnosis for every advanced fixture", async () => {
    const root = path.resolve("scripts/e2e/fixtures/sf-flow-advanced");
    for (const name of FLOW_API_NAMES) {
      const file = path.join("force-app/main/default/flows", `${name}.flow-meta.xml`);
      const analysis = await analyzeFlowFile(file, root, { profile: "generation" });
      expect(
        generationDiagnosisAccepted(path.basename(file), analysis.findings),
        `${name}: ${analysis.findings
          .filter((finding) => finding.severity === "high" || finding.severity === "moderate")
          .map((finding) => finding.rule_id)
          .join(",")}`,
      ).toBe(true);
    }
  });

  it("keeps the 201-record schedule on the default batch size and leaves equal order unspecified", async () => {
    const root = path.resolve("scripts/e2e/fixtures/sf-flow-advanced/force-app/main/default/flows");
    const scheduled = await readFile(
      path.join(root, "SfPi_Advanced_Scheduled_Bulk.flow-meta.xml"),
      "utf8",
    );
    const unspecified = await readFile(
      path.join(root, "SfPi_Advanced_Order_Unspecified_Before.flow-meta.xml"),
      "utf8",
    );
    expect(scheduled).not.toContain("maxBatchSize");
    expect(scheduled).not.toContain("<triggerOrder>");
    expect(unspecified).not.toContain("<triggerOrder>");
  });
});
