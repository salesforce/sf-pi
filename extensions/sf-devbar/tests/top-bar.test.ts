/* SPDX-License-Identifier: Apache-2.0 */
import { getCapabilities, setCapabilities, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderTopBar, renderTopBarLine, type TopBarState, type BarTheme } from "../lib/top-bar.ts";

// -------------------------------------------------------------------------------------------------
// Stub theme — returns plain text with markers for testing
// -------------------------------------------------------------------------------------------------

const stubTheme: BarTheme = {
  fg: (color, text) => `[${color}:${text}]`,
  bold: (text) => `<b>${text}</b>`,
};

const ESC = "\u001b";
const ANSI_FG_PREFIX = `${ESC}[38;2;`;
let priorCapabilities: ReturnType<typeof getCapabilities>;

beforeEach(() => {
  priorCapabilities = getCapabilities();
  setCapabilities({ ...priorCapabilities, trueColor: true });
});

afterEach(() => {
  setCapabilities(priorCapabilities);
});

function ansiFg(r: number, g: number, b: number): string {
  return `${ANSI_FG_PREFIX}${r};${g};${b}m`;
}

function ansiFgBg(fr: number, fg: number, fb: number, br: number, bg: number, bb: number): string {
  return `${ANSI_FG_PREFIX}${fr};${fg};${fb};48;2;${br};${bg};${bb}m`;
}

function makeState(overrides?: Partial<TopBarState>): TopBarState {
  return {
    folderName: "my-project",
    ...overrides,
  };
}

// -------------------------------------------------------------------------------------------------
// renderTopBar
// -------------------------------------------------------------------------------------------------

