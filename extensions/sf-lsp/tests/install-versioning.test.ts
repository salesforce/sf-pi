/* SPDX-License-Identifier: Apache-2.0 */
import { describe, it, expect } from "vitest";
import { compareSemver } from "../lib/install/versioning.ts";

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });

  it("orders patch-level bumps", () => {
    expect(compareSemver("1.2.3", "1.2.4")).toBe(-1);
    expect(compareSemver("1.2.4", "1.2.3")).toBe(1);
  });

  it("orders minor-level bumps", () => {
    expect(compareSemver("1.2.9", "1.3.0")).toBe(-1);
  });

  it("orders major-level bumps", () => {
    expect(compareSemver("1.99.0", "2.0.0")).toBe(-1);
  });

  it("ignores leading v", () => {
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
  });

  it("treats missing components as zero", () => {
    expect(compareSemver("1", "1.0.0")).toBe(0);
    expect(compareSemver("1.2", "1.2.0")).toBe(0);
  });

  it("handles prerelease-ish suffixes conservatively", () => {
    // We truncate after 3 numeric components — the `-beta` trailer falls
    // off either side so the comparison is purely numeric.
    expect(compareSemver("1.2.3-beta", "1.2.3")).toBe(0);
  });
});
