/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Browser wait result classification. */
import { describe, expect, it } from "vitest";
import {
  buildLightningOutcomeExpression,
  buildLightningWaitExpression,
  LIGHTNING_WAIT_HELPERS,
} from "../lib/lightning-wait.ts";
import { buildWaitArgs, classifyWait } from "../lib/sf_browser_wait-tool.ts";

describe("wait classification", () => {
  it("marks near-timeout conditional waits as ambiguous", () => {
    const result = classifyWait(59_000, {});
    expect(result.ambiguous).toBe(true);
    expect(result.label).toBe("Wait may have timed out");
  });

  it("does not mark explicit fixed waits as ambiguous", () => {
    const result = classifyWait(60_000, { ms: 60_000 });
    expect(result.ambiguous).toBe(false);
    expect(result.label).toBe("Wait finished");
  });

  it("builds Lightning-aware wait expressions", () => {
    const args = buildWaitArgs({ lightning: "save-result" });

    expect(args[0]).toBe("wait");
    expect(args[1]).toBe("--fn");
    expect(args[2]).toContain("__sfPiLightningWait");
    expect(args[2]).toContain('"save-result"');
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
    const args = buildWaitArgs({ lightning: "navigation-ready" });
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
});
