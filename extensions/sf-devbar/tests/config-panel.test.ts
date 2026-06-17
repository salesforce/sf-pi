/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { DEVBAR_COLOR_DESCRIPTORS } from "../lib/colors.ts";
import {
  createConfigPanel,
  normalizeTextInput,
  parseDevbarColorInput,
  parsePaletteInput,
} from "../lib/config-panel.ts";

const tempDirs: string[] = [];
const stubTheme: Theme = {
  fg: (color: string, text: string) => `[${color}:${text}]`,
  bold: (text: string) => `<b>${text}</b>`,
} as Theme;

type TestPanel = { handleInput(data: string): void; renderContent(width: number): string[] };

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makePanel(cwd: string, onDone: (value: unknown) => void = () => undefined): TestPanel {
  return createConfigPanel(stubTheme, cwd, "project", onDone) as unknown as TestPanel;
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

  it("strips terminal controls from text input", () => {
    expect(normalizeTextInput("#123\u001b[200~#456\u001b[201~\u001b[B\n")).toBe("#123#456");
  });
});

describe("DevBar config panel", () => {
  it("opens a dedicated edit page, buffers valid edits, and saves once", () => {
    const cwd = makeTempDir("devbar-config-panel-");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ theme: "dark" }), "utf-8");
    let result: unknown;
    const panel = makePanel(cwd, (value) => {
      result = value;
    });

    panel.handleInput("enter");
    expect(panel.renderContent(100).join("\n")).toContain("Edit Folder path");
    panel.handleInput("#abc");
    panel.handleInput("enter");

    const listView = panel.renderContent(100).join("\n");
    expect(listView).toContain("unsaved changes");
    expect(listView).not.toContain("Edit:");

    panel.handleInput("s");

    expect(result).toEqual({ needsReload: true });
    const raw = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf-8"));
    expect(raw.theme).toBe("dark");
    expect(raw.sfPi.devbar.colors).toEqual({ folderPath: "#aabbcc" });
  });

  it("starts default palette edits from an empty draft instead of appending to defaults", () => {
    const cwd = makeTempDir("devbar-config-panel-");
    let result: unknown;
    const panel = makePanel(cwd, (value) => {
      result = value;
    });
    const paletteIndex = DEVBAR_COLOR_DESCRIPTORS.findIndex(
      (item) => item.key === "gatewayRainbow",
    );
    for (let i = 0; i < paletteIndex; i++) panel.handleInput("down");

    panel.handleInput("enter");
    panel.handleInput("#123, #456789");
    panel.handleInput("enter");
    panel.handleInput("s");

    expect(result).toEqual({ needsReload: true });
    const raw = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf-8"));
    expect(raw.sfPi.devbar.colors.gatewayRainbow).toEqual(["#112233", "#456789"]);
  });

  it("keeps invalid edits on the edit page without writing settings", () => {
    const cwd = makeTempDir("devbar-config-panel-");
    let result: unknown;
    const panel = makePanel(cwd, (value) => {
      result = value;
    });

    panel.handleInput("enter");
    for (let i = 0; i < 7; i++) panel.handleInput("backspace");
    panel.handleInput("not-a-color");
    panel.handleInput("enter");

    const rendered = panel.renderContent(100).join("\n");
    expect(result).toBeUndefined();
    expect(rendered).toContain("Edit Folder path");
    expect(rendered).toContain("Invalid color");
  });

  it("cancels the active field edit with escape without leaving settings", () => {
    const cwd = makeTempDir("devbar-config-panel-");
    let result: unknown;
    const panel = makePanel(cwd, (value) => {
      result = value;
    });

    panel.handleInput("enter");
    panel.handleInput("#abc");
    panel.handleInput("escape");

    const rendered = panel.renderContent(100).join("\n");
    expect(result).toBeUndefined();
    expect(rendered).toContain("SF Pi › SF DevBar › Settings");
    expect(rendered).not.toContain("Edit Folder path");
    expect(rendered).not.toContain("#abc");
  });
});
