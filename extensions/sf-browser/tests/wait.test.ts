/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Browser wait result classification. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  buildLightningOutcomeExpression,
  buildLightningWaitExpression,
  LIGHTNING_WAIT_HELPERS,
} from "../lib/lightning-wait.ts";
import { checkpointEvidenceLabel } from "../lib/evidence-policy.ts";
import {
  buildWaitArgs,
  classifyWait,
  classifyWaitStatus,
  registerSfBrowserWaitTool,
} from "../lib/sf_browser_wait-tool.ts";

describe("wait classification", () => {
  it("exposes one model-facing wait condition instead of mutually exclusive selectors", () => {
    const registerTool = vi.fn();
    registerSfBrowserWaitTool({ registerTool } as unknown as ExtensionAPI);

    const schema = registerTool.mock.calls[0]?.[0]?.parameters;
    expect(schema.required).toContain("condition");
    expect(schema.properties.condition).toBeDefined();
    expect(schema.properties.text).toBeUndefined();
    expect(schema.properties.url).toBeUndefined();
    expect(schema.properties.load).toBeUndefined();
    expect(schema.properties.lightning).toBeUndefined();
    expect(schema.properties.ms).toBeUndefined();
  });

  it("marks near-timeout conditional waits as timed out", () => {
    const classification = classifyWait(59_000, {
      type: "lightning",
      value: "app-ready",
    });
    expect(classification.ambiguous).toBe(true);
    expect(classifyWaitStatus(classification)).toBe("timed_out");
  });

  it("does not mark explicit fixed delays as ambiguous", () => {
    const classification = classifyWait(60_000, { type: "delay", value: 60_000 });
    expect(classification.ambiguous).toBe(false);
    expect(classifyWaitStatus(classification)).toBe("matched");
  });

  it("keeps an ambiguous semantic outcome distinct from a timeout", () => {
    const classification = classifyWait(1_000, {
      type: "lightning",
      value: "save-result",
    });
    expect(classifyWaitStatus(classification, "ambiguous")).toBe("ambiguous");
  });

  it("builds Lightning-aware wait expressions", () => {
    const args = buildWaitArgs({ type: "lightning", value: "save-result" });

    expect(args[0]).toBe("wait");
    expect(args[1]).toBe("--fn");
    expect(args[2]).toContain("__sfPiLightningWait");
    expect(args[2]).toContain('"save-result"');
  });

  it("builds each non-Lightning condition without sibling selectors", () => {
    expect(buildWaitArgs({ type: "text", value: "Saved" })).toEqual(["wait", "--text", "Saved"]);
    expect(buildWaitArgs({ type: "url", value: "**/lightning/**" })).toEqual([
      "wait",
      "--url",
      "**/lightning/**",
    ]);
    expect(buildWaitArgs({ type: "load", value: "networkidle" })).toEqual([
      "wait",
      "--load",
      "networkidle",
    ]);
    expect(buildWaitArgs({ type: "delay", value: 500 })).toEqual(["wait", "500"]);
  });

  it("keeps save-result as an outcome classifier expression", () => {
    const expression = buildLightningWaitExpression("save-result");

    expect(expression).toContain("classifySaveResult");
    expect(expression).toContain("success-toast");
    expect(expression).toContain("validation-error");
    expect(expression).toContain("classic-error");
    expect(expression).toContain("classic-success");
  });

  it("adds navigation-ready for frontdoor/deep-link stabilization", () => {
    const args = buildWaitArgs({ type: "lightning", value: "navigation-ready" });
    const expression = buildLightningOutcomeExpression("navigation-ready");

    expect(args[2]).toContain('"navigation-ready"');
    expect(expression).toContain("navigationReady");
    expect(expression).toContain("__sfPiNavigationReadyState");
    expect(expression).toContain("frontdoor");
  });

  it("handles id-only record redirects and quick action pages", () => {
    expect(LIGHTNING_WAIT_HELPERS).toContain("idOnly");
    expect(LIGHTNING_WAIT_HELPERS).toContain("quickActionMatch");
    expect(LIGHTNING_WAIT_HELPERS).toContain("lightning\\/action\\/quick");
  });

  it("uses hardened Salesforce modal/toast/spinner selectors", () => {
    expect(LIGHTNING_WAIT_HELPERS).toContain('[role="dialog"]');
    expect(LIGHTNING_WAIT_HELPERS).toContain(".uiModal");
    expect(LIGHTNING_WAIT_HELPERS).toContain('[data-aura-class*="forceToastMessage"]');
    expect(LIGHTNING_WAIT_HELPERS).toContain('[aria-busy="true"]');
    expect(LIGHTNING_WAIT_HELPERS).toContain("[data-error-message]");
    expect(LIGHTNING_WAIT_HELPERS).toContain("visibleSaveButton");
    expect(LIGHTNING_WAIT_HELPERS).toContain("lightningShellVisible");
    expect(LIGHTNING_WAIT_HELPERS).toContain("stencilVisible");
    expect(LIGHTNING_WAIT_HELPERS).toContain("blockingBackdropVisible");
  });

  it("builds separate Lightning outcome expressions for structured details", () => {
    const expression = buildLightningOutcomeExpression("toast");

    expect(expression).toContain("__sfPiLightningOutcome");
    expect(expression).toContain('"toast"');
  });

  it("captures checkpoint evidence for meaningful semantic waits only", () => {
    expect(checkpointEvidenceLabel({ lightning: "navigation-ready" })).toBe(
      "checkpoint-navigation-ready",
    );
    expect(checkpointEvidenceLabel({ lightning: "record-view" })).toBe("checkpoint-record-view");
    expect(checkpointEvidenceLabel({ lightning: "save-result" })).toBe(
      "after-mutation-save-result",
    );
    expect(checkpointEvidenceLabel({ lightning: "spinner-gone" })).toBeUndefined();
  });
});
