/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { DEVBAR_COLOR_DESCRIPTORS } from "../lib/colors.ts";
import {
  createConfigPanel,
  parseDevbarColorInput,
  parsePaletteInput,
} from "../lib/config-panel.ts";

const tempDirs: string[] = [];
const stubTheme: Theme = {
  fg: (color: string, text: string) => `[${color}:${text}]`,
  bold: (text: string) => `<b>${text}</b>`,
} as Theme;

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("DevBar config panel parsers", () => {
  it("parses scalar color input", () => {
    const descriptor = DEVBAR_COLOR_DESCRIPTORS.find((item) => item.key === "folderPath")!;
    expect(parseDevbarColorInput(descriptor, "#ABC")).toBe("#aabbcc");
    expect(parseDevbarColorInput(descriptor, "nope")).toBeUndefined();
  });

  it("parses palette input as comma-separated values or JSON arrays", () => {
    expect(parsePaletteInput("#123, #456789")).toEqual(["#112233", "#456789"]);
    expect(parsePaletteInput('["#123", "#456789"]')).toEqual(["#112233", "#456789"]);
    expect(parsePaletteInput("#123, nope")).toBeUndefined();
  });
});

describe("DevBar config panel", () => {
  it("buffers edits and saves project scoped overrides once", () => {
    const cwd = makeTempDir("devbar-config-panel-");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ theme: "dark" }), "utf-8");
    let result: unknown;
    const panel = createConfigPanel(stubTheme, cwd, "project", (value) => {
      result = value;
    }) as unknown as { handleInput(data: string): void; renderContent(width: number): string[] };

    panel.handleInput("enter");
    for (let i = 0; i < 7; i++) panel.handleInput("backspace");
    panel.handleInput("#abc");
    panel.handleInput("enter");
    panel.handleInput("s");

    expect(result).toEqual({ needsReload: true });
    const raw = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf-8"));
    expect(raw.theme).toBe("dark");
    expect(raw.sfPi.devbar.colors).toEqual({ folderPath: "#aabbcc" });
  });

  it("keeps invalid edits open without writing settings", () => {
    const cwd = makeTempDir("devbar-config-panel-");
    let result: unknown;
    const panel = createConfigPanel(stubTheme, cwd, "project", (value) => {
      result = value;
    }) as unknown as { handleInput(data: string): void; renderContent(width: number): string[] };

    panel.handleInput("enter");
    for (let i = 0; i < 7; i++) panel.handleInput("backspace");
    panel.handleInput("not-a-color");
    panel.handleInput("enter");

    expect(result).toBeUndefined();
    expect(panel.renderContent(100).join("\n")).toContain("Invalid color");
  });
});
