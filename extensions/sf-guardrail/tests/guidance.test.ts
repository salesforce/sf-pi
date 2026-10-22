/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { readBundledConfig } from "../lib/config.ts";
import { renderGuardrailGuidance } from "../lib/guidance.ts";

describe("renderGuardrailGuidance", () => {
  it("renders a compact Safety Mediator contract without the complete pattern catalog", () => {
    const guidance = renderGuardrailGuidance(readBundledConfig());

    expect(guidance).toContain("<sf_guardrail>");
    expect(guidance).toContain("Safety Mediator");
    expect(guidance).toContain("Never bypass");
    expect(guidance).toContain("explicit target_org or --target-org");
    expect(guidance).toContain("ask when the destination is unresolved");
    expect(guidance).toContain("Org-aware: native-sf-integrate-prod, native-sf-flow-prod");
    expect(guidance).toContain("Non-default rule overrides: none.");
    expect(guidance).not.toContain("rm -rf");
    expect(guidance).not.toContain("git push --force");
    expect(guidance).not.toContain("SF_GUARDRAIL_ALLOW_HEADLESS");
    expect(guidance.split("\n").length).toBeLessThanOrEqual(11);
    expect(guidance).toContain("</sf_guardrail>");
  });

  it("shows active hard-block categories and non-default rule behavior only", () => {
    const config = readBundledConfig();
    const command = config.commandGate.patterns.find((candidate) => candidate.id === "rm-rf");
    const policy = config.policies.rules[0];
    if (command) command.behavior = "block";
    if (policy) policy.behavior = "off";

    const guidance = renderGuardrailGuidance(config);

    expect(guidance).toContain("Commands: rm-rf");
    expect(guidance).toContain("rm-rf=hard block");
    if (policy) expect(guidance).toContain(`${policy.id}=off`);
    expect(guidance).not.toContain(command?.pattern ?? "rm -rf");
  });
});
