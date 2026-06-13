/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Rule-derived guidance tests.
 */
import { describe, expect, it } from "vitest";
import { readBundledConfig } from "../lib/config.ts";
import { renderGuardrailGuidance } from "../lib/guidance.ts";

describe("renderGuardrailGuidance", () => {
  it("renders active rule families from the effective config", () => {
    const guidance = renderGuardrailGuidance(readBundledConfig());

    expect(guidance).toContain("<sf_guardrail>");
    expect(guidance).toContain("File protection:");
    expect(guidance).toContain("Destructive-deploy manifest");
    expect(guidance).toContain(".sfdx/agents/**");
    expect(guidance).toContain("Dangerous-command confirmation:");
    expect(guidance).toContain("rm -rf");
    expect(guidance).toContain("git push --force");
    expect(guidance).toContain("Org-aware confirmation:");
    expect(guidance).toContain("sf project deploy start|resume|quick");
    expect(guidance).toContain("SF_GUARDRAIL_ALLOW_HEADLESS=1");
    expect(guidance).toContain("</sf_guardrail>");
  });

  it("reflects disabled features instead of listing stale bundled behavior", () => {
    const config = readBundledConfig();
    config.features.commandGate = false;
    config.features.orgAwareGate = false;

    const guidance = renderGuardrailGuidance(config);

    expect(guidance).toContain(
      "Dangerous-command confirmation:\n- Disabled in the effective config.",
    );
    expect(guidance).toContain("Org-aware confirmation:\n- Disabled in the effective config.");
  });

  it("omits disabled command patterns from active guidance", () => {
    const config = readBundledConfig();
    const pattern = config.commandGate.patterns.find((candidate) => candidate.id === "rm-rf");
    if (pattern) pattern.enabled = false;

    const guidance = renderGuardrailGuidance(config);

    expect(guidance).not.toContain("rm -rf (recursive force delete)");
    expect(guidance).toContain("sudo (superuser command)");
  });

  it("reflects custom headless escape hatch names", () => {
    const config = readBundledConfig();
    config.headlessEscapeHatchEnv = "CUSTOM_GUARDRAIL_ALLOW_HEADLESS";

    expect(renderGuardrailGuidance(config)).toContain("CUSTOM_GUARDRAIL_ALLOW_HEADLESS=1");
  });
});
