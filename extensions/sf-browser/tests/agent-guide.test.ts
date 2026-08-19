/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const extensionRoot = path.resolve(import.meta.dirname, "..");
const guidePath = path.join(extensionRoot, "AGENT_GUIDE.md");
const patternsPath = path.join(extensionRoot, "docs/ui-patterns.md");

describe("SF Browser operating guide index", () => {
  it("keeps AGENT_GUIDE.md as a Pi-style index", () => {
    const guide = readFileSync(guidePath, "utf8");
    expect(guide.split("\n").length).toBeLessThanOrEqual(55);
    expect(guide).toContain("docs/ui-patterns.md");
    expect(guide).toMatch(/^## Core loop/m);
    expect(guide).not.toMatch(/^## Salesforce UI patterns/m);
    expect(guide).not.toContain("Prefer snapshot refs over CSS selectors");
  });

  it("moves UI patterns to exactly one child", () => {
    expect(existsSync(patternsPath), patternsPath).toBe(true);
    const patterns = readFileSync(patternsPath, "utf8");
    expect(patterns).toMatch(/^# /);
    expect(patterns).toContain("Prefer snapshot refs over CSS selectors");
    expect(patterns).toContain("data-cloud");
    expect(patterns).toContain("sf_browser_editor");
    expect(patterns).toContain("dismissOverlays");
    expect(patterns).not.toMatch(/^## Core loop/m);
  });
});
