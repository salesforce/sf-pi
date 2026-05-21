/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { shouldShowFloatingHud } from "../index.ts";
import type { SkillUsage, SkillsHudState } from "../lib/skill-state.ts";

function usage(name: string): SkillUsage {
  return { name, evidence: ["read"], lastSeenIndex: 1 };
}

function state(partial: Partial<SkillsHudState>): SkillsHudState {
  return {
    live: [],
    earlier: [],
    hasAny: false,
    discoveredCount: 0,
    usedCount: 0,
    ...partial,
  };
}

describe("sf-skills floating HUD visibility", () => {
  it("hides when skill usage is only earlier in the session", () => {
    expect(
      shouldShowFloatingHud(
        state({
          earlier: [usage("generating-apex")],
          hasAny: true,
          usedCount: 1,
        }),
        120,
        40,
      ),
    ).toBe(false);
  });

  it("shows when at least one skill is still in context", () => {
    expect(
      shouldShowFloatingHud(
        state({
          live: [usage("generating-apex")],
          hasAny: true,
          usedCount: 1,
        }),
        120,
        40,
      ),
    ).toBe(true);
  });

  it("stays hidden on small terminals", () => {
    expect(
      shouldShowFloatingHud(
        state({
          live: [usage("generating-apex")],
          hasAny: true,
          usedCount: 1,
        }),
        99,
        40,
      ),
    ).toBe(false);
  });
});
