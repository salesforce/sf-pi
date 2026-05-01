/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the sf-welcome recommendations-status helper.
 *
 * Validates the three-way merge (manifest × settings × state file) the splash
 * uses to render the Recommendations block.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectRecommendationsStatus } from "../lib/recommendations-status.ts";

const originalHome = process.env.HOME;
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSettings(filePath: string, settings: Record<string, unknown>): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function writeState(homeDir: string, state: Record<string, unknown>): void {
  const filePath = path.join(homeDir, ".pi", "agent", "state", "sf-pi", "recommendations.json");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("collectRecommendationsStatus", () => {
  it("marks installed items from settings.json as installed", () => {
    const homeDir = makeTempDir("sf-welcome-home-");
    const projectDir = makeTempDir("sf-welcome-project-");
    process.env.HOME = homeDir;

    // Two recommended items installed (one with a version suffix, one via object form).
    writeSettings(path.join(homeDir, ".pi", "agent", "settings.json"), {
      packages: ["npm:pi-web-access@1.2.0", { source: "npm:pi-subagents", extensions: [] }],
    });

    const summary = collectRecommendationsStatus(projectDir);
    expect(summary.total).toBeGreaterThan(0);

    const installed = summary.items.filter((item) => item.status === "installed").map((i) => i.id);
    expect(installed).toContain("pi-web-access");
    expect(installed).toContain("pi-subagents");
  });

  it("falls back to the state file for declined markers only", () => {
    const homeDir = makeTempDir("sf-welcome-home-");
    const projectDir = makeTempDir("sf-welcome-project-");
    process.env.HOME = homeDir;

    writeState(homeDir, {
      acknowledgedRevision: "2026-05-01",
      decisions: {
        "pi-aliases": "declined",
      },
    });

    const summary = collectRecommendationsStatus(projectDir);
    const aliases = summary.items.find((item) => item.id === "pi-aliases");
    expect(aliases?.status).toBe("declined");
    expect(summary.declinedCount).toBe(1);
  });

  it("prefers settings.json 'installed' over a stale 'declined' state marker", () => {
    // If the user previously declined but later installed by hand, reality
    // wins. This locks in the precedence rule documented in the helper.
    const homeDir = makeTempDir("sf-welcome-home-");
    const projectDir = makeTempDir("sf-welcome-project-");
    process.env.HOME = homeDir;

    writeSettings(path.join(homeDir, ".pi", "agent", "settings.json"), {
      packages: ["npm:pi-subagents"],
    });
    writeState(homeDir, {
      acknowledgedRevision: "2026-05-01",
      decisions: { "pi-subagents": "declined" },
    });

    const summary = collectRecommendationsStatus(projectDir);
    const subagents = summary.items.find((item) => item.id === "pi-subagents");
    expect(subagents?.status).toBe("installed");
  });

  it("sorts pending items before installed and declined", () => {
    const homeDir = makeTempDir("sf-welcome-home-");
    const projectDir = makeTempDir("sf-welcome-project-");
    process.env.HOME = homeDir;

    writeSettings(path.join(homeDir, ".pi", "agent", "settings.json"), {
      packages: ["npm:pi-web-access"],
    });
    writeState(homeDir, {
      acknowledgedRevision: "",
      decisions: { "pi-aliases": "declined" },
    });

    const summary = collectRecommendationsStatus(projectDir);
    const statuses = summary.items.map((item) => item.status);
    // Every pending index must come before every installed/declined index.
    const firstInstalled = statuses.indexOf("installed");
    const firstDeclined = statuses.indexOf("declined");
    const lastPending = statuses.lastIndexOf("pending");
    if (firstInstalled !== -1) expect(lastPending).toBeLessThan(firstInstalled);
    if (firstDeclined !== -1) expect(lastPending).toBeLessThan(firstDeclined);
  });
});
