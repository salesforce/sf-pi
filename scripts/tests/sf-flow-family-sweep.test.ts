/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import {
  flowDefinitionDeactivationSource,
  flowTestRegistered,
  parseArgs,
} from "../e2e/sf-flow-family-sweep.ts";

describe("SF Flow family sweep", () => {
  it("defaults to check-only and requires explicit deployment", () => {
    expect(parseArgs(["--org", "developer-org"])).toEqual({
      org: "developer-org",
      deploy: false,
    });
    expect(parseArgs(["--org", "developer-org", "--deploy"])).toEqual({
      org: "developer-org",
      deploy: true,
    });
  });

  it("rejects incomplete or unknown arguments", () => {
    expect(() => parseArgs(["--org"])).toThrow(/requires an alias/i);
    expect(() => parseArgs(["--org", "developer-org", "--mutate"])).toThrow(/unknown argument/i);
  });

  it("recognizes the exact generated FlowTesting method", () => {
    const body = {
      apexTestClasses: [
        {
          name: "SfPi_Hardening_After_Save_Task",
          testMethods: [{ name: "SfPi_Hardening_After_Save_Task_Happy_Path" }],
        },
      ],
    };

    expect(flowTestRegistered(body)).toBe(true);
    expect(flowTestRegistered({ apexTestClasses: [] })).toBe(false);
    expect(flowTestRegistered(body, "SfPi_Hardening_After_Save_Task", "Missing_Test")).toBe(false);
  });

  it("uses FlowDefinition activeVersionNumber zero for cleanup", () => {
    const source = flowDefinitionDeactivationSource();

    expect(source).toContain("<FlowDefinition");
    expect(source).toContain("<activeVersionNumber>0</activeVersionNumber>");
    expect(source).not.toContain("<status>Draft</status>");
  });
});
