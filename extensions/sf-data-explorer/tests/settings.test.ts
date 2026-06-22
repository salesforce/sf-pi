/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Data Explorer settings. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeDataExplorerSettings,
  readEffectiveDataExplorerSettings,
  writeScopedDataExplorerSettings,
} from "../lib/settings.ts";

const tempDirs = new Set<string>();

function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-data-explorer-settings-"));
  tempDirs.add(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

describe("Data Explorer settings", () => {
  it("normalizes invalid values", () => {
    expect(normalizeDataExplorerSettings({ defaultMode: "bad", defaultOrg: "" })).toEqual({
      defaultMode: "soql",
      defaultOrg: "default",
    });
  });

  it("writes and resolves project settings", () => {
    const cwd = tempCwd();
    writeScopedDataExplorerSettings(cwd, "project", { defaultMode: "sql", defaultOrg: "dev" });
    expect(readEffectiveDataExplorerSettings(cwd)).toMatchObject({
      defaultMode: "sql",
      defaultOrg: "dev",
      source: "project",
    });
  });
});
