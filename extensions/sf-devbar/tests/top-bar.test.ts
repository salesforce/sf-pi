/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { renderTopBar, type TopBarState, type BarTheme } from "../lib/top-bar.ts";

// -------------------------------------------------------------------------------------------------
// Stub theme — returns plain text with markers for testing
// -------------------------------------------------------------------------------------------------

const stubTheme: BarTheme = {
  fg: (color, text) => `[${color}:${text}]`,
  bold: (text) => `<b>${text}</b>`,
};

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
        modelProvider: "sf-llm-gateway-internal",
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
        modelProvider: "sf-llm-gateway-internal",
        modelName: "Claude Opus 4.7",
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
    expect(line).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/); // Rainbow ANSI codes
    expect(line).toContain("Claude Opus 4.7");
  });

  it("shows SF LLM Gateway badge when provider matches the Anthropic-native gateway", () => {
    const [line] = renderTopBar(
      makeState({
        modelProvider: "sf-llm-gateway-internal-anthropic",
        modelName: "Claude Opus 4.7",
      }),
      stubTheme,
    );
    // Gateway badge must render for Claude too. Rainbow ANSI + letter check.
    expect(line).toContain("G");
    expect(line).toContain("t");
    expect(line).toContain("y");
    expect(line).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
    expect(line).toContain("Claude Opus 4.7");
    // Pink accent #d787af -> rgb(215,135,175) must apply to the model label.
    expect(line).toMatch(/\x1b\[38;2;215;135;175m/);
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
    expect(line).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
  });

  it("hides thinking when off", () => {
    const [line] = renderTopBar(makeState({ thinkingLevel: "off" }), stubTheme);
    expect(line).not.toContain("think:");
  });

  it("hides thinking when undefined", () => {
    const [line] = renderTopBar(makeState({ thinkingLevel: undefined }), stubTheme);
    expect(line).not.toContain("think:");
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

  it("hides context bar when null", () => {
    const [line] = renderTopBar(makeState({ contextPercent: null }), stubTheme);
    expect(line).not.toContain("Context Window");
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
        modelProvider: "sf-llm-gateway-internal",
        modelName: "Claude Opus 4.7",
      }),
      stubTheme,
    );
    // Pink #d787af -> rgb(215,135,175)
    expect(line).toMatch(/\x1b\[38;2;215;135;175m/);
    expect(line).toContain("Claude Opus 4.7");
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
