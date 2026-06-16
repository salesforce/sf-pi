/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEVBAR_COLORS,
  normalizeDevbarColorOverrides,
  normalizeHexColor,
  resolveDevbarColors,
} from "../lib/colors.ts";

describe("normalizeHexColor", () => {
  it("normalizes short and long hex colors", () => {
    expect(normalizeHexColor("#abc")).toBe("#aabbcc");
    expect(normalizeHexColor("#AABBCC")).toBe("#aabbcc");
  });

  it("rejects invalid color values", () => {
    expect(normalizeHexColor("abc")).toBeUndefined();
    expect(normalizeHexColor("#abcd")).toBeUndefined();
    expect(normalizeHexColor("not-a-color")).toBeUndefined();
    expect(normalizeHexColor(123)).toBeUndefined();
  });
});

describe("normalizeDevbarColorOverrides", () => {
  it("normalizes scalar colors and palettes", () => {
    expect(
      normalizeDevbarColorOverrides({
        folderPath: "#ABC",
        modelName: "#D787AF",
        gatewayRainbow: ["#123", "#456789"],
      }),
    ).toEqual({
      folderPath: "#aabbcc",
      modelName: "#d787af",
      gatewayRainbow: ["#112233", "#456789"],
    });
  });

  it("drops invalid fields without dropping valid fields", () => {
    expect(
      normalizeDevbarColorOverrides({
        folderPath: "#00afaf",
        modelName: "bad",
        gatewayRainbow: ["#123", "bad"],
        thinkingRainbow: [],
      }),
    ).toEqual({ folderPath: "#00afaf" });
  });
});

describe("resolveDevbarColors", () => {
  it("keeps today's default hardcoded colors", () => {
    expect(DEFAULT_DEVBAR_COLORS.folderPath).toBe("#00afaf");
    expect(DEFAULT_DEVBAR_COLORS.modelName).toBe("#d787af");
    expect(DEFAULT_DEVBAR_COLORS.orgWarning).toBe("#cc8866");
    expect(DEFAULT_DEVBAR_COLORS.sandboxTrial).toBe("#82aacc");
    expect(DEFAULT_DEVBAR_COLORS.contextEmptyFg).toBe("#3c3c4a");
    expect(DEFAULT_DEVBAR_COLORS.contextEmptyBg).toBe("#28282e");
  });

  it("merges project overrides over global overrides per field", () => {
    const colors = resolveDevbarColors(
      { folderPath: "#111111", modelName: "#222222" },
      { modelName: "#333333" },
    );

    expect(colors.folderPath).toBe("#111111");
    expect(colors.modelName).toBe("#333333");
    expect(colors.orgWarning).toBe(DEFAULT_DEVBAR_COLORS.orgWarning);
  });
});
