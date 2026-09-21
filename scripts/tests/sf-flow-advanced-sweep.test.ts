/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
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
    });
    expect(parseAdvancedArgs(["--org", "developer-org", "--deploy"])).toEqual({
      org: "developer-org",
      deploy: true,
      runtime: false,
    });
    expect(parseAdvancedArgs(["--org", "developer-org", "--runtime"])).toEqual({
      org: "developer-org",
      deploy: true,
      runtime: true,
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
    expect(FLOW_API_NAMES).toHaveLength(33);
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
});
