/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior tests for the shared dotted-version comparison. */
import { describe, expect, it } from "vitest";

import { compareVersions, isVersionGreater } from "../catalog-state/whats-new.ts";

describe("compareVersions", () => {
  it("orders dotted release versions numerically, not lexically", () => {
    expect(compareVersions("0.67.67", "0.67.68")).toBeLessThan(0);
    expect(compareVersions("0.68.0", "0.67.68")).toBeGreaterThan(0);
    expect(compareVersions("0.68.1", "0.68.1")).toBe(0);
  });

  it("treats a release as greater than its prerelease", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0-beta.2")).toBeLessThan(0);
  });
});

describe("isVersionGreater", () => {
  it("matches compareVersions for release pairs", () => {
    expect(isVersionGreater("0.68.1", "0.68.0")).toBe(true);
    expect(isVersionGreater("0.68.0", "0.68.0")).toBe(false);
    expect(isVersionGreater("0.67.5", "0.68.0")).toBe(false);
  });
});
