/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Browser settings. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeSfBrowserSettings,
  readEffectiveSfBrowserSettings,
  writeScopedSfBrowserSettings,
} from "../lib/settings.ts";

const tempDirs = new Set<string>();
function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-browser-settings-"));
  tempDirs.add(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

describe("SF Browser settings", () => {
  it("normalizes invalid values", () => {
    expect(normalizeSfBrowserSettings({ evidenceImageMode: "bad" })).toMatchObject({
      evidenceImageMode: "thumbnail",
      dismissOverlays: true,
      includeSetupAuditTrail: false,
    });
  });

  it("writes and resolves project settings", () => {
    const cwd = tempCwd();
    writeScopedSfBrowserSettings(cwd, "project", {
      evidenceImageMode: "artifact",
      dismissOverlays: false,
      includeSetupAuditTrail: true,
    });
    expect(readEffectiveSfBrowserSettings(cwd)).toMatchObject({
      evidenceImageMode: "artifact",
      dismissOverlays: false,
      includeSetupAuditTrail: true,
      source: "project",
    });
  });
});
