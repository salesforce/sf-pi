/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the permanent top-bar LSP health segment and the
 * terminal-width-aware renderTopBarLine helper.
 */
import { describe, expect, it } from "vitest";
import { visibleWidth } from "@mariozechner/pi-tui";
import { formatLspHealthSegment, renderTopBarLine, type BarTheme } from "../lib/top-bar.ts";
import type { SfLspHealthSnapshot } from "../../../lib/common/sf-lsp-health/index.ts";

const stubTheme: BarTheme = {
  fg: (color, text) => `[${color}:${text}]`,
  bold: (text) => `<b>${text}</b>`,
};

function makeHealth(overrides: Partial<SfLspHealthSnapshot["byLanguage"]>): SfLspHealthSnapshot {
  return {
    revision: 1,
    byLanguage: {
      apex: { language: "apex", health: "unknown" },
      lwc: { language: "lwc", health: "unknown" },
      agentscript: { language: "agentscript", health: "unknown" },
      ...overrides,
    },
  };
}

describe("formatLspHealthSegment", () => {
  it("returns null when no snapshot is present", () => {
    expect(formatLspHealthSegment(undefined, stubTheme)).toBeNull();
  });

  it("renders full names for each language", () => {
    const out = formatLspHealthSegment(makeHealth({}), stubTheme);
    expect(out).toContain("Apex:");
    expect(out).toContain("LWC:");
    expect(out).toContain("AgentScript:");
    expect(out).not.toContain("AS:");
  });

  it("green dots for available languages", () => {
    const health = makeHealth({
      apex: { language: "apex", health: "available" },
      lwc: { language: "lwc", health: "available" },
      agentscript: { language: "agentscript", health: "available" },
    });
    const out = formatLspHealthSegment(health, stubTheme);
    const greenDots = (out!.match(/\[success:●\]/g) ?? []).length;
    expect(greenDots).toBe(3);
  });

  it("red dot for unavailable language", () => {
    const health = makeHealth({
      apex: { language: "apex", health: "available" },
      lwc: { language: "lwc", health: "unavailable", detail: "missing" },
      agentscript: { language: "agentscript", health: "unknown" },
    });
    const out = formatLspHealthSegment(health, stubTheme);
    expect(out).toMatch(/\[success:●\]/);
    expect(out).toMatch(/\[error:●\]/);
    expect(out).toMatch(/\[dim:●\]/);
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
        lspHealth: {
          revision: 1,
          byLanguage: {
            apex: { language: "apex", health: "available" },
            lwc: { language: "lwc", health: "available" },
            agentscript: { language: "agentscript", health: "available" },
          },
        },
      },
      stubTheme,
      200,
    );
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    // The stub theme emits `[color:...]` wrappers which pi-tui's
    // visibleWidth counts as visible cells. That's fine: the renderer
    // uses the same function to compute padding, so the rendered line's
    // visible width should equal the target terminal width exactly.
    expect(visibleWidth(line)).toBe(200);
    // Strip wrappers to assert the right-most meaningful glyph is `●`.
    const stripped = line.replace(/\[[^\]]+?:([^\]]*)\]/g, "$1").replace(/<b>(.*?)<\/b>/g, "$1");
    expect(stripped.trimEnd().endsWith("●")).toBe(true);
  });
});
