/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { isVersionCurrent } from "../lib/cli-freshness.ts";

// -------------------------------------------------------------------------------------------------
// isVersionCurrent
// -------------------------------------------------------------------------------------------------

describe("isVersionCurrent", () => {
  it("returns true when versions are equal", () => {
    expect(isVersionCurrent("2.130.9", "2.130.9")).toBe(true);
  });

  it("returns true when installed is newer (patch)", () => {
    expect(isVersionCurrent("2.130.10", "2.130.9")).toBe(true);
  });

  it("returns true when installed is newer (minor)", () => {
    expect(isVersionCurrent("2.131.0", "2.130.9")).toBe(true);
  });

  it("returns true when installed is newer (major)", () => {
    expect(isVersionCurrent("3.0.0", "2.130.9")).toBe(true);
  });

  it("returns false when installed is older (patch)", () => {
    expect(isVersionCurrent("2.130.8", "2.130.9")).toBe(false);
  });

  it("returns false when installed is older (minor)", () => {
    expect(isVersionCurrent("2.129.0", "2.130.0")).toBe(false);
  });

  it("returns false when installed is older (major)", () => {
    expect(isVersionCurrent("1.99.0", "2.0.0")).toBe(false);
  });

  it("handles v prefix", () => {
    expect(isVersionCurrent("v2.130.9", "2.130.9")).toBe(true);
    expect(isVersionCurrent("2.130.9", "v2.130.9")).toBe(true);
  });

  it("handles different segment lengths", () => {
    expect(isVersionCurrent("2.130", "2.130.0")).toBe(true);
    expect(isVersionCurrent("2.130.0", "2.130")).toBe(true);
  });
});
