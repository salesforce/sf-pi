/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const extensionsRoot = path.join(repoRoot, "extensions");

type Manifest = {
  id: string;
  tools?: string[];
  docs?: {
    editingRules?: string;
    agentGuide?: string;
    contextGlossary?: string;
  };
};

function manifests(): Manifest[] {
  return readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      JSON.parse(readFileSync(path.join(extensionsRoot, entry.name, "manifest.json"), "utf8")),
    );
}

describe("Progressive SF Pi Documentation", () => {
  it("declares every extension-local agent document in its manifest", () => {
    for (const manifest of manifests()) {
      for (const field of ["editingRules", "agentGuide", "contextGlossary"] as const) {
        const relativePath = manifest.docs?.[field];
        if (!relativePath) continue;
        const file = path.join(extensionsRoot, manifest.id, relativePath);
        expect(existsSync(file), `${manifest.id}: docs.${field}`).toBe(true);
        expect(readFileSync(file, "utf8"), file).toMatch(/^# /);
      }
      if ((manifest.tools?.length ?? 0) > 0) {
        expect(manifest.docs?.agentGuide, `${manifest.id}: tool operating guide`).toBe(
          "AGENT_GUIDE.md",
        );
      }
    }
  });

  it("keeps workspace-relative operating-guide paths out of tool prompt guidelines", () => {
    for (const manifest of manifests()) {
      const lib = path.join(extensionsRoot, manifest.id, "lib");
      if (!existsSync(lib)) continue;
      for (const file of typescriptFiles(lib)) {
        expect(readFileSync(file, "utf8"), file).not.toMatch(
          /extensions\/sf-[a-z0-9-]+\/AGENT_GUIDE\.md/u,
        );
      }
    }
  });

  it("keeps retired bundled skill/reference routing absent", () => {
    expect(existsSync(path.join(extensionsRoot, "sf-brain", "SF_REFERENCE_MAP.md"))).toBe(false);
    expect(existsSync(path.join(extensionsRoot, "sf-browser", "skills"))).toBe(false);
    expect(existsSync(path.join(extensionsRoot, "sf-agentscript", "skills"))).toBe(false);
  });
});

function typescriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...typescriptFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(absolute);
  }
  return files;
}
