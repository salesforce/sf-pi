/* SPDX-License-Identifier: Apache-2.0 */
// Generate catalog/registry.ts, catalog/index.json, docs inventory pages, the
// ADR lifecycle index, and contributor-facing structural inventories from
// validated sources.
//
// Run:
//   node scripts/generate-catalog.mjs
//   npm run generate-catalog
//
// Check only (no writes, non-zero exit on drift):
//   node scripts/generate-catalog.mjs --check
//   npm run generate-catalog:check
//
// Extension manifests own catalog facts; package scripts, the E2E harness
// manifest, and source trees own their corresponding structural inventories.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { loadAdrRecords, renderAdrIndex } from "./lib/adr-lifecycle.mjs";
import {
  COMMON_MODULES_END_MARKER,
  COMMON_MODULES_START_MARKER,
  CONTRIBUTOR_SCRIPTS_END_MARKER,
  CONTRIBUTOR_SCRIPTS_START_MARKER,
  E2E_HARNESSES_END_MARKER,
  E2E_HARNESSES_START_MARKER,
  loadDocumentationInventories,
  renderCommonModuleInventory,
  renderContributorScriptInventory,
  renderE2EHarnessInventory,
} from "./lib/documentation-inventories.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_ROOT = path.resolve(__dirname, "..");
// Production always resolves from this script. Tests may isolate the real CLI
// against a temporary minimal repository without changing normal cwd semantics.
const ROOT =
  process.env.NODE_ENV === "test" && process.env.SF_PI_GENERATE_CATALOG_ROOT
    ? path.resolve(process.env.SF_PI_GENERATE_CATALOG_ROOT)
    : SCRIPT_ROOT;
const EXTENSIONS_DIR = path.join(ROOT, "extensions");
const CATALOG_DIR = path.join(ROOT, "catalog");
const DOCS_DIR = path.join(ROOT, "docs");
const ARCHITECTURE_PATH = path.join(ROOT, "ARCHITECTURE.md");
const CONTRIBUTING_PATH = path.join(ROOT, "CONTRIBUTING.md");
const COMMON_README_PATH = path.join(ROOT, "lib", "common", "README.md");
const E2E_README_PATH = path.join(ROOT, "scripts", "e2e", "README.md");
const COMMANDS_DOC_PATH = path.join(DOCS_DIR, "commands.md");
const EXTENSIONS_DOC_PATH = path.join(DOCS_DIR, "extensions.md");
const TROUBLESHOOTING_DOC_PATH = path.join(DOCS_DIR, "troubleshooting.md");
const EXTENSION_DOCS_DIR = path.join(DOCS_DIR, "extensions");
const EXTENSION_SIDEBAR_PATH = path.join(DOCS_DIR, ".vitepress", "generated-extension-sidebar.ts");
const AGENT_ORIENTATION_DOC_PATH = path.join(DOCS_DIR, "agent-orientation.md");
const ADR_DIR = path.join(DOCS_DIR, "adr");
const ADR_INDEX_PATH = path.join(ADR_DIR, "README.md");
const CHECK_ONLY = process.argv.includes("--check");
const GITHUB_REPO_URL = "https://github.com/salesforce/sf-pi";

// Keep in sync with AnnouncementKind / AnnouncementSeverity in catalog/types.ts.
const ANNOUNCEMENT_KINDS = new Set(["note", "update", "breaking", "deprecation"]);
const ANNOUNCEMENT_SEVERITIES = new Set(["info", "warn", "critical"]);

// Keep in sync with ALLOWED_RECOMMENDED_LICENSES in catalog/types.ts.
const ALLOWED_RECOMMENDED_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
]);

const ARCH_FOLDER_START_MARKER = "<!-- GENERATED:folder-layout:start -->";
const ARCH_FOLDER_END_MARKER = "<!-- GENERATED:folder-layout:end -->";
const TROUBLESHOOTING_INDEX_START_MARKER =
  "<!-- GENERATED:extension-troubleshooting-index:start -->";
const TROUBLESHOOTING_INDEX_END_MARKER = "<!-- GENERATED:extension-troubleshooting-index:end -->";
const EXT_FILE_STRUCTURE_START_MARKER = "<!-- GENERATED:file-structure:start -->";
const EXT_FILE_STRUCTURE_END_MARKER = "<!-- GENERATED:file-structure:end -->";
const README_CATEGORY_ORDER = ["manager", "provider", "agent-tool", "safety", "assistive", "ui"];
const VALID_CATEGORIES = new Set(README_CATEGORY_ORDER);
const VALID_MATURITIES = new Set(["stable", "beta", "experimental"]);
const VALID_REFERENCE_ROLES = new Set(["current", "generated-current", "compatibility"]);
const MAX_PRIMARY_FILES = 8;
const EXTENSION_INTENT_ORDER = [
  "Build agents",
  "Build apps",
  "Query data",
  "Work with Salesforce orgs",
  "Work with Data Cloud",
  "Work safely",
  "Collaborate and improve",
  "Personalize pi",
];
const VALID_EXTENSION_INTENTS = new Set(EXTENSION_INTENT_ORDER);
// Extensions whose only doc surface is the manifest description — they have
// no slash command, no LLM tool, and no provider, so populating docs.* would
// be busywork. The lint below only requires docs.summary + docs.primaryFiles
// for everything outside this set.
const DOCS_OPTIONAL_FOR = new Set([]);
const EXTENSION_FILE_MAP_INCLUDE = new Set([
  "AGENT_GUIDE.md",
  "AGENTS.md",
  "CREDITS.md",
  "ROADMAP.md",
  "SF_GUARDRAIL_DEFAULTS.json",
  "SF_CONSTITUTION.md",
  "SF_GUARDRAIL_PROMPT.md",
  "index.ts",
  "manifest.json",
  "README.md",
]);

let hasDiff = false;

// -------------------------------------------------------------------------------------------------
// Discover manifests
// -------------------------------------------------------------------------------------------------

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function discoverManifests() {
  const entries = readdirSync(EXTENSIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  if (entries.length === 0) {
    fail("No extension directories found under extensions/");
  }

  const results = [];

  for (const entry of entries) {
    const relativeManifestPath = `extensions/${entry.name}/manifest.json`;
    const manifestPath = path.join(EXTENSIONS_DIR, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) {
      fail(`${relativeManifestPath} is missing`);
    }

    const relativeIndexPath = `extensions/${entry.name}/index.ts`;
    const indexPath = path.join(EXTENSIONS_DIR, entry.name, "index.ts");
    if (!existsSync(indexPath)) {
      fail(`${relativeIndexPath} is missing`);
    }

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      fail(`${relativeManifestPath} is not valid JSON: ${error.message}`);
    }

    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      fail(`${relativeManifestPath} must contain a JSON object`);
    }

    for (const field of ["id", "name", "description", "category"]) {
      if (typeof manifest[field] !== "string" || manifest[field].length === 0) {
        fail(`${relativeManifestPath} required field ${field} must be a non-empty string`);
      }
    }
    if (typeof manifest.defaultEnabled !== "boolean") {
      fail(`${relativeManifestPath} required field defaultEnabled must be a boolean`);
    }

    if (!VALID_CATEGORIES.has(manifest.category)) {
      fail(
        `${relativeManifestPath} has invalid category "${manifest.category}". Allowed: ${[...VALID_CATEGORIES].join(", ")}`,
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(manifest, "maturity") &&
      !VALID_MATURITIES.has(manifest.maturity)
    ) {
      fail(
        `${relativeManifestPath} has invalid maturity "${manifest.maturity}". Allowed: ${[...VALID_MATURITIES].join(", ")}`,
      );
    }

    // Mandate docs.summary + docs.primaryFiles so generated agent-orientation
    // and the manager UI never fall back to the terse description. Optional
    // for the few extensions opted into DOCS_OPTIONAL_FOR.
    if (!DOCS_OPTIONAL_FOR.has(manifest.id)) {
      const docs = manifest.docs;
      if (
        !docs ||
        typeof docs.summary !== "string" ||
        docs.summary.length === 0 ||
        !Array.isArray(docs.primaryFiles) ||
        docs.primaryFiles.length === 0
      ) {
        fail(
          `${relativeManifestPath} must populate docs.summary (non-empty string) and docs.primaryFiles (non-empty string[]). See docs/adr/0006-extension-consistency-baseline.md.`,
        );
      }
      if (!VALID_EXTENSION_INTENTS.has(docs.intentGroup)) {
        fail(
          `${relativeManifestPath} docs.intentGroup "${docs.intentGroup}" is invalid. Allowed: ${EXTENSION_INTENT_ORDER.join(", ")}`,
        );
      }
      validatePrimaryFiles(entry.name, docs.primaryFiles);
      validateManifestDocRoles(entry.name, manifest);
      validateManifestReferenceRoots(entry.name, docs.referenceRoots);
    }

    results.push({ dir: entry.name, manifest });
  }

  // Identity validation is deliberately global: duplicate ids always win
  // over directory/id mismatches, regardless of directory sort order.
  const idDirectories = new Map();
  for (const { dir, manifest } of results) {
    const firstDirectory = idDirectories.get(manifest.id);
    if (firstDirectory) {
      fail(
        `duplicate manifest id "${manifest.id}" in extensions/${firstDirectory}/manifest.json and extensions/${dir}/manifest.json`,
      );
    }
    idDirectories.set(manifest.id, dir);
  }

  for (const { dir, manifest } of results) {
    if (manifest.id !== dir) {
      fail(
        `extensions/${dir}/manifest.json manifest id "${manifest.id}" does not match directory "${dir}"`,
      );
    }
  }

  return results;
}

