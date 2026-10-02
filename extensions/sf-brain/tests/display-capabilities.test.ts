/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import {
  DISPLAY_CAPABILITIES_ENTRY_TYPE,
  formatDisplayCapabilitiesContext,
  resolveDisplayCapabilities,
  shouldInjectDisplayCapabilities,
} from "../lib/display-capabilities.ts";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => tempAgentDir,
}));

beforeEach(() => {
  tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-brain-display-"));
});

afterEach(() => rmSync(tempAgentDir, { recursive: true, force: true }));

describe("SF Brain display capabilities", () => {
  it("resolves Pi Mermaid mode and SF Pi glyph mode with project precedence", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "sf-brain-display-cwd-"));
    try {
      expect(resolveDisplayCapabilities(cwd, { TERM_PROGRAM: "herdr" })).toEqual({
        mermaid: true,
        mermaidMode: "streaming",
        emoji: true,
        glyphMode: "emoji",
      });

      writeFileSync(
        path.join(tempAgentDir, "settings.json"),
        JSON.stringify({ markdown: { mermaid: "off" }, sfPi: { asciiIcons: true } }),
      );
      expect(resolveDisplayCapabilities(cwd, { TERM_PROGRAM: "herdr" })).toMatchObject({
        mermaid: false,
        mermaidMode: "off",
        emoji: false,
        glyphMode: "ascii",
      });

      mkdirSync(path.join(cwd, ".pi"), { recursive: true });
      writeFileSync(
        path.join(cwd, ".pi", "settings.json"),
        JSON.stringify({ markdown: { mermaid: "final" }, sfPi: { asciiIcons: false } }),
      );
      expect(resolveDisplayCapabilities(cwd, { TERM_PROGRAM: "Apple_Terminal" })).toMatchObject({
        mermaid: true,
        mermaidMode: "final",
        emoji: true,
        glyphMode: "emoji",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("formats compact model-visible guidance for rich and fallback modes", () => {
    const rich = formatDisplayCapabilitiesContext({
      mermaid: true,
      mermaidMode: "streaming",
      emoji: true,
      glyphMode: "emoji",
    });
    const fallback = formatDisplayCapabilitiesContext({
      mermaid: false,
      mermaidMode: "off",
      emoji: false,
      glyphMode: "ascii",
    });

    expect(rich).toContain("<sf_display_capabilities>");
    expect(rich).toContain("Mermaid terminal rendering: streaming");
    expect(rich).toContain("Chat status markers: emoji");
    expect(fallback).toContain("Use indented bullets or `A → B → C`");
    expect(fallback).toContain("[OK], [FAIL], [WARN], [TIP], and [NEXT]");
  });

  it("reinjects only when the latest display capability context changes", () => {
    const current = formatDisplayCapabilitiesContext({
      mermaid: true,
      mermaidMode: "streaming",
      emoji: true,
      glyphMode: "emoji",
    });
    const session = (content?: string) => ({
      buildContextEntries: (): SessionEntry[] =>
        content === undefined
          ? []
          : [
              {
                id: "display",
                parentId: null,
                timestamp: new Date().toISOString(),
                type: "custom_message",
                customType: DISPLAY_CAPABILITIES_ENTRY_TYPE,
                content,
                display: false,
              },
            ],
    });

    expect(shouldInjectDisplayCapabilities(session(current), current)).toBe(false);
    expect(shouldInjectDisplayCapabilities(session(`${current}stale`), current)).toBe(true);
    expect(shouldInjectDisplayCapabilities(session(), current)).toBe(true);
  });
});
