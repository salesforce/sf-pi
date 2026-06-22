/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeAgentScriptSettings,
  readEffectiveAgentScriptSettings,
  writeScopedAgentScriptSettings,
} from "../lib/settings.ts";

const tempDirs = new Set<string>();
function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-agentscript-settings-"));
  tempDirs.add(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

describe("Agent Script settings", () => {
  it("normalizes invalid values", () => {
    expect(
      normalizeAgentScriptSettings({
        previewMockMode: "bad",
        evalTracesMode: "x",
        evalConcurrency: 99,
      }),
    ).toEqual({
      previewMockMode: "Mock",
      evalTracesMode: "failed",
      evalConcurrency: 8,
    });
  });

  it("writes and resolves project settings", () => {
    const cwd = tempCwd();
    writeScopedAgentScriptSettings(cwd, "project", {
      previewMockMode: "Live Test",
      evalTracesMode: "off",
      evalConcurrency: 16,
    });
    expect(readEffectiveAgentScriptSettings(cwd)).toMatchObject({
      previewMockMode: "Live Test",
      evalTracesMode: "off",
      evalConcurrency: 16,
      source: "project",
    });
  });
});