describe("renderTopBar", () => {
  it("returns a single-line array", () => {
    const lines = renderTopBar(makeState(), stubTheme);
    expect(lines).toHaveLength(1);
    expect(typeof lines[0]).toBe("string");
  });

  it("includes the SF Pi brand icons", () => {
    const [line] = renderTopBar(makeState(), stubTheme);
    expect(line).toContain("\ue22c");
    expect(line).toContain("\ue0b1");
  });

  it("uses ASCII-safe top-bar icons in ascii glyph mode", () => {
    const [line] = renderTopBar(
      makeState({
        glyphMode: "ascii",
        modelName: "GPT-5.5",
        modelProvider: "sf-llm-gateway",
        gitBranch: "main",
      }),
      stubTheme,
    );

    expect(line).toContain("sf-pi");
    expect(line).toContain("AI");
    expect(line).toContain("dir my-project");
    expect(line).toContain("git main");
    expect(line).not.toContain("\ue22c");
    expect(line).not.toContain("\uec19");
    expect(line).not.toContain("📂");
    expect(line).not.toContain("\uf126");
  });

  it("includes the folder name", () => {
    const [line] = renderTopBar(makeState({ folderName: "agent-scripts" }), stubTheme);
    expect(line).toContain("agent-scripts");
  });

  it("shows SF LLM Gateway badge when provider matches", () => {
    const [line] = renderTopBar(
      makeState({
        modelProvider: "sf-llm-gateway",
        modelName: "Example Gateway Model",
      }),
      stubTheme,
    );
    // Rainbow gradient splits characters with ANSI codes, so check
    // that each word's characters are present and ANSI color codes exist
    expect(line).toContain("G");
    expect(line).toContain("a");
    expect(line).toContain("t");
    expect(line).toContain("e");
    expect(line).toContain("w");
    expect(line).toContain("y");
    expect(line).toContain(ANSI_FG_PREFIX); // Rainbow ANSI codes
    expect(line).toContain("Example Gateway Model");
  });

  it("shows plain model name for non-gateway providers", () => {
    const [line] = renderTopBar(
      makeState({
        modelProvider: "anthropic",
        modelName: "Claude Sonnet 4",
      }),
      stubTheme,
    );
    expect(line).not.toContain("[SF LLM Gateway]");
    expect(line).toContain("Claude Sonnet 4");
  });

  it("shows thinking level when not off", () => {
    const [line] = renderTopBar(makeState({ thinkingLevel: "xhigh" }), stubTheme);
    // Rainbow uses raw ANSI escapes that split characters, so check
    // that each character of the label is present in order.
    expect(line).toContain("t");
    expect(line).toContain("h");
    expect(line).toContain("i");
    expect(line).toContain("n");
    expect(line).toContain("k");
    // Also verify the ANSI color codes are present (true-color rainbow rendering)
    expect(line).toContain(ANSI_FG_PREFIX);
  });

  it("hides thinking when off", () => {
    const [line] = renderTopBar(makeState({ thinkingLevel: "off" }), stubTheme);
    expect(line).not.toContain("think:");
  });

  it("hides thinking when undefined", () => {
    const [line] = renderTopBar(makeState({ thinkingLevel: undefined }), stubTheme);
    expect(line).not.toContain("think:");
  });

  it("shows Pi's public session name when present", () => {
    const [line] = renderTopBar(makeState({ sessionName: "Review gateway changes" }), stubTheme);
    expect(line).toContain("session:Review gateway changes");
  });

  it("keeps LSP readiness out of the DevBar", () => {
    const legacyState = {
      ...makeState(),
      lspHealth: {
        revision: 1,
        byLanguage: {
          apex: { language: "apex", availability: "available", activity: "idle" },
          lwc: { language: "lwc", availability: "available", activity: "idle" },
          agentscript: {
            language: "agentscript",
            availability: "available",
            activity: "idle",
          },
        },
      },
    } as TopBarState & { lspHealth: object };

    const [line] = renderTopBarLine(legacyState, stubTheme, 200);
    expect(line).not.toContain("LSP[");
    expect(line).not.toContain("Apex:");
    expect(line).not.toContain("AgentScript:");
  });

  it("bounds the remaining DevBar content to terminal width", () => {
    const [line] = renderTopBarLine(
      makeState({ sessionName: `Review-${"gateway-".repeat(20)}` }),
      stubTheme,
      56,
    );

    expect(visibleWidth(line)).toBeLessThanOrEqual(56);
  });

  it("bounds wide-character session names by terminal cells", () => {
    const sessionName = `Review-${"🚀".repeat(40)}`;
    const [line] = renderTopBarLine(makeState({ sessionName }), stubTheme, 80);

    expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    expect(line).not.toContain(sessionName);
  });

  it("shows git branch and changes", () => {
    const [line] = renderTopBar(
      makeState({
        gitBranch: "feature/agents",
        gitChanges: { added: 3, modified: 1, deleted: 0 },
      }),
      stubTheme,
    );
    expect(line).toContain("feature/agents");
    expect(line).toContain("+3");
    expect(line).toContain("~1");
  });

  it("hides git when no branch", () => {
    const [line] = renderTopBar(makeState({ gitBranch: null }), stubTheme);
    expect(line).not.toContain("\uf126");
  });

  it("shows context progress bar with a one-decimal percent label", () => {
    const [line] = renderTopBar(makeState({ contextPercent: 45 }), stubTheme);
    expect(line).toContain("Context Window");
    expect(line).toContain("45.0%");
  });

  it("renders fractional percents with one decimal", () => {
    const [line] = renderTopBar(makeState({ contextPercent: 1.234 }), stubTheme);
    expect(line).toContain("1.2%");
  });

  it("renders a partial-block cell for sub-cell fill", () => {
    // 1/8-block partials (▏▎▍▌▋▊▉) should appear when fill doesn't
    // land on a full-cell boundary. Full cells are █; a partial cell is
    // one of the 1/8-block characters.
    const [line] = renderTopBar(makeState({ contextPercent: 13.75 }), stubTheme);
    // Expect at least one sub-cell partial block in the rendered bar.
    const partialBlocks = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"];
    expect(partialBlocks.some((ch) => line.includes(ch))).toBe(true);
  });

  it("omits context usage when Pi has no usable context fact", () => {
    const [line] = renderTopBar(makeState({ contextPercent: undefined }), stubTheme);
    expect(line).not.toContain("Context Window");
  });

  it("renders exact-zero context usage as 0.0%", () => {
    const [line] = renderTopBar(makeState({ contextPercent: 0 }), stubTheme);
    expect(line).toContain("0.0%");
    expect(line).not.toContain("unknown");
  });

  it("renders nullable context usage as unknown instead of zero", () => {
    const [line] = renderTopBar(makeState({ contextPercent: null }), stubTheme);
    expect(line).toContain("Context Window");
    expect(line).toContain("unknown");
    expect(line).not.toContain("0.0%");
  });

  it("shows thinking indicator when agent is working", () => {
    const [line] = renderTopBar(makeState({ isThinking: true }), stubTheme);
    expect(line).toContain("⟳");
  });

  it("hides thinking indicator when idle", () => {
    const [line] = renderTopBar(makeState({ isThinking: false }), stubTheme);
    expect(line).not.toContain("⟳");
  });

  it("shows the image-width pill when set", () => {
    const [line] = renderTopBar(makeState({ imageWidthPill: "img:120c" }), stubTheme);
    expect(line).toContain("img:120c");
  });

  it("hides the image-width pill when empty", () => {
    const [line] = renderTopBar(makeState({ imageWidthPill: "" }), stubTheme);
    expect(line).not.toContain("img:");
  });

  it("uses pink accent on the gateway model label", () => {
    const [line] = renderTopBar(
      makeState({
        modelProvider: "sf-llm-gateway",
        modelName: "Example Gateway Model",
      }),
      stubTheme,
    );
    // Pink #d787af -> rgb(215,135,175)
    expect(line).toContain(ansiFg(215, 135, 175));
    expect(line).toContain("Example Gateway Model");
  });

  it("uses custom model and folder colors when provided", () => {
    const [line] = renderTopBar(
      makeState({
        modelProvider: "sf-llm-gateway",
        modelName: "Example Gateway Model",
        colors: {
          folderPath: "#112233",
          modelName: "#445566",
          orgWarning: "#cc8866",
          sandboxTrial: "#82aacc",
          contextEmptyFg: "#3c3c4a",
          contextEmptyBg: "#28282e",
          gatewayRainbow: ["#010203", "#040506"],
          thinkingRainbow: ["#b281d6", "#d787af"],
        },
      }),
      stubTheme,
    );

    expect(line).toContain(`${ansiFg(68, 85, 102)}Example Gateway Model`);
    expect(line).toContain(ansiFg(17, 34, 51));
    expect(line).toContain("my-project");
    expect(line).toContain(ansiFg(1, 2, 3));
  });

  it("colors gateway badge brackets as part of the gradient", () => {
    const [line] = renderTopBar(
      makeState({
        modelProvider: "sf-llm-gateway",
        modelName: "Example Gateway Model",
        colors: {
          folderPath: "#00afaf",
          modelName: "#d787af",
          orgWarning: "#cc8866",
          sandboxTrial: "#82aacc",
          contextEmptyFg: "#3c3c4a",
          contextEmptyBg: "#28282e",
          gatewayRainbow: ["#010203", "#040506"],
          thinkingRainbow: ["#b281d6", "#d787af"],
        },
      }),
      stubTheme,
    );

    expect(line).toContain(`${ansiFg(1, 2, 3)}[`);
    expect(line).toContain(`${ansiFg(4, 5, 6)}]`);
  });

  it("renders a single-color gateway palette as a solid badge", () => {
    const solidColor = ansiFg(95, 166, 184);
    const [line] = renderTopBar(
      makeState({
        modelProvider: "sf-llm-gateway",
        modelName: "Example Gateway Model",
        colors: {
          folderPath: "#00afaf",
          modelName: "#d787af",
          orgWarning: "#cc8866",
          sandboxTrial: "#82aacc",
          contextEmptyFg: "#3c3c4a",
          contextEmptyBg: "#28282e",
          gatewayRainbow: ["#5fa6b8"],
          thinkingRainbow: ["#b281d6", "#d787af"],
        },
      }),
      stubTheme,
    );

    expect(line).not.toContain("NaN");
    expect(line).toContain(`${solidColor}[`);
    expect(line).toContain(`${solidColor}]`);
    // "[SF LLM Gateway]" has 14 non-space characters.
    expect(line.split(solidColor).length - 1).toBe(14);
  });

  it("uses custom context empty foreground and background colors", () => {
    const [line] = renderTopBar(
      makeState({
        contextPercent: 10,
        colors: {
          folderPath: "#00afaf",
          modelName: "#d787af",
          orgWarning: "#cc8866",
          sandboxTrial: "#82aacc",
          contextEmptyFg: "#112233",
          contextEmptyBg: "#445566",
          gatewayRainbow: ["#b281d6", "#d787af"],
          thinkingRainbow: ["#010203", "#040506"],
        },
      }),
      stubTheme,
    );

    expect(line).toContain(ansiFgBg(17, 34, 51, 68, 85, 102));
  });

  it("formats context window size correctly", () => {
    const [line1M] = renderTopBar(
      makeState({ contextWindow: 1_000_000, modelName: "test" }),
      stubTheme,
    );
    expect(line1M).toContain("[1M]");

    const [line200K] = renderTopBar(
      makeState({ contextWindow: 200_000, modelName: "test" }),
      stubTheme,
    );
    expect(line200K).toContain("[200K]");
  });
});
