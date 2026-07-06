/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for persisted Power Tool Mode decision matching. */
import { describe, expect, it } from "vitest";

import {
  defaultNativeFamilies,
  shouldPowerToolAutoApprove,
  type GuardrailPowerToolSettings,
} from "../lib/power-tool-mode.ts";
import type { ClassifiedDecision } from "../lib/types.ts";

function decision(overrides: Partial<ClassifiedDecision> = {}): ClassifiedDecision {
  return {
    ruleId: "native-sf-browser-commit",
    feature: "nativeToolGate",
    action: "confirm",
    reason: "Browser commit",
    fingerprint: "browser",
    subject: "sf_browser_click e1",
    approvalScope: {
      fingerprint: "browser",
      label: "browser commit",
      operationFamily: "browser commit",
      riskTier: "browser_commit_exact",
      allowSession: false,
    },
    ...overrides,
  };
}

describe("Power Tool Mode", () => {
  it("is off by default", () => {
    expect(shouldPowerToolAutoApprove(decision(), undefined)).toBe(false);
    expect(shouldPowerToolAutoApprove(decision(), { mode: "off" })).toBe(false);
  });

  it("auto-approves selected native families in native mode", () => {
    const settings: GuardrailPowerToolSettings = { mode: "native", nativeFamilies: ["browser"] };
    expect(shouldPowerToolAutoApprove(decision(), settings)).toBe(true);
    expect(
      shouldPowerToolAutoApprove(
        decision({
          approvalScope: { ...decision().approvalScope!, operationFamily: "anonymous apex" },
        }),
        settings,
      ),
    ).toBe(false);
  });

  it("defaults native mode to every native family when no family list is saved", () => {
    expect(defaultNativeFamilies()).toContain("soql");
    expect(
      shouldPowerToolAutoApprove(
        decision({
          approvalScope: { ...decision().approvalScope!, operationFamily: "soql queryAll" },
        }),
        { mode: "native" },
      ),
    ).toBe(true);
  });

  it("auto-approves non-native confirm decisions only in all mode", () => {
    const shellDecision = decision({
      feature: "commandGate",
      ruleId: "rm-rf",
      approvalScope: { fingerprint: "rm", label: "rm", operationFamily: "rm -rf" },
    });
    expect(shouldPowerToolAutoApprove(shellDecision, { mode: "native" })).toBe(false);
    expect(shouldPowerToolAutoApprove(shellDecision, { mode: "all" })).toBe(true);
  });

  it("does not auto-approve production or guessed org decisions unless separately enabled", () => {
    const prod = decision({ orgType: "production" });
    const guessed = decision({ orgType: "production", orgResolutionGuessed: true });
    expect(shouldPowerToolAutoApprove(prod, { mode: "all" })).toBe(false);
    expect(shouldPowerToolAutoApprove(guessed, { mode: "all" })).toBe(false);
    expect(shouldPowerToolAutoApprove(prod, { mode: "all", productionUnknown: true })).toBe(true);
    expect(shouldPowerToolAutoApprove(guessed, { mode: "all", productionUnknown: true })).toBe(
      true,
    );
  });
});
