/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the sf-welcome recommendations-status helper.
 *
 * Validates the three-way merge (manifest × settings × state file) the splash
 * uses to render the Recommendations block.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
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

  it("marks a git-sourced item as installed when cloned into ~/.pi/agent/skills/<id>/", () => {
    // Mirrors the real pi-skills install instructions: clone the repo
    // directly into a skill-discovery root with no entry in packages[].
    // Before the fix the splash reported this as pending forever.
    const homeDir = makeTempDir("sf-welcome-home-");
    const projectDir = makeTempDir("sf-welcome-project-");
    process.env.HOME = homeDir;

    mkdirSync(path.join(homeDir, ".pi", "agent", "skills", "pi-skills"), { recursive: true });

    const summary = collectRecommendationsStatus(projectDir);
    const piSkills = summary.items.find((item) => item.id === "pi-skills");
    expect(piSkills?.status).toBe("installed");
  });

  it("does not treat a non-git item id cloned into a skills root as installed", () => {
    // Only git: items participate in skill-dir detection. A directory
    // named after an npm item (e.g. pi-web-access) must not be enough
    // — npm packages install into settings.json and nowhere else.
    const homeDir = makeTempDir("sf-welcome-home-");
    const projectDir = makeTempDir("sf-welcome-project-");
    process.env.HOME = homeDir;

    mkdirSync(path.join(homeDir, ".pi", "agent", "skills", "pi-web-access"), { recursive: true });

    const summary = collectRecommendationsStatus(projectDir);
    const webAccess = summary.items.find((item) => item.id === "pi-web-access");
    expect(webAccess?.status).not.toBe("installed");
  });

  it("detects a skill-dir clone under ~/.agents/skills/<id>/ too", () => {
    // pi-coding-agent also discovers ~/.agents/skills. Users who follow
    // the Agent Skills specification path (instead of pi's native
    // ~/.pi/agent/skills) deserve the same treatment.
    const homeDir = makeTempDir("sf-welcome-home-");
    const projectDir = makeTempDir("sf-welcome-project-");
    process.env.HOME = homeDir;

    mkdirSync(path.join(homeDir, ".agents", "skills", "pi-skills"), { recursive: true });

    const summary = collectRecommendationsStatus(projectDir);
    const piSkills = summary.items.find((item) => item.id === "pi-skills");
    expect(piSkills?.status).toBe("installed");
  });
});
