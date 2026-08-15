/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateExtensionReadmeContract } from "../lib/readme-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSIONS = path.join(ROOT, "extensions");

describe("human documentation contract", () => {
  it("keeps every extension README human-facing and conditionally structured", () => {
    for (const entry of readdirSync(EXTENSIONS, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = JSON.parse(
        readFileSync(path.join(EXTENSIONS, entry.name, "manifest.json"), "utf8"),
      );
      const readme = readFileSync(path.join(EXTENSIONS, entry.name, "README.md"), "utf8");
      expect(validateExtensionReadmeContract(readme, manifest), entry.name).toEqual([]);

      const agentsPath = path.join(EXTENSIONS, entry.name, "AGENTS.md");
      if (existsSync(agentsPath)) {
        const rules = readFileSync(agentsPath, "utf8");
        expect(rules, `${entry.name}: README is not an editing prerequisite`).not.toMatch(
          /read (?:this|the )?(?:document|readme(?:\.md)?) before (?:making )?changes/i,
        );
        const readFirst = rules.match(/^## Read first\s*$([\s\S]*?)(?=^##\s|$)/m)?.[1] ?? "";
        expect(readFirst, `${entry.name}: README omitted from Read first`).not.toMatch(
          /README\.md/i,
        );
      }
    }
  });

  it("keeps the root README a compact landing page", () => {
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    expect(readme.split("\n").length).toBeLessThanOrEqual(150);
    expect(readme).toContain("[extension catalog](./docs/extensions.md)");
    expect(readme).toContain("[top-level command inventory](./docs/commands.md)");
    expect(readme).not.toContain("GENERATED:bundled-extensions");
    expect(readme).not.toContain("GENERATED:command-reference");
  });

  it("documents the shared product vocabulary once in the contributor guide", () => {
    const contributing = readFileSync(path.join(ROOT, "CONTRIBUTING.md"), "utf8");
    expect(contributing.match(/^#\s/gm)).toHaveLength(1);
    expect(contributing).toContain("## Product and documentation style");
    expect(contributing).toContain(
      "**Behavior Proof** only for evidence observed through a public seam",
    );
  });
});
