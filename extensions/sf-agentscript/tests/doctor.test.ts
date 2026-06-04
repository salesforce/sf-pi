/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import { renderDoctorReport, type DoctorStatus } from "../lib/doctor.ts";

function baseStatus(): DoctorStatus {
  return {
    sdkLoaded: true,
    sdkPackage: "@sf-agentscript/agentforce",
    sdkPackageVersion: "2.5.32",
    agentScriptPackages: [
      {
        name: "@sf-agentscript/agentforce",
        kind: "direct",
        declaredVersion: "2.5.32",
        resolvedVersion: "2.5.32",
        loaded: true,
      },
      {
        name: "@sf-agentscript/compiler",
        kind: "transitive",
        resolvedVersion: "2.6.9",
        loaded: true,
      },
    ],
    dialectsProbed: ["agentforce"],
    upstreamNote: "@sf-agentscript/agentforce@2.5.32",
    salesforceCoreResolved: true,
    salesforceCoreVersion: "8.31.0",
    sfdxAgentsWritable: true,
    sfdxAgentsPath: "/tmp/.sfdx/agents",
  };
}

describe("renderDoctorReport", () => {
  test("renders official AgentScript package versions", () => {
    const report = renderDoctorReport(baseStatus());
    expect(report).toContain("AgentScript packages:");
    expect(report).toContain(
      "@sf-agentscript/agentforce: direct, declared 2.5.32, resolved 2.5.32",
    );
    expect(report).toContain("@sf-agentscript/compiler: transitive, not declared, resolved 2.6.9");
  });
});
