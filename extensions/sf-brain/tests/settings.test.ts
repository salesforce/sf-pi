/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEffectiveSfBrainSettings, writeScopedSfBrainSettings } from "../lib/settings.ts";

const tempDirs = new Set<string>();
function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-brain-settings-"));
  tempDirs.add(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

describe("sf-brain settings", () => {
  it("writes and resolves project settings", () => {
    const cwd = tempCwd();
    writeScopedSfBrainSettings(cwd, "project", { herdrGuidance: "off" });
    expect(readEffectiveSfBrainSettings(cwd)).toMatchObject({
      herdrGuidance: "off",
      source: "project",
    });
  });
});
