/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import { classifyLifecycleError } from "../lib/lifecycle-tool.ts";

describe("classifyLifecycleError", () => {
  test.each([
    "Generative AI Function Definition ID: bad value for restricted picklist field: Query_Product_Details",
    "Invocation Target: bad value for restricted picklist field: CloseCase",
  ])("maps restricted-picklist publish errors to check_targets recovery", (message) => {
    const result = classifyLifecycleError(
      new Error(`Publish failed (HTTP 500): {"message":"${message}"}`),
      "Example_Bot",
      "publish",
      "/tmp/Example_Bot.agent",
    );

    expect(result.details.ok).toBe(false);
    expect(result.details.suggestion).toMatch(/inspect\/check_targets/);
    expect(result.details.recover_via).toEqual({
      tool: "agentscript_authoring",
      params: {
        verb: "inspect",
        mode: "check_targets",
        agent_file: "/tmp/Example_Bot.agent",
        target_org: "<alias>",
      },
    });
  });
});
