/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("sf-dark theme", () => {
  it("defines an explicit max thinking color", () => {
    const theme = JSON.parse(readFileSync(path.resolve("themes/sf-dark.json"), "utf8")) as {
      colors?: Record<string, unknown>;
    };

    expect(theme.colors?.thinkingMax).toBe("#00ffff");
  });

  it("uses the theme blue for extra-high thinking chrome", () => {
    const theme = JSON.parse(readFileSync(path.resolve("themes/sf-dark.json"), "utf8")) as {
      colors?: Record<string, unknown>;
    };

    expect(theme.colors?.thinkingXhigh).toBe("blue");
  });
});
