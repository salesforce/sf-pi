/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import {
  flowDefinitionDeactivationSource,
  parseActionSweepArgs,
  renderRunAgentFlow,
  stageActionFlowSource,
  STATIC_ACTION_FLOWS,
} from "../e2e/sf-flow-actions-sweep.ts";

describe("SF Flow live action sweep", () => {
  it("defaults to check-only and requires explicit runtime", () => {
    expect(parseActionSweepArgs(["--org", "developer-org"])).toEqual({
      org: "developer-org",
      runtime: false,
    });
    expect(
      parseActionSweepArgs([
        "--org",
        "developer-org",
        "--runtime",
        "--agent-action",
        "Public_Test_Agent",
      ]),
    ).toEqual({
      org: "developer-org",
      runtime: true,
      agentAction: "Public_Test_Agent",
    });
  });

  it("rejects incomplete and unknown arguments", () => {
    expect(() => parseActionSweepArgs(["--org"])).toThrow(/requires an alias/i);
    expect(() => parseActionSweepArgs(["--agent-action"])).toThrow(/requires an API name/i);
    expect(() => parseActionSweepArgs(["--mutate"])).toThrow(/unknown argument/i);
  });

  it("stages one Draft status as Active only when requested", () => {
    const source = "<Flow><status>Draft</status></Flow>";
    expect(stageActionFlowSource(source, false)).toBe(source);
    expect(stageActionFlowSource(source, true)).toContain("<status>Active</status>");
    expect(() => stageActionFlowSource("<Flow/>", true)).toThrow(/expected one Draft/i);
  });

  it("binds a source-safe Run Agent action name exactly once", () => {
    const template = "<actionName>__AGENT_ACTION_NAME__</actionName>";
    expect(renderRunAgentFlow(template, "Public_Test_Agent")).toBe(
      "<actionName>Public_Test_Agent</actionName>",
    );
    expect(() => renderRunAgentFlow(template, "invalid.action")).toThrow(/alphanumeric/i);
    expect(() => renderRunAgentFlow("<Flow/>", "Public_Test_Agent")).toThrow(/placeholder/i);
  });

  it("tracks every static action Flow and deterministic deactivation metadata", () => {
    expect(STATIC_ACTION_FLOWS).toEqual([
      "SfPi_Action_Complex_Apex",
      "SfPi_Action_Named_Credential",
      "SfPi_Action_External_Service",
      "SfPi_Action_Quick_Action",
      "SfPi_Action_Email_Alert",
    ]);
    expect(flowDefinitionDeactivationSource()).toContain(
      "<activeVersionNumber>0</activeVersionNumber>",
    );
  });
});
