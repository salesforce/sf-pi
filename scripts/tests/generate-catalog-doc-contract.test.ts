/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCommandArgs } from "../../extensions/sf-pi-manager/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSIONS_DIR = path.join(ROOT, "extensions");
const CATALOG_PATH = path.join(ROOT, "catalog", "index.json");
const EXTENSION_COPY_PATH = path.join(ROOT, "docs", "extension-copy.json");
const EXTENSIONS_DOC_PATH = path.join(ROOT, "docs", "extensions.md");
const EXTENSION_DETAIL_DIR = path.join(ROOT, "docs", "extensions");
const EXTENSION_SIDEBAR_PATH = path.join(
  ROOT,
  "docs",
  ".vitepress",
  "generated-extension-sidebar.ts",
);
const VALID_INTENT_GROUPS = new Set([
  "Build agents",
  "Build apps",
  "Query data",
  "Work with Salesforce orgs",
  "Work with Data Cloud",
  "Work safely",
  "Collaborate and improve",
  "Personalize pi",
]);

const RETIRED_CURRENT_COPY = [
  /operator kernel/i,
  /compact reference map/i,
  /workflow profiles/i,
  /signal inference/i,
  /local credential storage/i,
  /lifecycle settings that close/i,
  /lane that closes on success/i,
  /clean themselves up/i,
  /v2 capability sweep/i,
  /plans dry-run coverage for every v2 action family/i,
  /D360_SWEEP_ALLOW_DESTRUCTIVE/,
  /--preset agentforce-stdm/i,
  /--category core/i,
  /\bd360_metadata\b/i,
  /\bd360_probe\b/i,
  /`d360`/i,
] as const;

type Manifest = {
  id: string;
  name: string;
  description: string;
  tools?: string[];
  docs: {
    intentGroup: string;
    summary: string;
    primaryFiles: string[];
    editingRules?: string;
    agentGuide?: string;
    contextGlossary?: string;
    referenceRoots?: Array<{
      path: string;
      index: string;
      role: "current" | "generated-current" | "compatibility";
      generatedBy?: string;
    }>;
  };
};

function readManifests(): Manifest[] {
  return readdirSync(EXTENSIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      JSON.parse(readFileSync(path.join(EXTENSIONS_DIR, entry.name, "manifest.json"), "utf8")),
    );
}

function currentCopySurfaces(): string[] {
  const surfaces = new Set([
    "README.md",
    "AGENTS.md",
    "ARCHITECTURE.md",
    "CONTRIBUTING.md",
    "GOVERNANCE.md",
    "SECURITY.md",
    "ROADMAP.md",
    "CONTEXT.md",
    "catalog/index.json",
    "lib/common/README.md",
    "scripts/e2e/README.md",
    "scripts/scaffold.mjs",
  ]);

  const docsRoot = path.join(ROOT, "docs");
  const walkDocs = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "adr") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walkDocs(absolute);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        surfaces.add(path.relative(ROOT, absolute).replaceAll(path.sep, "/"));
      }
    }
  };
  walkDocs(docsRoot);

  for (const manifest of readManifests()) {
    const base = `extensions/${manifest.id}`;
    surfaces.add(`${base}/manifest.json`);
    surfaces.add(`${base}/README.md`);
    for (const role of ["editingRules", "agentGuide", "contextGlossary"] as const) {
      const relativePath = manifest.docs[role];
      if (relativePath) surfaces.add(`${base}/${relativePath}`);
    }

    const roots = [...(manifest.docs.referenceRoots ?? [])].sort(
      (left, right) => right.path.length - left.path.length,
    );
    const referenceFiles = new Set<string>();
    for (const root of roots) {
      const absoluteRoot = path.join(EXTENSIONS_DIR, manifest.id, root.path);
      if (!existsSync(absoluteRoot)) continue;
      const walk = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory()) walk(absolute);
          else if (entry.isFile() && entry.name.endsWith(".md")) {
            referenceFiles.add(
              path
                .relative(path.join(EXTENSIONS_DIR, manifest.id), absolute)
                .replaceAll(path.sep, "/"),
            );
          }
        }
      };
      walk(absoluteRoot);
    }
    for (const referenceFile of referenceFiles) {
      const owner = roots.find(
        (root) => referenceFile === root.path || referenceFile.startsWith(`${root.path}/`),
      );
      if (owner?.role !== "compatibility") surfaces.add(`${base}/${referenceFile}`);
    }
  }

  return [...surfaces].sort((left, right) => left.localeCompare(right));
}

