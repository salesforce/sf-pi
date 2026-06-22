/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEffectiveFeedbackSettings, writeScopedFeedbackSettings } from "../lib/settings.ts";

const tempDirs = new Set<string>();
function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-feedback-settings-"));
  tempDirs.add(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

describe("feedback settings", () => {
  it("writes and resolves project default issue kind", () => {
    const cwd = tempCwd();
    writeScopedFeedbackSettings(cwd, "project", { defaultIssueKind: "bug" });
    expect(readEffectiveFeedbackSettings(cwd)).toMatchObject({
      defaultIssueKind: "bug",
      source: "project",
    });
  });
});
