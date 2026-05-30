/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return { ...actual, getAgentDir: () => tempAgentDir };
});

describe("Code Analyzer settings", () => {
  let cwd: string;
  let settings: typeof import("../lib/settings.ts");

  beforeEach(async () => {
    tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-code-analyzer-agent-"));
    cwd = mkdtempSync(path.join(tmpdir(), "sf-code-analyzer-cwd-"));
    vi.resetModules();
    settings = await import("../lib/settings.ts");
  });

  afterEach(() => {
    rmSync(tempAgentDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("uses defaults until global or project settings override", () => {
    expect(settings.readEffectiveCodeAnalyzerSettings(cwd)).toMatchObject({
      autoScan: true,
      apexGuruAuto: true,
      sources: { autoScan: "default", apexGuruAuto: "default" },
    });

    settings.writeCodeAnalyzerSetting(cwd, "global", "autoScan", false);
    expect(settings.readEffectiveCodeAnalyzerSettings(cwd)).toMatchObject({
      autoScan: false,
      sources: { autoScan: "global" },
    });

    settings.writeCodeAnalyzerSetting(cwd, "project", "autoScan", true);
    expect(settings.readEffectiveCodeAnalyzerSettings(cwd)).toMatchObject({
      autoScan: true,
      sources: { autoScan: "project" },
    });

    settings.resetProjectCodeAnalyzerSetting(cwd, "autoScan");
    expect(settings.readEffectiveCodeAnalyzerSettings(cwd)).toMatchObject({
      autoScan: false,
      sources: { autoScan: "global" },
    });
  });
});
