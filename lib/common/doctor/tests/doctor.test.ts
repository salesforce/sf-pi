/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runDoctorDiagnostics } from "../diagnostics.ts";
import { applyDoctorFixes, repairStartupSettings } from "../fixes.ts";

const originalHome = process.env.HOME;
const tempDirs: string[] = [];

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-doctor-home-"));
  tempDirs.push(dir);
  process.env.HOME = dir;
  return dir;
}

function writeSkill(dir: string, name: string): void {
  mkdirSync(path.join(dir, name), { recursive: true });
  writeFileSync(
    path.join(dir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} test skill\n---\n`,
    "utf8",
  );
}

function writeSettings(home: string, body: Record<string, unknown>): string {
  const file = path.join(home, ".pi", "agent", "settings.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return file;
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("runDoctorDiagnostics", () => {
  it("detects duplicate Salesforce skills and prefers Claude as source of truth", () => {
    const home = makeHome();
    const cwd = mkdtempSync(path.join(tmpdir(), "sf-pi-doctor-cwd-"));
    tempDirs.push(cwd);
    writeSettings(home, { skills: ["~/.claude/skills"] });
    writeSkill(path.join(home, ".pi", "agent", "skills"), "sf-soql");
    writeSkill(path.join(home, ".claude", "skills"), "sf-soql");

    const report = runDoctorDiagnostics({ cwd, home });

    expect(report.skillCollisions).toHaveLength(1);
    expect(report.skillCollisions[0]!.name).toBe("sf-soql");
    expect(report.skillCollisions[0]!.preferred.rootKind).toBe("claude");
    expect(report.skillCollisions[0]!.duplicates[0]!.rootKind).toBe("pi");
    expect(report.issues.some((issue) => issue.id === "skill-collisions")).toBe(true);
  });

  it("detects stale and available external skill roots", () => {
    const home = makeHome();
    const cwd = mkdtempSync(path.join(tmpdir(), "sf-pi-doctor-cwd-"));
    tempDirs.push(cwd);
    writeSettings(home, { skills: ["~/missing/skills"] });
    writeSkill(path.join(home, ".claude", "skills"), "sf-apex");

    const report = runDoctorDiagnostics({ cwd, home });

    expect(report.staleSkillPaths.map((entry) => entry.raw)).toContain("~/missing/skills");
    expect(report.availableSkillRoots.map((root) => root.settingsPath)).toContain(
      "~/.claude/skills",
    );
  });
});

describe("doctor fixes", () => {
  it("repairs startup settings without touching other keys", () => {
    const home = makeHome();
    const settings = writeSettings(home, { theme: "dark", sfPi: { asciiIcons: true } });

    expect(repairStartupSettings(settings)).toBe(true);

    const disk = JSON.parse(readFileSync(settings, "utf8"));
    expect(disk.theme).toBe("dark");
    expect(disk.quietStartup).toBe(true);
    expect(disk.sfPi.asciiIcons).toBe(true);
    expect(disk.sfPi.welcome.mode).toBe("header");
  });

  it("quarantines duplicate sf skills from pi-owned roots and keeps Claude", () => {
    const home = makeHome();
    const cwd = mkdtempSync(path.join(tmpdir(), "sf-pi-doctor-cwd-"));
    tempDirs.push(cwd);
    writeSettings(home, { skills: ["~/.claude/skills"] });
    const piRoot = path.join(home, ".pi", "agent", "skills");
    const claudeRoot = path.join(home, ".claude", "skills");
    writeSkill(piRoot, "sf-testing");
    writeSkill(claudeRoot, "sf-testing");

    const result = applyDoctorFixes({
      cwd,
      home,
      fixSkills: true,
      now: new Date("2026-05-04T16:30:00Z"),
    });

    expect(result.changed).toBe(true);
    expect(result.quarantinedSkills).toHaveLength(1);
    expect(existsSync(path.join(piRoot, "sf-testing"))).toBe(false);
    expect(existsSync(path.join(claudeRoot, "sf-testing", "SKILL.md"))).toBe(true);
    expect(
      result.quarantineDir && existsSync(path.join(result.quarantineDir, "manifest.json")),
    ).toBe(true);
  });
});
