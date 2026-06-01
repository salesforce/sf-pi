/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REFERENCES_DIR = "extensions/sf-data360/references/phases";
const PHASE_REFERENCES = [
  "connect.md",
  "prepare.md",
  "harmonize.md",
  "segment.md",
  "act.md",
  "retrieve.md",
  "observe.md",
  "orchestrate.md",
] as const;

describe("Data 360 phase references", () => {
  it("commits one generated reference page for each canonical Data 360 phase", () => {
    for (const fileName of PHASE_REFERENCES) {
      const referencePath = path.join(REFERENCES_DIR, fileName);
      expect(existsSync(referencePath), `${referencePath} should exist`).toBe(true);

      const content = readFileSync(referencePath, "utf8");
      expect(content).toContain("Generated from extensions/sf-data360/registry/phases.json");
      expect(content).not.toContain("---\nname:");
      expect(content).not.toContain("SKILL.md");
    }
  });

  it("keeps generated phase references concise and action-oriented", () => {
    for (const fileName of PHASE_REFERENCES) {
      const content = readFileSync(path.join(REFERENCES_DIR, fileName), "utf8");
      expect(content).toContain("Data 360 family actions");
      expect(content).not.toContain("## Operation map");
      expect(content).not.toContain("action=`runbook`");
      expect(content.split("\n").length).toBeLessThanOrEqual(90);
    }
  });

  it("keeps generated phase references behind a check script in the normal lint path", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["generate-d360-references"]).toBe(
      "node scripts/generate-d360-references.mjs",
    );
    expect(packageJson.scripts?.["generate-d360-references:check"]).toBe(
      "node scripts/generate-d360-references.mjs --check",
    );
    expect(packageJson.scripts?.lint).toContain("generate-d360-references:check");
  });
});
