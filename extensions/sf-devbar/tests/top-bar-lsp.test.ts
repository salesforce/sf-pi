/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the permanent top-bar LSP health segment and the
 * terminal-width-aware renderTopBarLine helper.
 */
import { describe, expect, it } from "vitest";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
  formatLspHealthSegment,
  renderTopBarLine,
  resolveLspStatus,
  type BarTheme,
} from "../lib/top-bar.ts";
import type {
  SfLspHealthSnapshot,
  SfLspLanguageEntry,
  SupportedLspLanguage,
} from "../../../lib/common/sf-lsp-health/index.ts";

const stubTheme: BarTheme = {
  fg: (color, text) => `[${color}:${text}]`,
  bold: (text) => `<b>${text}</b>`,
};

function entry(
  language: SupportedLspLanguage,
  overrides: Partial<SfLspLanguageEntry> = {},
): SfLspLanguageEntry {
  return {
    language,
    availability: "unknown",
    activity: "idle",
    ...overrides,
  };
}

function makeHealth(overrides: Partial<SfLspHealthSnapshot["byLanguage"]>): SfLspHealthSnapshot {
  return {
    revision: 1,
    byLanguage: {
      apex: entry("apex"),
      lwc: entry("lwc"),
      agentscript: entry("agentscript"),
      ...overrides,
    },
  };
}

describe("resolveLspStatus", () => {
  it("unknown → dim dotted circle", () => {
    expect(resolveLspStatus(entry("apex"))).toEqual({
      glyph: "◌",
      color: "dim",
      bold: false,
    });
  });

  it("unavailable → bold warning hollow circle", () => {
    expect(resolveLspStatus(entry("apex", { availability: "unavailable" }))).toEqual({
      glyph: "○",
      color: "warning",
      bold: true,
    });
  });

  it("available + idle → success filled circle (not bold)", () => {
    expect(
      resolveLspStatus(entry("apex", { availability: "available", activity: "idle" })),
    ).toEqual({
      glyph: "●",
      color: "success",
      bold: false,
    });
  });

  it("available + checking → bold accent half circle", () => {
    expect(
      resolveLspStatus(entry("apex", { availability: "available", activity: "checking" })),
    ).toEqual({
      glyph: "◐",
      color: "accent",
      bold: true,
    });
  });

  it("available + clean → bold success check", () => {
    expect(
      resolveLspStatus(entry("apex", { availability: "available", activity: "clean" })),
    ).toEqual({
      glyph: "✓",
      color: "success",
      bold: true,
    });
  });

  it("available + error → bold error cross", () => {
    expect(
      resolveLspStatus(entry("apex", { availability: "available", activity: "error" })),
    ).toEqual({
      glyph: "✗",
      color: "error",
      bold: true,
    });
  });
});

describe("formatLspHealthSegment", () => {
  it("returns null when no snapshot is present", () => {
    expect(formatLspHealthSegment(undefined, stubTheme)).toBeNull();
  });

  it("renders full names for each language", () => {
    const out = formatLspHealthSegment(makeHealth({}), stubTheme);
    expect(out).toContain("Apex:");
    expect(out).toContain("LWC:");
    expect(out).toContain("AgentScript:");
    expect(out).not.toContain(" AS:");
  });

  it("renders distinct glyphs for each state", () => {
    const health = makeHealth({
      apex: entry("apex", { availability: "available", activity: "clean" }),
      lwc: entry("lwc", { availability: "available", activity: "error" }),
      agentscript: entry("agentscript", { availability: "unavailable", unavailableDetail: "x" }),
    });
    const out = formatLspHealthSegment(health, stubTheme)!;
    expect(out).toContain("✓"); // clean
    expect(out).toContain("✗"); // error
    expect(out).toContain("○"); // unavailable
  });

  it("uses pipe separators between languages", () => {
    const out = formatLspHealthSegment(makeHealth({}), stubTheme);
    const pipeCount = (out!.match(/\[dim: \| \]/g) ?? []).length;
    expect(pipeCount).toBe(2);
  });
});

describe("renderTopBarLine", () => {
  const base = {
    folderName: "my-project",
  };

  it("returns left-only line when no LSP snapshot is present", () => {
    const lines = renderTopBarLine(base, stubTheme, 120);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("Apex:");
  });

  it("right-aligns the LSP segment at the terminal width", () => {
    const lines = renderTopBarLine(
      {
        ...base,
        lspHealth: makeHealth({
          apex: entry("apex", { availability: "available", activity: "clean" }),
          lwc: entry("lwc", { availability: "available", activity: "clean" }),
          agentscript: entry("agentscript", {
            availability: "available",
            activity: "clean",
          }),
        }),
      },
      stubTheme,
      200,
    );
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(visibleWidth(line)).toBe(200);
    const stripped = line.replace(/\[[^\]]+?:([^\]]*)\]/g, "$1").replace(/<b>(.*?)<\/b>/g, "$1");
    expect(stripped.trimEnd().endsWith("✓")).toBe(true);
  });
});