function validatePackageExtensions(manifests) {
  const packagePath = path.join(ROOT, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch (error) {
    fail(`package.json is not valid JSON: ${error.message}`);
  }

  const packageExtensions = pkg?.pi?.extensions;
  if (!Array.isArray(packageExtensions)) {
    fail("package.json pi.extensions must be an array");
  }

  const seen = new Set();
  for (const entry of packageExtensions) {
    if (typeof entry !== "string" || !/^\.\/extensions\/[^/]+\/index\.ts$/.test(entry)) {
      fail(`noncanonical pi.extensions entry: ${String(entry)}`);
    }
    if (seen.has(entry)) {
      fail(`duplicate pi.extensions entry: ${entry}`);
    }
    seen.add(entry);
  }

  const discovered = new Set(manifests.map(({ dir }) => `./extensions/${dir}/index.ts`));
  const missing = [...discovered].filter((entry) => !seen.has(entry)).sort();
  const packageOnly = [...seen].filter((entry) => !discovered.has(entry)).sort();
  if (missing.length > 0 || packageOnly.length > 0) {
    const details = [];
    if (missing.length > 0) details.push(`missing discovered entries: ${missing.join(", ")}`);
    if (packageOnly.length > 0) details.push(`package-only entries: ${packageOnly.join(", ")}`);
    fail(`package.json pi.extensions does not match discovered extensions; ${details.join("; ")}`);
  }
}

function validateManifestDocRoles(extensionDir, manifest) {
  const extensionRoot = path.join(EXTENSIONS_DIR, extensionDir);
  const docs = manifest.docs ?? {};
  const roles = [
    ["editingRules", "AGENTS.md"],
    ["agentGuide", "AGENT_GUIDE.md"],
    ["contextGlossary", "CONTEXT.md"],
  ];

  for (const [field, expectedPath] of roles) {
    const fileExists = existsSync(path.join(extensionRoot, expectedPath));
    const declaredPath = docs[field];
    if (fileExists && declaredPath !== expectedPath) {
      fail(
        `extensions/${extensionDir}/manifest.json docs.${field} must be "${expectedPath}" because that file exists`,
      );
    }
    if (!fileExists && declaredPath !== undefined) {
      fail(
        `extensions/${extensionDir}/manifest.json docs.${field} declares missing file "${String(declaredPath)}"`,
      );
    }
  }

  if (Array.isArray(manifest.tools) && manifest.tools.length > 0 && !docs.agentGuide) {
    fail(
      `extensions/${extensionDir}/manifest.json must declare docs.agentGuide for its LLM tool workflow`,
    );
  }
}

function validatePrimaryFiles(extensionDir, primaryFiles) {
  const extensionRoot = path.join(EXTENSIONS_DIR, extensionDir);
  const resolvedPaths = new Set();

  if (primaryFiles.length > MAX_PRIMARY_FILES) {
    fail(
      `extensions/${extensionDir}/manifest.json docs.primaryFiles must contain at most ${MAX_PRIMARY_FILES} entries`,
    );
  }
  for (const primaryFile of primaryFiles) {
    if (typeof primaryFile !== "string" || primaryFile.length === 0) {
      console.error(
        `❌ ${extensionDir}/manifest.json docs.primaryFiles must contain only non-empty strings.`,
      );
      process.exit(1);
    }
    if (path.isAbsolute(primaryFile)) {
      console.error(
        `❌ ${extensionDir}/manifest.json docs.primaryFiles entry "${primaryFile}" must be extension-relative.`,
      );
      process.exit(1);
    }

    const resolved = path.resolve(extensionRoot, primaryFile);
    const relativeToRoot = path.relative(ROOT, resolved);
    if (
      relativeToRoot === "" ||
      relativeToRoot === ".." ||
      relativeToRoot.startsWith(`..${path.sep}`)
    ) {
      console.error(
        `❌ ${extensionDir}/manifest.json docs.primaryFiles entry "${primaryFile}" escapes the repository root.`,
      );
      process.exit(1);
    }
    if (!existsSync(resolved)) {
      console.error(
        `❌ ${extensionDir}/manifest.json docs.primaryFiles entry "${primaryFile}" does not exist.`,
      );
      process.exit(1);
    }
    if (resolvedPaths.has(resolved)) {
      console.error(
        `❌ ${extensionDir}/manifest.json docs.primaryFiles contains duplicate path "${primaryFile}".`,
      );
      process.exit(1);
    }
    resolvedPaths.add(resolved);
  }

  if (primaryFiles[0] !== "index.ts") {
    fail(`extensions/${extensionDir}/manifest.json docs.primaryFiles must start with index.ts`);
  }
  if (primaryFiles.some((primaryFile) => primaryFile.endsWith(".md"))) {
    fail(
      `extensions/${extensionDir}/manifest.json docs.primaryFiles must contain implementation entrypoints, not Markdown role/reference files`,
    );
  }
}

function validateManifestReferenceRoots(extensionDir, referenceRoots) {
  const extensionRoot = path.join(EXTENSIONS_DIR, extensionDir);
  const roots = referenceRoots ?? [];
  if (!Array.isArray(roots)) {
    fail(`extensions/${extensionDir}/manifest.json docs.referenceRoots must be an array`);
  }

  const normalizedRoots = [];
  const seenRoots = new Set();
  for (const root of roots) {
    if (!root || typeof root !== "object" || Array.isArray(root)) {
      fail(`extensions/${extensionDir}/manifest.json docs.referenceRoots entries must be objects`);
    }
    for (const field of ["path", "index", "role"]) {
      if (typeof root[field] !== "string" || root[field].length === 0) {
        fail(
          `extensions/${extensionDir}/manifest.json docs.referenceRoots ${field} must be a non-empty string`,
        );
      }
    }
    if (!VALID_REFERENCE_ROLES.has(root.role)) {
      fail(
        `extensions/${extensionDir}/manifest.json docs.referenceRoots role "${root.role}" is invalid`,
      );
    }
    if (root.role === "generated-current" && !root.generatedBy) {
      fail(
        `extensions/${extensionDir}/manifest.json generated-current reference root must declare generatedBy`,
      );
    }

    const resolvedRoot = resolveContainedPath(extensionRoot, root.path, `${root.path}`);
    if (!existsSync(resolvedRoot) || !statSync(resolvedRoot).isDirectory()) {
      fail(
        `extensions/${extensionDir}/manifest.json docs.referenceRoots path "${root.path}" must resolve to a directory`,
      );
    }
    const normalizedRoot = path.relative(extensionRoot, resolvedRoot).replaceAll(path.sep, "/");
    if (seenRoots.has(normalizedRoot)) {
      fail(
        `extensions/${extensionDir}/manifest.json docs.referenceRoots contains duplicate path "${root.path}"`,
      );
    }
    seenRoots.add(normalizedRoot);

    const resolvedIndex = resolveContainedPath(extensionRoot, root.index, `${root.index}`);
    if (!existsSync(resolvedIndex) || !statSync(resolvedIndex).isFile()) {
      fail(
        `extensions/${extensionDir}/manifest.json docs.referenceRoots index "${root.index}" does not exist`,
      );
    }
    if (!root.index.endsWith(".md")) {
      fail(
        `extensions/${extensionDir}/manifest.json docs.referenceRoots index "${root.index}" must be Markdown`,
      );
    }
    const indexSource = readFileSync(resolvedIndex, "utf8");
    if (root.role === "generated-current") {
      if (!indexSource.includes(`${path.basename(normalizedRoot)}/`)) {
        fail(
          `extensions/${extensionDir}/${root.index} must link generated reference root ${root.path}/`,
        );
      }
    } else {
      for (const entry of readdirSync(resolvedRoot, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const reference = path.join(resolvedRoot, entry.name);
        if (reference === resolvedIndex) continue;
        const relativeLink = path
          .relative(path.dirname(resolvedIndex), reference)
          .replaceAll(path.sep, "/");
        if (!indexSource.includes(relativeLink)) {
          fail(
            `extensions/${extensionDir}/${root.index} must link direct reference ${relativeLink}`,
          );
        }
      }
    }

    if (root.generatedBy !== undefined) {
      if (typeof root.generatedBy !== "string" || root.generatedBy.length === 0) {
        fail(
          `extensions/${extensionDir}/manifest.json docs.referenceRoots generatedBy must be a non-empty repository-relative path`,
        );
      }
      const generator = path.resolve(ROOT, root.generatedBy);
      const relativeGenerator = path.relative(ROOT, generator);
      if (
        relativeGenerator === "" ||
        relativeGenerator === ".." ||
        relativeGenerator.startsWith(`..${path.sep}`) ||
        !existsSync(generator) ||
        !statSync(generator).isFile()
      ) {
        fail(
          `extensions/${extensionDir}/manifest.json docs.referenceRoots generatedBy "${root.generatedBy}" does not resolve to a repository file`,
        );
      }
    }

    normalizedRoots.push(normalizedRoot);
  }

  for (const referenceFile of extensionReferenceMarkdown(extensionRoot)) {
    if (
      !normalizedRoots.some(
        (root) => referenceFile === root || referenceFile.startsWith(`${root}/`),
      )
    ) {
      fail(`extensions/${extensionDir}/${referenceFile} is not covered by docs.referenceRoots`);
    }
  }
}

function resolveContainedPath(extensionRoot, relativePath, label) {
  if (path.isAbsolute(relativePath)) {
    fail(`docs.referenceRoots path "${label}" must be extension-relative`);
  }
  const resolved = path.resolve(extensionRoot, relativePath);
  const relative = path.relative(extensionRoot, resolved);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail(`docs.referenceRoots path "${label}" escapes its extension directory`);
  }
  return resolved;
}

function extensionReferenceMarkdown(extensionRoot) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.relative(extensionRoot, absolute).replaceAll(path.sep, "/"));
      }
    }
  };
  for (const directoryName of ["docs", "references"]) {
    const directory = path.join(extensionRoot, directoryName);
    if (existsSync(directory)) walk(directory);
  }
  return files.sort();
}

