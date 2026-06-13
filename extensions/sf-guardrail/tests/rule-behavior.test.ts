/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Rule behavior helper tests.
 */
import { describe, expect, it } from "vitest";
import {
  behaviorEnabled,
  behaviorToAction,
  labelForRuleBehavior,
  resolveRuleBehavior,
  ruleBehaviorFromLabel,
} from "../lib/rule-behavior.ts";

describe("rule behavior", () => {
  it("defaults risky rules to confirm", () => {
    expect(resolveRuleBehavior({})).toBe("confirm");
  });

  it("treats legacy enabled:false as off", () => {
    expect(resolveRuleBehavior({ behavior: "confirm", enabled: false })).toBe("off");
  });

  it("treats legacy action:block as hard block", () => {
    expect(resolveRuleBehavior({ action: "block" })).toBe("block");
  });

  it("maps behavior to decision actions", () => {
    expect(behaviorToAction("off")).toBeUndefined();
    expect(behaviorToAction("confirm")).toBe("confirm");
    expect(behaviorToAction("block")).toBe("block");
  });

  it("maps labels for settings", () => {
    expect(labelForRuleBehavior("block")).toBe("hard block");
    expect(ruleBehaviorFromLabel("hard block")).toBe("block");
    expect(behaviorEnabled("off")).toBe(false);
  });
});
