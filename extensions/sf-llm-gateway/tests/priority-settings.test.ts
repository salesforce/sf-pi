/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEffectivePrioritySettings, writeScopedPriority } from "../lib/priority-settings.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const cwd = mkdtempSync(path.join(tmpdir(), "sf-pi-priority-"));
  dirs.push(cwd);
  return { cwd, global: path.join(cwd, "global-settings.json") };
}

describe("Gateway priority preference", () => {
  it("retains priority by default and applies scoped changes immediately", () => {
    const f = fixture();
    expect(readEffectivePrioritySettings(f.cwd, f.global, true)).toEqual({
      enabled: true,
      source: "default",
    });
    writeScopedPriority(f.cwd, "global", false, f.global);
    expect(readEffectivePrioritySettings(f.cwd, f.global, true)).toEqual({
      enabled: false,
      source: "global",
    });
    writeScopedPriority(f.cwd, "project", true, f.global);
    expect(readEffectivePrioritySettings(f.cwd, f.global, true)).toEqual({
      enabled: true,
      source: "project",
    });
    expect(readEffectivePrioritySettings(f.cwd, f.global, false)).toEqual({
      enabled: false,
      source: "global",
    });
    writeScopedPriority(f.cwd, "project", undefined, f.global);
    expect(readEffectivePrioritySettings(f.cwd, f.global, true)).toEqual({
      enabled: false,
      source: "global",
    });
    writeScopedPriority(f.cwd, "global", undefined, f.global);
    expect(readEffectivePrioritySettings(f.cwd, f.global, true)).toEqual({
      enabled: true,
      source: "default",
    });
  });
  it("preserves unrelated settings when saving and resetting", () => {
    const f = fixture();
    const original = {
      defaultModel: "example-model",
      sfPi: { compaction: { model: "active" }, llmGateway: { other: true } },
    };
    writeFileSync(f.global, JSON.stringify(original));
    writeScopedPriority(f.cwd, "global", false, f.global);
    expect(JSON.parse(readFileSync(f.global, "utf8"))).toMatchObject({
      ...original,
      sfPi: { ...original.sfPi, llmGateway: { other: true, priority: false } },
    });
    writeScopedPriority(f.cwd, "global", undefined, f.global);
    expect(JSON.parse(readFileSync(f.global, "utf8"))).toEqual(original);
  });
  it("ignores malformed preferences", () => {
    const f = fixture();
    writeFileSync(f.global, JSON.stringify({ sfPi: { llmGateway: { priority: "false" } } }));
    expect(readEffectivePrioritySettings(f.cwd, f.global, true)).toEqual({
      enabled: true,
      source: "default",
    });
  });
});