// -------------------------------------------------------------------------------------------------
// Generated outputs
// -------------------------------------------------------------------------------------------------

function pushOptionalStringArray(lines, manifest, field) {
  if (Array.isArray(manifest[field]) && manifest[field].length > 0) {
    lines.push(`    ${field}: ${JSON.stringify(manifest[field])},`);
  }
}

function generateRegistryTs(manifests) {
  const lines = [
    "// AUTO-GENERATED — do not edit manually.",
    "// Source of truth: extensions/<id>/manifest.json",
    "// Regenerate: npm run generate-catalog",
    "",
    "// Re-export shared types so existing imports from catalog/registry.ts keep working.",
    'export type { ConfigPanelResult, ConfigPanelFactory, SfPiExtension, ExtensionManifest } from "./types.ts";',
    'import type { SfPiExtension } from "./types.ts";',
    "",
    "export const SF_PI_REGISTRY: readonly SfPiExtension[] = [",
  ];

  for (const { dir, manifest } of manifests) {
    lines.push("  {");
    lines.push(`    id: ${JSON.stringify(manifest.id)},`);
    lines.push(`    name: ${JSON.stringify(manifest.name)},`);
    lines.push(`    description: ${JSON.stringify(manifest.description)},`);
    lines.push(`    file: "extensions/${dir}/index.ts",`);
    lines.push(`    category: ${JSON.stringify(manifest.category)},`);
    if (manifest.maturity) {
      lines.push(`    maturity: ${JSON.stringify(manifest.maturity)},`);
    }
    lines.push(`    defaultEnabled: ${manifest.defaultEnabled},`);
    pushOptionalStringArray(lines, manifest, "commands");
    pushOptionalStringArray(lines, manifest, "providers");
    pushOptionalStringArray(lines, manifest, "tools");
    pushOptionalStringArray(lines, manifest, "events");

    if (manifest.alwaysActive) {
      lines.push("    alwaysActive: true,");
    }

    if (manifest.configurable) {
      lines.push("    configurable: true,");
      lines.push("    getConfigPanel: async () => {");
      lines.push(`      const mod = await import("../extensions/${dir}/lib/config-panel.ts");`);
      lines.push("      return mod.createConfigPanel;");
      lines.push("    },");
    }

    lines.push("  },");
  }

  lines.push("];", "");
  return lines.join("\n");
}

function countSourceLoc(dir) {
  // Count non-empty LOC across src .ts files (excludes tests/ and vendor/).
  // Helps agents quickly gauge which extensions are tiny vs. heavy before diving in.
  const extDir = path.join(EXTENSIONS_DIR, dir);
  let total = 0;

  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "tests" || entry.name === "vendor" || entry.name === "node_modules") {
          continue;
        }
        walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const text = readFileSync(full, "utf8");
      total += text.split("\n").filter((line) => line.trim().length > 0).length;
    }
  };

  walk(extDir);
  return total;
}

function generateIndexJson(manifests) {
  return manifests.map(({ dir, manifest }) => ({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    category: manifest.category,
    maturity: manifest.maturity ?? "stable",
    defaultEnabled: manifest.defaultEnabled,
    alwaysActive: manifest.alwaysActive ?? false,
    configurable: manifest.configurable ?? false,
    commands: Array.isArray(manifest.commands) ? manifest.commands : [],
    providers: Array.isArray(manifest.providers) ? manifest.providers : [],
    tools: Array.isArray(manifest.tools) ? manifest.tools : [],
    events: Array.isArray(manifest.events) ? manifest.events : [],
    docs: manifest.docs && typeof manifest.docs === "object" ? manifest.docs : {},
    entry: `extensions/${dir}/index.ts`,
    hasReadme: existsSync(path.join(EXTENSIONS_DIR, dir, "README.md")),
    hasTests: existsSync(path.join(EXTENSIONS_DIR, dir, "tests")),
    srcLoc: countSourceLoc(dir),
  }));
}

function sortByCategoryThenName(manifests) {
  return [...manifests].sort((left, right) => {
    const categoryDelta =
      README_CATEGORY_ORDER.indexOf(left.manifest.category) -
      README_CATEGORY_ORDER.indexOf(right.manifest.category);
    if (categoryDelta !== 0) {
      return categoryDelta;
    }
    return left.manifest.name.localeCompare(right.manifest.name);
  });
}

function sortByIntentThenName(manifests) {
  return [...manifests].sort((left, right) => {
    const leftGroup = left.manifest.docs.intentGroup;
    const rightGroup = right.manifest.docs.intentGroup;
    const groupDelta =
      EXTENSION_INTENT_ORDER.indexOf(leftGroup) - EXTENSION_INTENT_ORDER.indexOf(rightGroup);
    if (groupDelta !== 0) return groupDelta;
    return left.manifest.name.localeCompare(right.manifest.name);
  });
}

function defaultLabel(manifest) {
  if (manifest.alwaysActive) return "always-on";
  return manifest.defaultEnabled ? "on" : "opt-in";
}

function sourceLink(relativePath) {
  return `${GITHUB_REPO_URL}/blob/main/${relativePath}`;
}

function sourceTreeLink(relativePath) {
  return `${GITHUB_REPO_URL}/tree/main/${relativePath}`;
}

