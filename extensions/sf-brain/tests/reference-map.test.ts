/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readBundledKernel } from "../lib/kernel.ts";

const extensionDir = path.resolve(fileURLToPath(import.meta.url), "../..");
const referenceMapPath = path.join(extensionDir, "SF_REFERENCE_MAP.md");

function readReferenceMap(): string {
  return readFileSync(referenceMapPath, "utf8");
}

describe("sf-brain reference map", () => {
  it("keeps the always-injected kernel as a pointer, not the full map", () => {
    const kernel = readBundledKernel();

    expect(kernel).toContain("SF_REFERENCE_MAP.md");
    expect(kernel).toContain("reference map");
    expect(kernel).not.toContain("## Workflow map");
  });

  it("maps user intent to repo-local Salesforce resources", () => {
    const map = readReferenceMap();

    expect(map).toContain("## Workflow map");
    expect(map).toContain("catalog/index.json");
    expect(map).toContain("docs/agent-orientation.md");
    expect(map).toContain("extensions/sf-agentscript/skills/sf-agentscript/SKILL.md");
    expect(map).toContain("extensions/sf-data360/skills/sf-data360/SKILL.md");
    expect(map).toContain("<sf_pi_extensions>");
    expect(map).toContain("/sf-pi enable <id>");
    expect(map).toContain("active skill");
  });
});