describe("generated extension documentation contract", () => {
  it("contains exactly one browse card for every catalog extension", () => {
    const expectedIds = (JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as Manifest[])
      .map((manifest) => manifest.id)
      .sort();
    const extensionsDoc = readFileSync(EXTENSIONS_DOC_PATH, "utf8");
    const cardIds = [
      ...extensionsDoc.matchAll(/<a class="sfpi-extension-card" href="\.\/extensions\/([^"/]+)">/g),
    ]
      .map((match) => match[1])
      .sort();
    const detailPageIds = readdirSync(EXTENSION_DETAIL_DIR)
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3))
      .sort();
    const sidebar = readFileSync(EXTENSION_SIDEBAR_PATH, "utf8");
    const sidebarIds = [...sidebar.matchAll(/link: "\/extensions\/([^"/]+)"/g)]
      .map((match) => match[1])
      .sort();

    expect(cardIds).toEqual(expectedIds);
    expect(new Set(cardIds).size).toBe(cardIds.length);
    expect(detailPageIds).toEqual(expectedIds);
    expect(sidebarIds).toEqual(expectedIds);
  });

  it("uses a known manifest-owned intent group for every extension", () => {
    for (const manifest of readManifests()) {
      expect(
        VALID_INTENT_GROUPS.has(manifest.docs.intentGroup),
        `${manifest.id}.docs.intentGroup`,
      ).toBe(true);
    }
  });

  it("does not maintain a separate extension copy registry", () => {
    expect(existsSync(EXTENSION_COPY_PATH)).toBe(false);
  });

  it("generates extension detail copy from manifest facts", () => {
    for (const manifest of readManifests()) {
      const detail = readFileSync(path.join(EXTENSION_DETAIL_DIR, `${manifest.id}.md`), "utf8");
      expect(detail, `${manifest.id}: description`).toContain(manifest.description);
      const renderedSummary = manifest.docs.summary.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      expect(detail, `${manifest.id}: summary`).toContain(renderedSummary);
      expect(detail).not.toContain("## Why you'll use it");
      expect(detail).not.toContain("## Common use cases");
      expect(detail).not.toContain("## What you get");
    }
  });

  it("routes package-state inspection through the supported Manager deep link", () => {
    for (const manifest of readManifests().filter(
      (candidate) => candidate.id !== "sf-pi-manager",
    )) {
      const detail = readFileSync(path.join(EXTENSION_DETAIL_DIR, `${manifest.id}.md`), "utf8");
      const command = `open ${manifest.id}`;
      expect(detail, `${manifest.id}: Manager deep link`).toContain(`/sf-pi ${command}`);
      expect(detail, `${manifest.id}: unsupported scoped status`).not.toContain(
        `/sf-pi status ${manifest.id}`,
      );
      expect(parseCommandArgs(command).route).toEqual({
        extensionId: manifest.id,
        view: "detail",
      });
    }
  });

  it("disables direct edit links on generated site pages", () => {
    const generatedPages = [
      EXTENSIONS_DOC_PATH,
      path.join(ROOT, "docs", "commands.md"),
      path.join(ROOT, "docs", "agent-orientation.md"),
      ...readdirSync(EXTENSION_DETAIL_DIR)
        .filter((file) => file.endsWith(".md"))
        .map((file) => path.join(EXTENSION_DETAIL_DIR, file)),
    ];

    for (const generatedPage of generatedPages) {
      expect(readFileSync(generatedPage, "utf8"), path.relative(ROOT, generatedPage)).toMatch(
        /^---\n[\s\S]*?^editLink: false$/m,
      );
    }
  });

  it("keeps primaryFiles as a bounded read-first route", () => {
    for (const manifest of readManifests()) {
      const extensionRoot = path.join(EXTENSIONS_DIR, manifest.id);
      const resolvedPaths = new Set<string>();
      const primaryFiles = manifest.docs?.primaryFiles;
      expect(Array.isArray(primaryFiles), `${manifest.id}: docs.primaryFiles`).toBe(true);
      expect(primaryFiles?.length ?? 0, `${manifest.id}: docs.primaryFiles`).toBeGreaterThan(0);
      expect(primaryFiles?.length ?? 0, `${manifest.id}: docs.primaryFiles`).toBeLessThanOrEqual(8);
      expect(primaryFiles?.[0], `${manifest.id}: first entrypoint`).toBe("index.ts");
      expect(
        primaryFiles?.every((primaryFile) => !primaryFile.endsWith(".md")),
        `${manifest.id}: role/reference docs stay outside primaryFiles`,
      ).toBe(true);

      for (const primaryFile of primaryFiles ?? []) {
        expect(path.isAbsolute(primaryFile), `${manifest.id}: ${primaryFile}`).toBe(false);
        const resolved = path.resolve(extensionRoot, primaryFile);
        const relativeToRoot = path.relative(ROOT, resolved);
        expect(
          relativeToRoot !== "" &&
            !relativeToRoot.startsWith(`..${path.sep}`) &&
            relativeToRoot !== "..",
          `${manifest.id}: ${primaryFile}`,
        ).toBe(true);
        expect(existsSync(resolved), `${manifest.id}: ${primaryFile}`).toBe(true);
        expect(resolvedPaths.has(resolved), `${manifest.id}: duplicate ${primaryFile}`).toBe(false);
        resolvedPaths.add(resolved);
      }
    }
  });

  it("declares every extension reference directory through a routed root", () => {
    for (const manifest of readManifests()) {
      const extensionRoot = path.join(EXTENSIONS_DIR, manifest.id);
      const referenceFiles: string[] = [];
      for (const directory of ["docs", "references"]) {
        const root = path.join(extensionRoot, directory);
        if (!existsSync(root)) continue;
        const walk = (current: string): void => {
          for (const entry of readdirSync(current, { withFileTypes: true })) {
            const absolute = path.join(current, entry.name);
            if (entry.isDirectory()) walk(absolute);
            else if (entry.isFile() && entry.name.endsWith(".md")) {
              referenceFiles.push(path.relative(extensionRoot, absolute).replaceAll(path.sep, "/"));
            }
          }
        };
        walk(root);
      }

      const roots = manifest.docs.referenceRoots ?? [];
      for (const referenceFile of referenceFiles) {
        expect(
          roots.some(
            (root) => referenceFile === root.path || referenceFile.startsWith(`${root.path}/`),
          ),
          `${manifest.id}: undeclared reference ${referenceFile}`,
        ).toBe(true);
      }
      const detail = readFileSync(path.join(EXTENSION_DETAIL_DIR, `${manifest.id}.md`), "utf8");
      for (const root of roots) {
        expect(
          existsSync(path.join(extensionRoot, root.index)),
          `${manifest.id}: ${root.index}`,
        ).toBe(true);
        expect(detail, `${manifest.id}: routed reference index ${root.index}`).toContain(
          `/extensions/${manifest.id}/${root.index}`,
        );

        const indexSource = readFileSync(path.join(extensionRoot, root.index), "utf8");
        if (root.role === "generated-current") {
          expect(indexSource, `${manifest.id}: generated root ${root.path}`).toContain(
            `${path.basename(root.path)}/`,
          );
          continue;
        }
        const directReferences = readdirSync(path.join(extensionRoot, root.path), {
          withFileTypes: true,
        })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) => path.posix.join(root.path, entry.name))
          .filter((relativePath) => relativePath !== root.index);
        for (const directReference of directReferences) {
          const relativeLink = path
            .relative(path.dirname(root.index), directReference)
            .replaceAll(path.sep, "/");
          expect(indexSource, `${manifest.id}: orphan reference ${directReference}`).toContain(
            relativeLink,
          );
        }
      }
    }
  });

  it("declares every extension-local agent document by its role", () => {
    const roles = [
      ["editingRules", "AGENTS.md"],
      ["agentGuide", "AGENT_GUIDE.md"],
      ["contextGlossary", "CONTEXT.md"],
    ] as const;

    for (const manifest of readManifests()) {
      const extensionRoot = path.join(EXTENSIONS_DIR, manifest.id);
      for (const [field, relativePath] of roles) {
        const present = existsSync(path.join(extensionRoot, relativePath));
        expect(manifest.docs?.[field], `${manifest.id}: docs.${field}`).toBe(
          present ? relativePath : undefined,
        );
      }
      if ((manifest.tools?.length ?? 0) > 0) {
        expect(manifest.docs?.agentGuide, `${manifest.id}: tool operating guide`).toBe(
          "AGENT_GUIDE.md",
        );
      }
    }
  });

  it("rejects retired descriptions on current user and operator surfaces", () => {
    for (const relativePath of currentCopySurfaces()) {
      const source = readFileSync(path.join(ROOT, relativePath), "utf8");
      for (const retiredPhrase of RETIRED_CURRENT_COPY) {
        expect(retiredPhrase.test(source), `${relativePath}: ${retiredPhrase}`).toBe(false);
      }
    }
  });
});
