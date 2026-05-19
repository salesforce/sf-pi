/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SKILLS_DIR = "extensions/sf-data360/skills";
const PHASE_SKILLS = [
  "sf-data360-connect",
  "sf-data360-prepare",
  "sf-data360-harmonize",
  "sf-data360-segment",
  "sf-data360-act",
  "sf-data360-retrieve",
  "sf-data360-observe",
  "sf-data360-orchestrate",
] as const;

describe("d360 phase skill pack", () => {
  it("commits one generated SKILL.md for each canonical Data 360 phase", () => {
    for (const skillName of PHASE_SKILLS) {
      const skillPath = path.join(SKILLS_DIR, skillName, "SKILL.md");
      expect(existsSync(skillPath), `${skillPath} should exist`).toBe(true);

      const content = readFileSync(skillPath, "utf8");
      expect(content).toContain(`name: ${skillName}`);
      expect(content).toContain("Generated from extensions/sf-data360/registry/phases.json");
    }
  });

  it("keeps generated phase skills behind a check script in the normal lint path", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["generate-d360-skills"]).toBe(
      "node scripts/generate-d360-skills.mjs",
    );
    expect(packageJson.scripts?.["generate-d360-skills:check"]).toBe(
      "node scripts/generate-d360-skills.mjs --check",
    );
    expect(packageJson.scripts?.lint).toContain("generate-d360-skills:check");
  });
});
