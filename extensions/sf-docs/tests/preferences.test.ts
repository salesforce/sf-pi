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

describe("sf-docs preferences", () => {
  let cwd: string;
  let prefs: typeof import("../lib/preferences.ts");

  beforeEach(async () => {
    tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-agent-"));
    cwd = mkdtempSync(path.join(tmpdir(), "sf-docs-cwd-"));
    vi.resetModules();
    prefs = await import("../lib/preferences.ts");
  });

  afterEach(() => {
    rmSync(tempAgentDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("resolves project > global > default", () => {
    expect(prefs.readEffectiveDocsPreferences(cwd)).toMatchObject({
      defaultCollection: "developer",
      displayDensity: "balanced",
      sources: {
        defaultCollection: { scope: "default" },
        displayDensity: { scope: "default" },
      },
    });

    prefs.writeDocsPreference(cwd, "global", "defaultCollection", "admin");
    expect(prefs.readEffectiveDocsPreferences(cwd)).toMatchObject({
      defaultCollection: "admin",
      sources: { defaultCollection: { scope: "global" } },
    });

    prefs.writeDocsPreference(cwd, "project", "defaultCollection", "tableau");
    prefs.writeDocsPreference(cwd, "project", "displayDensity", "verbose");
    expect(prefs.readEffectiveDocsPreferences(cwd)).toMatchObject({
      defaultCollection: "tableau",
      displayDensity: "verbose",
      sources: {
        defaultCollection: { scope: "project" },
        displayDensity: { scope: "project" },
      },
    });
  });
});
