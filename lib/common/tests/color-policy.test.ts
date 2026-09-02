/* SPDX-License-Identifier: Apache-2.0 */
import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { colorsEnabled, normalizeAnsiForTerminal, stripAnsiSgr } from "../color-policy.ts";

const colored = "\x1b[38;2;1;2;3mHello\x1b[0m";

describe("shared terminal color policy", () => {
  it("treats NO_COLOR presence as disabling color", () => {
    expect(colorsEnabled({})).toBe(true);
    expect(colorsEnabled({ NO_COLOR: "1" })).toBe(false);
    expect(colorsEnabled({ NO_COLOR: "" })).toBe(false);
  });

  it("strips every ANSI SGR sequence for NO_COLOR output", () => {
    expect(stripAnsiSgr(colored)).toBe("Hello");
  });

  it("removes truecolor while preserving 256-color styling when Pi disables truecolor", () => {
    const value = `\x1b[38;2;1;2;3mRGB\x1b[0m \x1b[38;5;75mIndexed\x1b[0m`;

    expect(normalizeAnsiForTerminal(value, { environment: {}, trueColor: false })).toBe(
      `RGB\x1b[0m \x1b[38;5;75mIndexed\x1b[0m`,
    );
  });

  it("removes combined truecolor foreground and background without dropping other SGR styles", () => {
    const value = `\x1b[1;38;2;1;2;3;48;2;4;5;6mStyled\x1b[0m`;

    expect(normalizeAnsiForTerminal(value, { environment: {}, trueColor: false })).toBe(
      `\x1b[1mStyled\x1b[0m`,
    );
  });

  it("preserves truecolor when supported and lets NO_COLOR override that capability", () => {
    expect(normalizeAnsiForTerminal(colored, { environment: {}, trueColor: true })).toBe(colored);
    expect(
      normalizeAnsiForTerminal(colored, {
        environment: { NO_COLOR: "1" },
        trueColor: true,
      }),
    ).toBe("Hello");
  });

  it("uses Pi's resolved terminal capability by default", () => {
    const prior = getCapabilities();
    setCapabilities({ ...prior, trueColor: false });
    try {
      expect(normalizeAnsiForTerminal(colored, { environment: {} })).toBe("Hello\x1b[0m");
    } finally {
      setCapabilities(prior);
    }
  });
});
