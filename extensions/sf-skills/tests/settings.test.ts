/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Skills settings. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeSfSkillsSettings,
  readEffectiveSfSkillsSettings,
  writeScopedSfSkillsSettings,
} from "../lib/settings.ts";

const tempDirs = new Set<string>();
function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-settings-"));
  tempDirs.add(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

describe("SF Skills settings", () => {
  it("normalizes invalid settings", () => {
    expect(
      normalizeSfSkillsSettings({ hudVisibility: "nope", defaultInstallScope: "team" }),
    ).toEqual({
      hudVisibility: "auto",
      defaultInstallScope: "project",
    });
  });

  it("writes and resolves project settings", () => {
    const cwd = tempCwd();
    writeScopedSfSkillsSettings(cwd, "project", {
      hudVisibility: "hidden",
      defaultInstallScope: "global",
    });
    expect(readEffectiveSfSkillsSettings(cwd)).toMatchObject({
      hudVisibility: "hidden",
      defaultInstallScope: "global",
      source: "project",
    });
  });
});
