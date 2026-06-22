/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Data 360 settings. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeData360Settings,
  readEffectiveData360Settings,
  readScopedData360Settings,
  writeScopedData360Settings,
} from "../lib/settings.ts";

const tempDirs = new Set<string>();

function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-data360-settings-"));
  tempDirs.add(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

describe("Data 360 settings", () => {
  it("defaults output mode to summary", () => {
    expect(normalizeData360Settings({}).defaultOutputMode).toBe("summary");
    expect(normalizeData360Settings({ defaultOutputMode: "nope" }).defaultOutputMode).toBe(
      "summary",
    );
  });

  it("writes and resolves project-scoped output mode", () => {
    const cwd = tempCwd();
    const saved = writeScopedData360Settings(cwd, "project", { defaultOutputMode: "file_only" });
    const scoped = readScopedData360Settings(cwd, "project");
    const effective = readEffectiveData360Settings(cwd);

    expect(saved.exists).toBe(true);
    expect(scoped.settings.defaultOutputMode).toBe("file_only");
    expect(effective.defaultOutputMode).toBe("file_only");
    expect(effective.source).toBe("project");
  });
});
