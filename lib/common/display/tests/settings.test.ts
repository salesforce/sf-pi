/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeDisplaySettingsSource,
  readEffectiveSfPiDisplaySettings,
  readScopedSfPiDisplaySettings,
  writeScopedSfPiDisplaySettings,
} from "../settings.ts";

const tempDirs = new Set<string>();

function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-display-settings-"));
  tempDirs.add(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("sf-pi display settings", () => {
  it("falls back to the balanced default when no project setting exists", () => {
    const cwd = tempCwd();
    const scoped = readScopedSfPiDisplaySettings(cwd, "project");
    expect(scoped.exists).toBe(false);
    expect(scoped.settings.profile).toBe("balanced");
  });

  it("writes and reads project-scoped profile settings", () => {
    const cwd = tempCwd();
    const saved = writeScopedSfPiDisplaySettings(cwd, "project", { profile: "compact" });
    const effective = readEffectiveSfPiDisplaySettings(cwd);

    expect(saved.exists).toBe(true);
    expect(effective.profile).toBe("compact");
    expect(effective.source).toBe("project");
    expect(describeDisplaySettingsSource(effective)).toContain(saved.path);
  });
});
