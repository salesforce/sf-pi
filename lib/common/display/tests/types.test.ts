/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  normalizeSfPiDisplayProfile,
  normalizeSfPiDisplaySettings,
  previewLinesForDisplayProfile,
} from "../types.ts";

// Public display-profile contract used by /sf-pi display and renderer defaults.
describe("sf-pi display profile types", () => {
  it("normalizes known profile names", () => {
    expect(normalizeSfPiDisplayProfile("compact")).toBe("compact");
    expect(normalizeSfPiDisplayProfile("balanced")).toBe("balanced");
    expect(normalizeSfPiDisplayProfile("verbose")).toBe("verbose");
  });

  it("falls back to balanced for unknown values", () => {
    expect(normalizeSfPiDisplayProfile("loud")).toBe("balanced");
    expect(normalizeSfPiDisplaySettings({ profile: "noisy" }).profile).toBe("balanced");
  });

  it("maps profiles to increasing preview budgets", () => {
    expect(previewLinesForDisplayProfile("compact")).toBeLessThan(
      previewLinesForDisplayProfile("balanced"),
    );
    expect(previewLinesForDisplayProfile("balanced")).toBeLessThan(
      previewLinesForDisplayProfile("verbose"),
    );
  });
});
