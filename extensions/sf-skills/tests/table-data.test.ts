/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the datatable row builders.
 *
 * No real settings on disk — we set HOME to a fake dir and feed in a
 * synthetic SlashCommandInfo[] array so each test exercises one path
 * through the classifier and wiring resolver.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { buildActiveRows, buildDiscoverRows } from "../lib/table-data.ts";
import { isSalesforceSkill, sourceCategory } from "../lib/classify.ts";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-tbl-home-"));
  tempDirs.push(dir);
  return dir;
}

function makeCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-tbl-cwd-"));
  tempDirs.push(dir);
  return dir;
}

function writeSettings(dir: string, body: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

function skillCommand(name: string, filePath: string): SlashCommandInfo {
  return {
    name: `skill:${name}`,
    description: `${name} skill`,
    source: "skill",
    sourceInfo: { path: filePath, source: "x", scope: "user", origin: "top-level" },
  };
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("classify", () => {
  it("treats sf-* names as Salesforce", () => {
    const home = makeHome();
    process.env.HOME = home;
    expect(isSalesforceSkill({ name: "sf-apex", skillPath: "/foo/bar", cwd: makeCwd() })).toBe(
      true,
    );
  });

  it("treats paths under managed afv-library as Salesforce", () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    expect(
      isSalesforceSkill({
        name: "anything",
        skillPath: path.join(
          home,
          ".pi",
          "agent",
          "sf-skills",
          "afv-library",
          "skills",
          "x",
          "SKILL.md",
        ),
        cwd,
      }),
    ).toBe(true);
  });

  it("classifies bundled extension paths as 'bundled'", () => {
    const home = makeHome();
    process.env.HOME = home;
    expect(
      sourceCategory({
        skillPath: "/repo/extensions/sf-data360/skills/sf-data360/SKILL.md",
        name: "sf-data360",
        cwd: makeCwd(),
      }),
    ).toBe("bundled");
  });

  it("classifies managed clone paths as 'afv-library'", () => {
    const home = makeHome();
    process.env.HOME = home;
    const skillPath = path.join(
      home,
      ".pi",
      "agent",
      "sf-skills",
      "afv-library",
      "skills",
      "sf-apex",
      "SKILL.md",
    );
    expect(sourceCategory({ skillPath, name: "sf-apex", cwd: makeCwd() })).toBe("afv-library");
  });
});

describe("buildActiveRows", () => {
  it("returns an empty array when no skill commands are loaded", () => {
    const home = makeHome();
    process.env.HOME = home;
    expect(buildActiveRows({ commands: [], cwd: makeCwd() })).toEqual([]);
  });

  it("groups SF first, then external, by name", () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    const commands: SlashCommandInfo[] = [
      skillCommand(
        "brave-search",
        path.join(home, ".claude", "skills", "brave-search", "SKILL.md"),
      ),
      skillCommand(
        "sf-apex",
        path.join(
          home,
          ".pi",
          "agent",
          "sf-skills",
          "afv-library",
          "skills",
          "sf-apex",
          "SKILL.md",
        ),
      ),
      skillCommand(
        "sf-flow",
        path.join(
          home,
          ".pi",
          "agent",
          "sf-skills",
          "afv-library",
          "skills",
          "sf-flow",
          "SKILL.md",
        ),
      ),
    ];
    const rows = buildActiveRows({ commands, cwd });
    expect(rows.map((r) => r.name)).toEqual(["sf-apex", "sf-flow", "brave-search"]);
  });

  it("reports wired=global when the skill path is under a global settings entry", () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    writeSettings(path.join(home, ".pi", "agent"), {
      skills: [path.join(home, ".claude", "skills")],
    });
    const commands: SlashCommandInfo[] = [
      skillCommand(
        "brave-search",
        path.join(home, ".claude", "skills", "brave-search", "SKILL.md"),
      ),
    ];
    const rows = buildActiveRows({ commands, cwd });
    expect(rows[0]?.wired).toBe("global");
    expect(rows[0]?.source).toBe("wired");
  });

  it("reports wired=both when a path is referenced in global AND project settings", () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    writeSettings(path.join(home, ".pi", "agent"), {
      skills: [path.join(home, "shared", "skills")],
    });
    writeSettings(path.join(cwd, ".pi"), {
      skills: [path.join(home, "shared", "skills")],
    });
    mkdirSync(path.join(home, "shared", "skills", "demo"), { recursive: true });
    const commands: SlashCommandInfo[] = [
      skillCommand("demo", path.join(home, "shared", "skills", "demo", "SKILL.md")),
    ];
    const rows = buildActiveRows({ commands, cwd });
    expect(rows[0]?.wired).toBe("both");
  });

  it("flags bundled and auto-discovered rows as readOnly", () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    const commands: SlashCommandInfo[] = [
      skillCommand("sf-data360", "/repo/extensions/sf-data360/skills/sf-data360/SKILL.md"),
      skillCommand("auto", path.join(home, ".pi", "agent", "skills", "auto", "SKILL.md")),
    ];
    const rows = buildActiveRows({ commands, cwd });
    expect(rows.find((r) => r.name === "sf-data360")?.readOnly).toBe(true);
    expect(rows.find((r) => r.name === "auto")?.readOnly).toBe(true);
  });
});

describe("buildDiscoverRows", () => {
  it("includes Active rows plus disk candidates that aren't wired", () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    // Disk-only candidate (a Claude skills root that isn't in settings).
    mkdirSync(path.join(home, ".claude", "skills", "search"), { recursive: true });
    writeFileSync(
      path.join(home, ".claude", "skills", "search", "SKILL.md"),
      "---\nname: search\n---\n",
    );

    const rows = buildDiscoverRows({ commands: [], cwd });
    expect(rows.some((r) => r.discover === "candidate")).toBe(true);
    const candidate = rows.find((r) => r.discover === "candidate");
    expect(candidate && candidate.discover === "candidate" ? candidate.label : null).toBe(
      "Claude Code",
    );
  });
});
