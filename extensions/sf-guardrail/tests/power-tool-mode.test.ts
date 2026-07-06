/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for persisted Power Tool Mode decision matching. */
import { describe, expect, it } from "vitest";

import {
  defaultNativeFamilies,
  enabledNativeFamilies,
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
    expect(shouldPowerToolAutoApprove(decision({ orgType: "sandbox" }), settings)).toBe(true);
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
    expect(enabledNativeFamilies({ mode: "native" })).toEqual(new Set(defaultNativeFamilies()));
    expect(
      shouldPowerToolAutoApprove(
        decision({
          approvalScope: { ...decision().approvalScope!, operationFamily: "anonymous apex" },
          orgType: "sandbox",
        }),
        { mode: "native" },
      ),
    ).toBe(true);
  });

  it("treats an empty native family list as no enabled native families", () => {
    const settings: GuardrailPowerToolSettings = { mode: "native", nativeFamilies: [] };
    expect(enabledNativeFamilies(settings)).toEqual(new Set());
    expect(shouldPowerToolAutoApprove(decision({ orgType: "sandbox" }), settings)).toBe(false);
    expect(
      shouldPowerToolAutoApprove(
        decision({
          approvalScope: { ...decision().approvalScope!, operationFamily: "soql queryAll" },
          orgType: "sandbox",
        }),
        settings,
      ),
    ).toBe(false);
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

  it("treats browser and SOQL native decisions without org context as Unknown Org", () => {
    const browser = decision();
    const soqlExport = decision({
      approvalScope: {
        ...decision().approvalScope!,
        operationFamily: "soql artifact export",
        riskTier: "soql_artifact_export_exact",
      },
    });
    const slack = decision({
      approvalScope: {
        ...decision().approvalScope!,
        operationFamily: "slack canvas write",
        riskTier: "external_content_write_exact",
      },
    });

    expect(
      shouldPowerToolAutoApprove(browser, { mode: "native", nativeFamilies: ["browser"] }),
    ).toBe(false);
    expect(
      shouldPowerToolAutoApprove(soqlExport, { mode: "native", nativeFamilies: ["soql"] }),
    ).toBe(false);
    expect(shouldPowerToolAutoApprove(browser, { mode: "all" })).toBe(false);
    expect(shouldPowerToolAutoApprove(soqlExport, { mode: "all" })).toBe(false);
    expect(
      shouldPowerToolAutoApprove(browser, {
        mode: "native",
        nativeFamilies: ["browser"],
        productionUnknown: true,
      }),
    ).toBe(true);
    expect(
      shouldPowerToolAutoApprove(soqlExport, {
        mode: "native",
        nativeFamilies: ["soql"],
        productionUnknown: true,
      }),
    ).toBe(true);
    expect(shouldPowerToolAutoApprove(slack, { mode: "native", nativeFamilies: ["slack"] })).toBe(
      true,
    );
  });
});