function categoryHeading(category) {
  if (category === "ui") return "UI";
  return category
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function markdownText(value) {
  return String(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function generatedList(items) {
  if (!Array.isArray(items) || items.length === 0) return "_none_";
  return items.map((item) => `\`${markdownText(item)}\``).join(", ");
}

function sourceFileLink(dir, file) {
  return sourceLink(`extensions/${dir}/${file}`);
}

function extensionDocLink(dir) {
  return `./extensions/${dir}`;
}

function referenceIndexes(dir, manifest) {
  const byIndex = new Map();
  for (const root of manifest.docs?.referenceRoots ?? []) {
    const roles = byIndex.get(root.index) ?? new Set();
    roles.add(root.role);
    byIndex.set(root.index, roles);
  }
  return [...byIndex.entries()].map(([index, roles]) => ({
    link: sourceFileLink(dir, index),
    label:
      roles.size === 1 && roles.has("compatibility")
        ? "Compatibility evidence index"
        : roles.size === 1 && roles.has("generated-current")
          ? "Generated reference index"
          : "Reference index",
  }));
}

function extensionReadmeHasSection(dir, section) {
  const readmePath = path.join(EXTENSIONS_DIR, dir, "README.md");
  if (!existsSync(readmePath)) return false;
  const readme = readFileSync(readmePath, "utf8");
  return new RegExp(`^##\\s+${section}\\s*$`, "im").test(readme);
}

// -------------------------------------------------------------------------------------------------
// Command reference (docs/commands.md)
// -------------------------------------------------------------------------------------------------

function generateCommandsDoc(manifests) {
  const sorted = sortByCategoryThenName(manifests);

  const lines = [
    "---",
    "title: sf-pi Command Reference",
    "description: Generated top-level slash-command inventory for bundled SF Pi extensions.",
    "editLink: false",
    "---",
    "",
    "# sf-pi Command Reference",
    "",
    "> **Auto-generated from `extensions/*/manifest.json`.**",
    "> Edit the manifests and run `npm run generate-catalog` — do not edit this file by hand.",
    "",
    "This page lists every slash command exposed by bundled extensions. For",
    "subcommands, flags, and detailed behavior, see the linked extension README.",
    "",
    "See also:",
    "",
    "- [Bundled Extensions](./extensions.md) — generated user-facing extension inventory",
    `- [\`catalog/index.json\`](${sourceLink("catalog/index.json")}) — machine-readable catalog`,
    `- [\`README.md\`](${sourceLink("README.md")}) — install, quick start, bundled extensions`,
    `- [\`ARCHITECTURE.md\`](${sourceLink("ARCHITECTURE.md")}) — repo structure and conventions`,
    "",
  ];

  for (const category of README_CATEGORY_ORDER) {
    const inCategory = sorted.filter(({ manifest }) => manifest.category === category);
    if (inCategory.length === 0) continue;

    const heading = categoryHeading(category);
    lines.push(`## ${heading}`);
    lines.push("");

    for (const { dir, manifest } of inCategory) {
      const commands = Array.isArray(manifest.commands) ? manifest.commands : [];
      const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
      const providers = Array.isArray(manifest.providers) ? manifest.providers : [];

      lines.push(`### [${manifest.name}](${extensionDocLink(dir)})`);
      lines.push("");
      lines.push(`_${manifest.description}_`);
      lines.push("");
      lines.push(`- Default: **${defaultLabel(manifest)}**`);
      if (commands.length > 0) {
        lines.push(`- Commands: ${commands.map((c) => `\`${c}\``).join(", ")}`);
      } else {
        lines.push("- Commands: _none_");
      }
      if (tools.length > 0) {
        lines.push(`- Tools: ${tools.map((t) => `\`${t}\``).join(", ")}`);
      }
      if (providers.length > 0) {
        lines.push(`- Providers: ${providers.map((p) => `\`${p}\``).join(", ")}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function htmlText(value) {
  return markdownText(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function renderCodeChip(text) {
  return `<code class="sfpi-code-chip">${htmlText(text)}</code>`;
}

function generateExtensionsDoc(manifests) {
  const sorted = sortByIntentThenName(manifests);
  const renderedIds = [];
  const lines = [
    "---",
    "title: Browse SF Pi Extensions",
    "description: Pick the SF Pi extension that matches what you want to do next.",
    "editLink: false",
    "---",
    "",
    "# Browse SF Pi extensions",
    "",
    "Each extension owns one focused Salesforce workflow. Pick an outcome, then open its page for current behavior, the first command, safety notes, and source links.",
    "",
    `<div class="sfpi-callout"><strong>New here?</strong> Start with <a href="./quickstart.html">Quickstart</a>, then come back and choose the extension that matches your first task.</div>`,
    "",
  ];

  for (const group of EXTENSION_INTENT_ORDER) {
    const inGroup = sorted.filter(({ manifest }) => manifest.docs.intentGroup === group);
    if (inGroup.length === 0) continue;

    lines.push(`## ${group}`, "", '<div class="sfpi-card-grid">');
    for (const { dir, manifest } of inGroup) {
      renderedIds.push(manifest.id);
      const command =
        Array.isArray(manifest.commands) && manifest.commands.length > 0
          ? manifest.commands[0]
          : null;
      lines.push(
        `<a class="sfpi-extension-card" href="${extensionDocLink(dir)}">`,
        `  <span class="sfpi-card-kicker">${htmlText(categoryHeading(manifest.category))} · ${htmlText(defaultLabel(manifest))}</span>`,
        `  <strong>${htmlText(manifest.name)}</strong>`,
        `  <span>${htmlText(manifest.description)}</span>`,
        `  <span class="sfpi-card-meta">${command ? renderCodeChip(command) : "Works automatically"}</span>`,
        `</a>`,
      );
    }
    lines.push("</div>", "");
  }

  const expectedIds = manifests.map(({ manifest }) => manifest.id).sort();
  const actualIds = [...renderedIds].sort();
  if (
    actualIds.length !== expectedIds.length ||
    actualIds.some((id, index) => id !== expectedIds[index])
  ) {
    fail(
      `Generated extension browse cards must cover every discovered manifest exactly once. Expected ${expectedIds.length}, rendered ${actualIds.length}`,
    );
  }

  lines.push(
    "## Full reference",
    "",
    "The canonical machine-readable inventory is",
    `[\`catalog/index.json\`](${sourceLink("catalog/index.json")}).`,
  );

  return lines.join("\n");
}

function generateExtensionDetailDoc(dir, manifest) {
  const commands = Array.isArray(manifest.commands) ? manifest.commands : [];
  const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
  const providers = Array.isArray(manifest.providers) ? manifest.providers : [];
  const events = Array.isArray(manifest.events) ? manifest.events : [];
  const safety = Array.isArray(manifest.docs?.safety) ? manifest.docs.safety : [];

  const lines = [
    "---",
    `title: ${JSON.stringify(manifest.name)}`,
    `description: ${JSON.stringify(manifest.description)}`,
    "editLink: false",
    "---",
    "",
    `# ${manifest.name}`,
    "",
    `<p class="sfpi-page-lead">${htmlText(manifest.description)}</p>`,
    "",
    "## What it does",
    "",
    markdownText(manifest.docs.summary),
    "",
    "## Start",
    "",
  ];

  if (commands.length > 0) {
    lines.push(
      "Open the extension from its primary command:",
      "",
      "```text",
      commands[0],
      "```",
      "",
    );
  } else if (manifest.alwaysActive) {
    lines.push("This extension is always active and has no standalone command.", "");
  } else if (manifest.defaultEnabled) {
    lines.push("This extension is enabled by default and works automatically.", "");
  } else {
    lines.push(
      "Enable the extension from the SF Pi home base:",
      "",
      "```text",
      `/sf-pi enable ${manifest.id}`,
      "```",
      "",
    );
  }

  if (!manifest.alwaysActive) {
    lines.push(
      "Open its Manager detail or change its package state with:",
      "",
      "```text",
      `/sf-pi open ${manifest.id}`,
      `/sf-pi enable ${manifest.id}`,
      `/sf-pi disable ${manifest.id}`,
      "```",
      "",
    );
  }

  if (safety.length > 0) {
    lines.push("## Safety notes", "");
    for (const item of safety) lines.push(`- ${markdownText(item)}`);
    lines.push("");
  }

  lines.push(
    "## Exact reference",
    "",
    "<details>",
    "<summary>Show commands, tools, providers, and hooks</summary>",
    "",
    `- **Extension id:** \`${manifest.id}\``,
    `- **Intent:** ${manifest.docs.intentGroup}`,
    `- **Category:** ${categoryHeading(manifest.category)}`,
    `- **Maturity:** ${manifest.maturity ?? "stable"}`,
    `- **Default state:** ${defaultLabel(manifest)}`,
    `- **Commands:** ${generatedList(commands)}`,
    `- **LLM tools:** ${generatedList(tools)}`,
    `- **Providers:** ${generatedList(providers)}`,
    `- **Events/hooks:** ${generatedList(events)}`,
    "",
    "</details>",
    "",
    "## For contributors",
    "",
    `- [Full extension README](${sourceFileLink(dir, "README.md")})`,
    `- [Source folder](${sourceTreeLink(`extensions/${dir}`)})`,
    ...(manifest.docs?.editingRules
      ? [`- [Agent editing rules](${sourceFileLink(dir, manifest.docs.editingRules)})`]
      : []),
    ...(manifest.docs?.agentGuide
      ? [`- [Agent operating guide](${sourceFileLink(dir, manifest.docs.agentGuide)})`]
      : []),
    ...(manifest.docs?.contextGlossary
      ? [`- [Domain glossary](${sourceFileLink(dir, manifest.docs.contextGlossary)})`]
      : []),
    ...referenceIndexes(dir, manifest).map(
      (reference) => `- [${reference.label}](${reference.link})`,
    ),
  );

  if (extensionReadmeHasSection(dir, "Troubleshooting")) {
    lines.push(
      "",
      "## Troubleshooting",
      "",
      `See the [Troubleshooting section in the full README](${sourceFileLink(dir, "README.md")}#troubleshooting) for extension-specific recovery steps.`,
    );
  }

  return lines.join("\n");
}

function generateExtensionSidebar(manifests) {
  const sorted = sortByIntentThenName(manifests);
  const lines = [
    "// AUTO-GENERATED — do not edit manually.",
    "// Source of truth: extensions/<id>/manifest.json",
    "// Regenerate: npm run generate-catalog",
    "",
    "export const extensionSidebarItems = [",
  ];
  for (const { dir, manifest } of sorted) {
    lines.push(
      `  { text: ${JSON.stringify(manifest.name)}, link: ${JSON.stringify(`/extensions/${dir}`)} },`,
    );
  }
  lines.push("];", "");
  return lines.join("\n");
}

// -------------------------------------------------------------------------------------------------
// Troubleshooting index (docs/troubleshooting.md block)
//
// Each extension's README may include a `## Troubleshooting` section. When it
// does, the section is parsed for its bolded question entries (lines that
// start with `**...:**` or `**...?**`) and surfaced in the documentation site's
// troubleshooting page. This keeps the root README concise while preserving a
// drift-proof symptom index.
// -------------------------------------------------------------------------------------------------

function extractTroubleshootingEntries(readmePath) {
  if (!existsSync(readmePath)) return [];
  const text = readFileSync(readmePath, "utf8");
  const lines = text.split("\n");

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Troubleshooting\s*$/i.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return [];

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start, end);
  const entries = [];
  for (const raw of body) {
    const line = raw.trim();
    // Match `**Question or symptom:**` / `**...?**` anchor lines.
    const match = line.match(/^\*\*(.+?)[:?]\*\*/);
    if (match) {
      entries.push(match[1].trim());
    }
  }
  return entries;
}

function generateTroubleshootingIndex(manifests) {
  const sorted = sortByCategoryThenName(manifests);
  const lines = [
    TROUBLESHOOTING_INDEX_START_MARKER,
    "Jump to an extension's Troubleshooting section to see the full fix. This index is generated from the `## Troubleshooting` section in each extension README, so it never drifts.",
    "",
  ];

  let anyEntries = false;
  for (const { dir, manifest } of sorted) {
    const readmePath = path.join(EXTENSIONS_DIR, dir, "README.md");
    const entries = extractTroubleshootingEntries(readmePath);
    if (entries.length === 0) continue;

    anyEntries = true;
    lines.push(`**[${manifest.name}](./extensions/${dir}.md#troubleshooting)**`);
    lines.push("");
    for (const entry of entries) {
      lines.push(`- ${entry}`);
    }
    lines.push("");
  }

  if (!anyEntries) {
    lines.push(
      "_No extension currently ships a Troubleshooting section. Add one in `extensions/<id>/README.md` under `## Troubleshooting` and it will appear here automatically._",
    );
    lines.push("");
  }

  lines.push(TROUBLESHOOTING_INDEX_END_MARKER);
  return lines.join("\n");
}

// -------------------------------------------------------------------------------------------------
// ARCHITECTURE.md folder layout
// -------------------------------------------------------------------------------------------------

function generateFolderLayout(manifests) {
  const sorted = [...manifests].sort((left, right) => left.dir.localeCompare(right.dir));

  const lines = [
    ARCH_FOLDER_START_MARKER,
    "```",
    "sf-pi/",
    "\u251c\u2500\u2500 .github/",
    "\u2502   \u2514\u2500\u2500 workflows/              \u2190 CI, security scanners, release-please, sync, metrics", // see .github/workflows/ for the full list
    "\u251c\u2500\u2500 AGENTS.md                   \u2190 Repo rules for agents and contributors",
    "\u251c\u2500\u2500 ARCHITECTURE.md             \u2190 Repo structure and conventions (this file)",
    "\u251c\u2500\u2500 CONTRIBUTING.md             \u2190 Human-friendly contributor workflow",
    "\u251c\u2500\u2500 README.md                   \u2190 User-facing quick start",
    "\u251c\u2500\u2500 ROADMAP.md                  \u2190 What's next, milestones, non-goals",
    "\u251c\u2500\u2500 CHANGELOG.md                \u2190 Release history (managed by release-please)",
    "\u251c\u2500\u2500 extensions/                 \u2190 All extensions live here (self-contained)",
  ];

  for (const { dir } of sorted) {
    lines.push(`\u2502   \u251c\u2500\u2500 ${dir}/`);
  }

  lines.push(
    "\u251c\u2500\u2500 lib/",
    "\u2502   \u2514\u2500\u2500 common/                 \u2190 Shared helpers (see lib/common/README.md)",
    "\u251c\u2500\u2500 catalog/                    \u2190 Generated registry + hand-written types",
    "\u2502   \u251c\u2500\u2500 types.ts                \u2190 Hand-maintained type definitions",
    "\u2502   \u251c\u2500\u2500 registry.ts             \u2190 GENERATED from manifest.json files",
    "\u2502   \u2514\u2500\u2500 index.json              \u2190 GENERATED machine-readable index",
    "\u251c\u2500\u2500 docs/",
    "\u2502   \u251c\u2500\u2500 .vitepress/             \u2190 VitePress config/theme + generated sidebar for GitHub Pages docs",
    "\u2502   \u251c\u2500\u2500 extensions.md           \u2190 GENERATED bundled-extension site inventory",
    "\u2502   \u251c\u2500\u2500 extensions/              \u2190 GENERATED one page per bundled extension",
    "\u2502   \u251c\u2500\u2500 commands.md             \u2190 GENERATED per-extension command reference",
    "\u2502   \u251c\u2500\u2500 agent-orientation.md    \u2190 GENERATED agent navigation map",
    "\u2502   \u251c\u2500\u2500 contributing.md         \u2190 contributor site entry point",
    "\u2502   \u2514\u2500\u2500 adr/                    \u2190 ADR records + GENERATED lifecycle index",
    "\u251c\u2500\u2500 scripts/                    \u2190 catalog/docs/SPDX/validate helpers; see ARCHITECTURE.md",
    "\u251c\u2500\u2500 themes/                     \u2190 TUI themes (sf-dark.json, \u2026)",
    "\u251c\u2500\u2500 package.json",
    "\u251c\u2500\u2500 tsconfig.json",
    "\u2514\u2500\u2500 vitest.config.ts",
    "```",
    ARCH_FOLDER_END_MARKER,
  );

  return lines.join("\n");
}

// -------------------------------------------------------------------------------------------------
// Extension README file maps + agent orientation docs
// -------------------------------------------------------------------------------------------------

const EXTENSION_DIRECTORY_DESCRIPTIONS = {
  assets: "bundled assets and attribution",
  docs: "focused extension references",
  lib: "implementation modules",
  references: "progressive reference material",
  registry: "generated and curated registry data",
  tests: "Behavior Proofs and test fixtures",
};

function fileDescription(rel) {
  if (rel === "index.ts") return "Pi extension entry point";
  if (rel === "manifest.json") return "source-of-truth extension metadata";
  if (rel === "README.md") return "human behavior and usage";
  if (rel === "AGENTS.md") return "agent editing rules";
  if (rel === "AGENT_GUIDE.md") return "agent operating guide";
  if (rel === "CONTEXT.md") return "extension domain glossary";
  if (rel === "ROADMAP.md") return "unresolved extension work";
  if (rel === "CREDITS.md") return "extension attribution";
  if (rel === "SF_CONSTITUTION.md") return "bundled Salesforce Engineering Constitution";
  if (rel === "SF_GUARDRAIL_DEFAULTS.json") return "bundled Guardrail rule defaults";
  if (rel === "SF_GUARDRAIL_PROMPT.md") return "bundled Guardrail guidance";
  return "supporting contract file";
}

function generateExtensionFileStructure(dir) {
  const extDir = path.join(EXTENSIONS_DIR, dir);
  const entries = readdirSync(extDir, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const lines = [`extensions/${dir}/`];

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    if (entry.name === "node_modules" || entry.name === "vendor") continue;
    const description = EXTENSION_DIRECTORY_DESCRIPTIONS[entry.name] ?? "supporting files";
    lines.push(`  ${(entry.name + "/").padEnd(28)}← ${description}`);
  }
  for (const entry of entries.filter(
    (candidate) => candidate.isFile() && EXTENSION_FILE_MAP_INCLUDE.has(candidate.name),
  )) {
    lines.push(`  ${entry.name.padEnd(28)}← ${fileDescription(entry.name)}`);
  }

  return [
    EXT_FILE_STRUCTURE_START_MARKER,
    "```",
    lines.join("\n"),
    "```",
    EXT_FILE_STRUCTURE_END_MARKER,
  ].join("\n");
}

async function writeOrCheckExtensionReadmes(manifests) {
  for (const { dir } of manifests) {
    const readmePath = path.join(EXTENSIONS_DIR, dir, "README.md");
    if (!existsSync(readmePath)) continue;
    await replaceMarkedBlock(
      readmePath,
      `extensions/${dir}/README.md file structure`,
      EXT_FILE_STRUCTURE_START_MARKER,
      EXT_FILE_STRUCTURE_END_MARKER,
      generateExtensionFileStructure(dir),
    );
  }
}

function generateAgentOrientationDoc(manifests) {
  const sorted = sortByCategoryThenName(manifests);
  const lines = [
    "---",
    "title: sf-pi Agent Orientation",
    "description: Generated owner and role-specific document map for SF Pi agents and contributors.",
    "editLink: false",
    "---",
    "",
    "# sf-pi Agent Orientation",
    "",
    "> **Auto-generated from manifests and repo layout.**",
    "> Run `npm run generate-catalog` to refresh; do not edit by hand.",
    "",
    "## Start here",
    "",
    `1. [\`AGENTS.md\`](${sourceLink("AGENTS.md")}) — automatically loaded repository rules and authority order.`,
    `2. Query [\`catalog/index.json\`](${sourceLink("catalog/index.json")}) only when the owning extension is unknown.`,
    "3. Read `extensions/<id>/manifest.json` for declared surfaces and document roles.",
    "4. For code changes, read the declared `docs.editingRules`, then the relevant source and Behavior Proof.",
    "5. For tool operation, use the active schema first and read `docs.agentGuide` only when deeper ordering or recovery guidance is useful.",
    "6. Use the extension README for human explanation and a specific ADR/context glossary for rationale or terminology.",
    "",
    "## Extension map",
    "",
    "Use this table to locate the owner. Exact summaries, maturity, defaults, providers, tool names, events, safety notes, state paths, and environment variables remain in `catalog/index.json`.",
    "",
    "| Extension | Category | Commands | Tools | Editing rules | Operating guide | References | Entry point |",
    "| --------- | -------- | -------- | ----: | ------------- | --------------- | ---------- | ----------- |",
  ];

  for (const { dir, manifest } of sorted) {
    const editingRules = manifest.docs?.editingRules
      ? `[rules](${sourceFileLink(dir, manifest.docs.editingRules)})`
      : "_none_";
    const agentGuide = manifest.docs?.agentGuide
      ? `[guide](${sourceFileLink(dir, manifest.docs.agentGuide)})`
      : "_none_";
    const references = referenceIndexes(dir, manifest);
    const referenceLinks =
      references.length > 0
        ? references.map((reference) => `[index](${reference.link})`).join(", ")
        : "_none_";
    lines.push(
      `| [${manifest.name}](${sourceTreeLink(`extensions/${dir}`)}) | ${manifest.category} | ${generatedList(manifest.commands ?? [])} | ${(manifest.tools ?? []).length} | ${editingRules} | ${agentGuide} | ${referenceLinks} | \`extensions/${dir}/index.ts\` |`,
    );
  }

  lines.push(
    "",
    "## Manifest doc metadata",
    "",
    "Every extension manifest must provide non-empty `docs.summary` and `docs.primaryFiles` fields. Extension-local `AGENTS.md`, `AGENT_GUIDE.md`, and `CONTEXT.md` files are declared explicitly as `docs.editingRules`, `docs.agentGuide`, and `docs.contextGlossary`. Tool-owning extensions require an agent guide. `docs.referenceRoots` routes every Markdown file under extension `docs/` and `references/` as current, generated-current, or compatibility material. `docs.stateFiles`, `docs.env`, and `docs.safety` remain optional.",
    "",
    `Each \`docs.primaryFiles\` entry is extension-relative, resolves to an existing unique path, and the read-first set is capped at ${MAX_PRIMARY_FILES}. Reference-root indexes are also extension-relative; generated-current roots name their repository generator.`,
    "",
    "## Runtime surfaces",
    "",
    "| Surface | Owners |",
    "| ------- | ------ |",
  );

  const surfaceRows = [
    [
      "Slash commands",
      sorted
        .filter(({ manifest }) => manifest.commands?.length)
        .map(({ manifest }) => manifest.name),
    ],
    [
      "LLM tools",
      sorted.filter(({ manifest }) => manifest.tools?.length).map(({ manifest }) => manifest.name),
    ],
    [
      "Provider registration",
      sorted
        .filter(({ manifest }) => manifest.providers?.length)
        .map(({ manifest }) => manifest.name),
    ],
    [
      "Startup/session hooks",
      sorted
        .filter(({ manifest }) => manifest.events?.includes("session_start"))
        .map(({ manifest }) => manifest.name),
    ],
    [
      "Tool-call hooks",
      sorted
        .filter(({ manifest }) => manifest.events?.includes("tool_call"))
        .map(({ manifest }) => manifest.name),
    ],
    [
      "Generated docs/catalog",
      [
        "scripts/generate-catalog.mjs",
        "catalog/index.json",
        "catalog/registry.ts",
        "docs/extensions.md",
        "docs/extensions/*.md",
        "docs/.vitepress/generated-extension-sidebar.ts",
        "docs/commands.md",
      ],
    ],
  ];
  for (const [surface, owners] of surfaceRows) {
    lines.push(`| ${surface} | ${generatedList(owners)} |`);
  }

  lines.push(
    "",
    "## Generated files",
    "",
    "Do not edit these by hand; edit the source manifest/docs and run `npm run generate-catalog`.",
    "",
    "- `catalog/index.json`",
    "- `catalog/registry.ts`",
    "- `docs/extensions.md`",
    "- `docs/extensions/*.md`",
    "- `docs/.vitepress/generated-extension-sidebar.ts`",
    "- `docs/commands.md`",
    "- `docs/agent-orientation.md`",
    "- `docs/adr/README.md`",
    "- generated marker blocks in `ARCHITECTURE.md`, `CONTRIBUTING.md`, `lib/common/README.md`, `scripts/e2e/README.md`, and `docs/troubleshooting.md`",
    "- generated file-structure marker blocks in `extensions/*/README.md`",
    "- normalized `catalog/announcements.json` release entry",
    "",
    "## Automation shortcuts",
    "",
    "- `npm run docs:health:check` — documentation drift and tracked public-artifact lint.",
    "- `npm run check:architecture` — source-size advisories and shared state-placement policy.",
    "- `npm run check:manager-first` — real-factory no-args Manager routing proof.",
    "- `npm run test:runtime-surface` — real-factory manifest registration attestation.",
    "- `npm run validate:ci` — local approximation of CI's validation lane.",
  );

  return lines.join("\n");
}

async function writeOrCheckAgentOrientationDoc(manifests) {
  const raw = generateAgentOrientationDoc(manifests);
  const formatted = await prettier.format(raw, { parser: "markdown" });
  writeOrCheck(AGENT_ORIENTATION_DOC_PATH, formatted, "docs/agent-orientation.md");
}

async function writeOrCheckAdrIndex(records) {
  const raw = renderAdrIndex(records);
  const formatted = await prettier.format(raw, { parser: "markdown" });
  writeOrCheck(ADR_INDEX_PATH, formatted, `docs/adr/README.md — ${records.length} ADR(s)`);
}

// -------------------------------------------------------------------------------------------------
// Write/check helpers
// -------------------------------------------------------------------------------------------------

function readTextIfPresent(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function writeOrCheck(filePath, content, label) {
  const current = readTextIfPresent(filePath);

  if (CHECK_ONLY) {
    if (current !== content) {
      hasDiff = true;
      console.error(`❌ ${label} is out of date. Run: npm run generate-catalog`);
    } else {
      console.log(`✅ ${label} is up to date`);
    }
    return;
  }

  if (current !== content) {
    writeFileSync(filePath, content, "utf8");
  }
  console.log(`✅ ${label}`);
}

function readMarkedFile(filePath, startMarker, endMarker) {
  const current = readFileSync(filePath, "utf8");
  const startIndex = current.indexOf(startMarker);
  const endIndex = current.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    fail(`${path.relative(ROOT, filePath)} is missing markers: ${startMarker} / ${endMarker}`);
  }

  return { current, startIndex, endIndex };
}

function preflightRequiredMarkers(manifests) {
  readMarkedFile(ARCHITECTURE_PATH, ARCH_FOLDER_START_MARKER, ARCH_FOLDER_END_MARKER);
  readMarkedFile(
    CONTRIBUTING_PATH,
    CONTRIBUTOR_SCRIPTS_START_MARKER,
    CONTRIBUTOR_SCRIPTS_END_MARKER,
  );
  readMarkedFile(COMMON_README_PATH, COMMON_MODULES_START_MARKER, COMMON_MODULES_END_MARKER);
  readMarkedFile(E2E_README_PATH, E2E_HARNESSES_START_MARKER, E2E_HARNESSES_END_MARKER);
  readMarkedFile(
    TROUBLESHOOTING_DOC_PATH,
    TROUBLESHOOTING_INDEX_START_MARKER,
    TROUBLESHOOTING_INDEX_END_MARKER,
  );

  for (const { dir } of manifests) {
    const readmePath = path.join(EXTENSIONS_DIR, dir, "README.md");
    if (!existsSync(readmePath)) continue;
    readMarkedFile(readmePath, EXT_FILE_STRUCTURE_START_MARKER, EXT_FILE_STRUCTURE_END_MARKER);
  }
}

async function replaceMarkedBlock(filePath, label, startMarker, endMarker, rawBlock) {
  const { current, startIndex, endIndex } = readMarkedFile(filePath, startMarker, endMarker);
  const generatedBlock = (await prettier.format(rawBlock, { parser: "markdown" })).trim();

  const before = current.slice(0, startIndex).replace(/\s*$/, "");
  const after = current.slice(endIndex + endMarker.length).replace(/^\s*/, "");
  const next = after
    ? `${before}\n\n${generatedBlock}\n\n${after}`
    : `${before}\n\n${generatedBlock}\n`;

  writeOrCheck(filePath, next, label);
}

async function writeOrCheckGeneratedMarkdownBlocks(manifests, inventories) {
  await replaceMarkedBlock(
    TROUBLESHOOTING_DOC_PATH,
    "docs/troubleshooting.md extension troubleshooting index",
    TROUBLESHOOTING_INDEX_START_MARKER,
    TROUBLESHOOTING_INDEX_END_MARKER,
    generateTroubleshootingIndex(manifests),
  );
  await replaceMarkedBlock(
    CONTRIBUTING_PATH,
    "CONTRIBUTING.md package script inventory",
    CONTRIBUTOR_SCRIPTS_START_MARKER,
    CONTRIBUTOR_SCRIPTS_END_MARKER,
    renderContributorScriptInventory(inventories.scripts),
  );
  await replaceMarkedBlock(
    COMMON_README_PATH,
    "lib/common/README.md module inventory",
    COMMON_MODULES_START_MARKER,
    COMMON_MODULES_END_MARKER,
    renderCommonModuleInventory(ROOT),
  );
  await replaceMarkedBlock(
    E2E_README_PATH,
    "scripts/e2e/README.md harness inventory",
    E2E_HARNESSES_START_MARKER,
    E2E_HARNESSES_END_MARKER,
    renderE2EHarnessInventory(inventories.harnesses),
  );
}

async function writeOrCheckArchitecture(manifests) {
  await replaceMarkedBlock(
    ARCHITECTURE_PATH,
    "ARCHITECTURE.md folder layout",
    ARCH_FOLDER_START_MARKER,
    ARCH_FOLDER_END_MARKER,
    generateFolderLayout(manifests),
  );
}

async function writeOrCheckCommandsDoc(manifests) {
  const raw = generateCommandsDoc(manifests);
  const formatted = await prettier.format(raw, { parser: "markdown" });
  writeOrCheck(COMMANDS_DOC_PATH, formatted, "docs/commands.md");
}

async function writeOrCheckExtensionsDoc(manifests) {
  const raw = generateExtensionsDoc(manifests);
  const formatted = await prettier.format(raw, { parser: "markdown" });
  writeOrCheck(EXTENSIONS_DOC_PATH, formatted, "docs/extensions.md");
}

async function writeOrCheckExtensionDetailDocs(manifests) {
  const expectedFiles = new Set(manifests.map(({ dir }) => `${dir}.md`));

  if (!existsSync(EXTENSION_DOCS_DIR)) {
    if (CHECK_ONLY) {
      hasDiff = true;
      console.error("❌ docs/extensions directory is missing. Run: npm run generate-catalog");
    } else {
      mkdirSync(EXTENSION_DOCS_DIR, { recursive: true });
    }
  } else {
    for (const entry of readdirSync(EXTENSION_DOCS_DIR, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md") && !expectedFiles.has(entry.name)) {
        const stalePath = path.join(EXTENSION_DOCS_DIR, entry.name);
        if (CHECK_ONLY) {
          hasDiff = true;
          console.error(`❌ docs/extensions/${entry.name} is stale. Run: npm run generate-catalog`);
        } else {
          unlinkSync(stalePath);
          console.log(`✅ removed stale docs/extensions/${entry.name}`);
        }
      }
    }
  }

  for (const { dir, manifest } of manifests) {
    const raw = generateExtensionDetailDoc(dir, manifest);
    const formatted = await prettier.format(raw, { parser: "markdown" });
    writeOrCheck(
      path.join(EXTENSION_DOCS_DIR, `${dir}.md`),
      formatted,
      `docs/extensions/${dir}.md`,
    );
  }
}

async function writeOrCheckExtensionSidebar(manifests) {
  const raw = generateExtensionSidebar(manifests);
  const formatted = await prettier.format(raw, { parser: "typescript" });
  writeOrCheck(EXTENSION_SIDEBAR_PATH, formatted, "docs/.vitepress/generated-extension-sidebar.ts");
}

// -------------------------------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------------------------------

const manifests = discoverManifests();
validatePackageExtensions(manifests);
let adrRecords;
let documentationInventories;
try {
  adrRecords = loadAdrRecords(ADR_DIR);
  documentationInventories = loadDocumentationInventories(ROOT);
} catch (error) {
  fail(error.message);
}
const recommendationsPath = path.join(CATALOG_DIR, "recommendations.json");
const announcementsPath = path.join(CATALOG_DIR, "announcements.json");

// Complete every fallible input/marker validation before the first generated
// write so write mode cannot leave a partially refreshed tree.
validateRecommendations(recommendationsPath, true);
validateAnnouncements(announcementsPath, true);
preflightRequiredMarkers(manifests);

writeOrCheck(
  path.join(CATALOG_DIR, "registry.ts"),
  generateRegistryTs(manifests),
  `catalog/registry.ts — ${manifests.length} extension(s)`,
);

writeOrCheck(
  path.join(CATALOG_DIR, "index.json"),
  `${JSON.stringify(generateIndexJson(manifests), null, 2)}\n`,
  `catalog/index.json — ${manifests.length} extension(s)`,
);

await writeOrCheckGeneratedMarkdownBlocks(manifests, documentationInventories);

await writeOrCheckArchitecture(manifests);

await writeOrCheckCommandsDoc(manifests);

await writeOrCheckExtensionsDoc(manifests);

await writeOrCheckExtensionDetailDocs(manifests);

await writeOrCheckExtensionSidebar(manifests);

await writeOrCheckAgentOrientationDoc(manifests);

await writeOrCheckAdrIndex(adrRecords);

await writeOrCheckExtensionReadmes(manifests);

refreshAnnouncementsFromChangelog(announcementsPath);
validateRecommendations(recommendationsPath);
validateAnnouncements(announcementsPath);

if (CHECK_ONLY && hasDiff) {
  process.exit(1);
}

// -------------------------------------------------------------------------------------------------
// Recommendations schema + license allow-list validation
// -------------------------------------------------------------------------------------------------

/**
 * Validate catalog/recommendations.json without regenerating anything.
 *
 * The file is hand-maintained (not generated). We still run it through the
 * catalog script so a single `npm run generate-catalog` call enforces the
 * whole catalog's invariants — schema shape, unique ids, bundle references
 * that resolve, and license allow-list.
 */
function validateRecommendations(filePath, quiet = false) {
  if (!existsSync(filePath)) {
    if (!quiet) {
      console.log("ℹ catalog/recommendations.json missing (optional) — skipping validation");
    }
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`❌ catalog/recommendations.json is not valid JSON: ${error.message}`);
    process.exit(1);
  }

  const errors = [];

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    errors.push("root must be an object");
  } else {
    if (manifest.schemaVersion !== 1) {
      errors.push(`schemaVersion must be 1 (got ${JSON.stringify(manifest.schemaVersion)})`);
    }
    if (typeof manifest.revision !== "string" || manifest.revision.length === 0) {
      errors.push("revision must be a non-empty string");
    }
    if (!Array.isArray(manifest.bundles)) {
      errors.push("bundles must be an array");
    }
    if (!manifest.items || typeof manifest.items !== "object" || Array.isArray(manifest.items)) {
      errors.push("items must be an object keyed by item id");
    }
  }

  if (errors.length === 0) {
    const itemIds = new Set(Object.keys(manifest.items));

    for (const [key, item] of Object.entries(manifest.items)) {
      if (!item || typeof item !== "object") {
        errors.push(`items.${key} must be an object`);
        continue;
      }
      if (item.id !== key) {
        errors.push(`items.${key}.id must equal its key (got "${item.id}")`);
      }
      for (const field of ["name", "description", "source", "homepage", "license", "rationale"]) {
        if (typeof item[field] !== "string" || item[field].length === 0) {
          errors.push(`items.${key}.${field} must be a non-empty string`);
        }
      }
      if (item.scope !== undefined && item.scope !== "global" && item.scope !== "project") {
        errors.push(`items.${key}.scope must be "global" or "project" when set`);
      }
      if (typeof item.license === "string" && !ALLOWED_RECOMMENDED_LICENSES.has(item.license)) {
        errors.push(
          `items.${key}.license "${item.license}" is not in the allow-list ` +
            `(${[...ALLOWED_RECOMMENDED_LICENSES].join(", ")}). ` +
            `Update scripts/generate-catalog.mjs + catalog/types.ts if you intend to broaden it.`,
        );
      }
    }

    for (const bundle of manifest.bundles) {
      if (!bundle || typeof bundle !== "object") {
        errors.push("each bundle must be an object");
        continue;
      }
      for (const field of ["id", "name", "description"]) {
        if (typeof bundle[field] !== "string" || bundle[field].length === 0) {
          errors.push(`bundle.${bundle.id ?? "?"}.${field} must be a non-empty string`);
        }
      }
      if (typeof bundle.defaultOnFirstRun !== "boolean") {
        errors.push(`bundle.${bundle.id ?? "?"}.defaultOnFirstRun must be a boolean`);
      }
      if (!Array.isArray(bundle.items)) {
        errors.push(`bundle.${bundle.id ?? "?"}.items must be an array`);
      } else {
        for (const itemId of bundle.items) {
          if (!itemIds.has(itemId)) {
            errors.push(
              `bundle.${bundle.id}.items references unknown item id "${itemId}". ` +
                `Add it to items or remove it from the bundle.`,
            );
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error("❌ catalog/recommendations.json is invalid:");
    for (const message of errors) {
      console.error(`   - ${message}`);
    }
    process.exit(1);
  }

  if (!quiet) {
    const itemCount = Object.keys(manifest.items).length;
    const bundleCount = manifest.bundles.length;
    console.log(
      `✅ catalog/recommendations.json — ${itemCount} item(s), ${bundleCount} bundle(s), revision ${manifest.revision}`,
    );
  }
}

// -------------------------------------------------------------------------------------------------
// Announcements auto-refresh from CHANGELOG.md
//
// Keeps `latestVersion` and a single `release-<version>` announcement in
// sync with the most recent non-Unreleased section of the top-level
// CHANGELOG.md. Without this the splash drifts: the bundled JSON claims
// the user is behind an older latestVersion, and release notes never
// surface. Hand-written entries (other kinds, deprecations, etc.) are
// preserved untouched.
//
// The entry id is `release-<version>` so dismissals are sticky across
// catalog regenerations within the same release — the id changes only
// when a new version is cut, which is exactly when the user should see
// the banner again.
// -------------------------------------------------------------------------------------------------

function refreshAnnouncementsFromChangelog(filePath) {
  if (!existsSync(filePath)) return;

  const changelogPath = path.join(ROOT, "CHANGELOG.md");
  if (!existsSync(changelogPath)) return;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return; // validator will report the JSON error
  }
  if (!manifest || typeof manifest !== "object") return;

  const release = parseLatestRelease(readFileSync(changelogPath, "utf8"));
  if (!release) return;

  const releaseId = `release-${release.version}`;
  const others = Array.isArray(manifest.announcements)
    ? manifest.announcements.filter((item) => !isGeneratedReleaseEntry(item))
    : [];

  const entry = buildReleaseAnnouncement(release, releaseId);
  manifest.announcements = [entry, ...others];
  manifest.latestVersion = release.version;
  manifest.revision = `release-${release.version}-${release.date}`;

  const next = `${JSON.stringify(manifest, null, 2)}\n`;
  writeOrCheck(filePath, next, "catalog/announcements.json");
}

/** Our generated entries always use the `release-x.y.z` id + kind="update". */
function isGeneratedReleaseEntry(item) {
  return (
    !!item &&
    typeof item === "object" &&
    typeof item.id === "string" &&
    item.id.startsWith("release-") &&
    item.kind === "update"
  );
}

/** Parse the first non-Unreleased `## [x.y.z](...) (YYYY-MM-DD)` section. */
function parseLatestRelease(source) {
  const lines = source.split("\n");
  const headerPattern = /^##\s*\[([0-9]+\.[0-9]+\.[0-9]+)\].*\((\d{4}-\d{2}-\d{2})\)\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const match = headerPattern.exec(lines[i]);
    if (!match) continue;
    const version = match[1];
    const date = match[2];
    const bodyLines = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^##\s/.test(lines[j])) break;
      bodyLines.push(lines[j]);
    }
    const bullets = extractFirstBullets(bodyLines);
    const title = bullets.length > 0 ? bullets[0] : `sf-pi v${version}`;
    const body = bullets.slice(0, 2).join(" — ");
    return { version, date, title, body };
  }
  return null;
}

/** Pull the first few "* bullet" lines, stripping PR/commit link noise. */
function extractFirstBullets(bodyLines) {
  const results = [];
  for (const raw of bodyLines) {
    const line = raw.trim();
    if (!line.startsWith("*") && !line.startsWith("-")) continue;
    let text = line.replace(/^[*-]\s*/, "");
    // Strip trailing markdown links like `([#68](...))` and `([abc123](...))`.
    text = text.replace(/\s*\(\[[^\]]+\]\([^)]+\)\)/g, "").trim();
    // Strip remaining markdown link/emphasis syntax but keep the words.
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
    if (text.length === 0) continue;
    results.push(text);
    if (results.length >= 3) break;
  }
  return results;
}

function buildReleaseAnnouncement(release, id) {
  const { version, date, title, body } = release;
  const entry = {
    id,
    kind: "update",
    title: truncateTitle(`sf-pi v${version} — ${title}`),
    publishedAt: `${date}T00:00:00Z`,
    link: `https://github.com/salesforce/sf-pi/releases/tag/v${version}`,
    severity: "info",
  };
  if (body && body.length > 0) entry.body = truncateBody(body);
  return entry;
}

function truncateTitle(text) {
  return text.length > 110 ? `${text.slice(0, 107).trimEnd()}…` : text;
}

function truncateBody(text) {
  return text.length > 280 ? `${text.slice(0, 277).trimEnd()}…` : text;
}

// -------------------------------------------------------------------------------------------------
// Announcements schema validation
//
// Same shape as the recommendations validator — hand-edited JSON, so we
// enforce structural invariants on every `npm run generate-catalog` run.
// -------------------------------------------------------------------------------------------------

function validateAnnouncements(filePath, quiet = false) {
  if (!existsSync(filePath)) {
    if (!quiet) {
      console.log("ℹ catalog/announcements.json missing (optional) — skipping validation");
    }
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`❌ catalog/announcements.json is not valid JSON: ${error.message}`);
    process.exit(1);
  }

  const errors = [];

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    errors.push("root must be an object");
  } else {
    if (manifest.schemaVersion !== 1) {
      errors.push(`schemaVersion must be 1 (got ${JSON.stringify(manifest.schemaVersion)})`);
    }
    if (typeof manifest.revision !== "string" || manifest.revision.length === 0) {
      errors.push("revision must be a non-empty string");
    }
    if (manifest.latestVersion !== undefined && typeof manifest.latestVersion !== "string") {
      errors.push("latestVersion must be a string when set");
    }
    if (manifest.feedUrl !== undefined && typeof manifest.feedUrl !== "string") {
      errors.push("feedUrl must be a string when set");
    }
    if (!Array.isArray(manifest.announcements)) {
      errors.push("announcements must be an array");
    }
  }

  if (errors.length === 0) {
    const seenIds = new Set();
    for (const [index, item] of manifest.announcements.entries()) {
      const label = `announcements[${index}]`;
      if (!item || typeof item !== "object") {
        errors.push(`${label} must be an object`);
        continue;
      }
      if (typeof item.id !== "string" || item.id.length === 0) {
        errors.push(`${label}.id must be a non-empty string`);
      } else if (seenIds.has(item.id)) {
        errors.push(`${label}.id "${item.id}" is a duplicate`);
      } else {
        seenIds.add(item.id);
      }
      if (typeof item.title !== "string" || item.title.length === 0) {
        errors.push(`${label}.title must be a non-empty string`);
      }
      if (!ANNOUNCEMENT_KINDS.has(item.kind)) {
        errors.push(
          `${label}.kind must be one of ${[...ANNOUNCEMENT_KINDS].join(", ")} (got ${JSON.stringify(item.kind)})`,
        );
      }
      if (item.severity !== undefined && !ANNOUNCEMENT_SEVERITIES.has(item.severity)) {
        errors.push(
          `${label}.severity must be one of ${[...ANNOUNCEMENT_SEVERITIES].join(", ")} when set`,
        );
      }
      if (item.evergreen !== undefined && typeof item.evergreen !== "boolean") {
        errors.push(`${label}.evergreen must be a boolean when set`);
      }
      for (const optional of [
        "body",
        "link",
        "publishedAt",
        "expiresAt",
        "minVersion",
        "maxVersion",
      ]) {
        if (item[optional] !== undefined && typeof item[optional] !== "string") {
          errors.push(`${label}.${optional} must be a string when set`);
        }
      }
      for (const dateField of ["publishedAt", "expiresAt"]) {
        if (typeof item[dateField] === "string" && Number.isNaN(Date.parse(item[dateField]))) {
          errors.push(`${label}.${dateField} must be an ISO-8601 date string`);
        }
      }
      if (!isGeneratedReleaseEntry(item)) {
        if (!item.expiresAt && !item.maxVersion && item.evergreen !== true) {
          errors.push(`${label} must declare expiresAt, maxVersion, or evergreen=true`);
        }
        if (item.evergreen === true && (item.expiresAt || item.maxVersion)) {
          errors.push(`${label}.evergreen=true cannot be combined with expiresAt or maxVersion`);
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error("❌ catalog/announcements.json is invalid:");
    for (const message of errors) console.error(`   - ${message}`);
    process.exit(1);
  }

  if (!quiet) {
    const count = manifest.announcements.length;
    const latestSuffix = manifest.latestVersion ? `, latestVersion ${manifest.latestVersion}` : "";
    console.log(
      `✅ catalog/announcements.json — ${count} item(s), revision ${manifest.revision}${latestSuffix}`,
    );
  }
}
