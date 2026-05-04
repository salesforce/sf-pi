/* SPDX-License-Identifier: Apache-2.0 */
// Generate catalog/registry.ts, catalog/index.json, and the root README bundled
// extension table from extensions/*/manifest.json.
//
// Run:
//   node scripts/generate-catalog.mjs
//   npm run generate-catalog
//
// Check only (no writes, non-zero exit on drift):
//   node scripts/generate-catalog.mjs --check
//   npm run generate-catalog:check
//
// The manifest.json in each extension folder is the source of truth.

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const EXTENSIONS_DIR = path.join(ROOT, "extensions");
const CATALOG_DIR = path.join(ROOT, "catalog");
const DOCS_DIR = path.join(ROOT, "docs");
const README_PATH = path.join(ROOT, "README.md");
const ARCHITECTURE_PATH = path.join(ROOT, "ARCHITECTURE.md");
const COMMANDS_DOC_PATH = path.join(DOCS_DIR, "commands.md");
const AGENT_ORIENTATION_DOC_PATH = path.join(DOCS_DIR, "agent-orientation.md");
const CHECK_ONLY = process.argv.includes("--check");

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

const README_START_MARKER = "<!-- GENERATED:bundled-extensions:start -->";
const README_END_MARKER = "<!-- GENERATED:bundled-extensions:end -->";
const README_COMMANDS_START_MARKER = "<!-- GENERATED:command-reference:start -->";
const README_COMMANDS_END_MARKER = "<!-- GENERATED:command-reference:end -->";
const ARCH_FOLDER_START_MARKER = "<!-- GENERATED:folder-layout:start -->";
const ARCH_FOLDER_END_MARKER = "<!-- GENERATED:folder-layout:end -->";
const README_TROUBLESHOOTING_START_MARKER = "<!-- GENERATED:troubleshooting-index:start -->";
const README_TROUBLESHOOTING_END_MARKER = "<!-- GENERATED:troubleshooting-index:end -->";
const EXT_FILE_STRUCTURE_START_MARKER = "<!-- GENERATED:file-structure:start -->";
const EXT_FILE_STRUCTURE_END_MARKER = "<!-- GENERATED:file-structure:end -->";
const README_CATEGORY_ORDER = ["core", "provider", "ui"];
const EXTENSION_FILE_MAP_INCLUDE = new Set([
  "AGENTS.md",
  "CREDITS.md",
  "ROADMAP.md",
  "SF_GUARDRAIL_DEFAULTS.json",
  "SF_GUARDRAIL_PROMPT.md",
  "SF_KERNEL.md",
  "index.ts",
  "manifest.json",
  "README.md",
]);

let hasDiff = false;

// -------------------------------------------------------------------------------------------------
// Discover manifests
// -------------------------------------------------------------------------------------------------

function discoverManifests() {
  const entries = readdirSync(EXTENSIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  const results = [];

  for (const entry of entries) {
    const manifestPath = path.join(EXTENSIONS_DIR, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) {
      console.warn(`⚠ Skipping ${entry.name}/ — no manifest.json`);
      continue;
    }

    const indexPath = path.join(EXTENSIONS_DIR, entry.name, "index.ts");
    if (!existsSync(indexPath)) {
      console.warn(`⚠ Skipping ${entry.name}/ — no index.ts`);
      continue;
    }

    try {
      const raw = readFileSync(manifestPath, "utf8");
      const manifest = JSON.parse(raw);

      if (!manifest.id || !manifest.name || !manifest.description || !manifest.category) {
        console.warn(`⚠ Skipping ${entry.name}/ — manifest.json missing required fields`);
        continue;
      }

      if (manifest.id !== entry.name) {
        console.warn(
          `⚠ Warning: ${entry.name}/manifest.json id "${manifest.id}" doesn't match directory name`,
        );
      }

      results.push({ dir: entry.name, manifest });
    } catch (error) {
      console.warn(`⚠ Skipping ${entry.name}/ — invalid manifest.json: ${error}`);
    }
  }

  return results;
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

function defaultLabel(manifest) {
  if (manifest.alwaysActive) return "always-on";
  return manifest.defaultEnabled ? "on" : "opt-in";
}

function generateReadmeBundledExtensions(manifests) {
  const sorted = sortByCategoryThenName(manifests);

  const lines = [
    README_START_MARKER,
    "For the canonical machine-readable bundle list, see [`catalog/index.json`](./catalog/index.json).",
    "",
    "**Default** column: `on` = enabled on install, `opt-in` = disabled on install (enable with `/sf-pi enable <id>`), `always-on` = cannot be disabled.",
    "",
    "| Extension | Category | Default | Description |",
    "|-----------|----------|---------|-------------|",
  ];

  for (const { dir, manifest } of sorted) {
    const description = manifest.alwaysActive
      ? `${manifest.description} (always active)`
      : manifest.description;
    lines.push(
      `| [${manifest.name}](./extensions/${dir}/) | ${manifest.category} | ${defaultLabel(manifest)} | ${description} |`,
    );
  }

  lines.push(README_END_MARKER);
  return lines.join("\n");
}

// -------------------------------------------------------------------------------------------------
// Command reference (root README block + docs/commands.md)
// -------------------------------------------------------------------------------------------------

function generateCommandReferenceBlock(manifests) {
  const sorted = sortByCategoryThenName(manifests).filter(
    ({ manifest }) => Array.isArray(manifest.commands) && manifest.commands.length > 0,
  );

  const lines = [
    README_COMMANDS_START_MARKER,
    "Every slash command exposed by a bundled extension. See each extension README for subcommands and flags.",
    "",
    "| Command | Extension | Category |",
    "|---------|-----------|----------|",
  ];

  for (const { dir, manifest } of sorted) {
    for (const command of manifest.commands) {
      lines.push(
        `| \`${command}\` | [${manifest.name}](./extensions/${dir}/) | ${manifest.category} |`,
      );
    }
  }

  lines.push(README_COMMANDS_END_MARKER);
  return lines.join("\n");
}

function generateCommandsDoc(manifests) {
  const sorted = sortByCategoryThenName(manifests);

  const lines = [
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
    "- [`catalog/index.json`](../catalog/index.json) \u2014 machine-readable catalog",
    "- [`README.md`](../README.md) \u2014 install, quick start, bundled extensions",
    "- [`ARCHITECTURE.md`](../ARCHITECTURE.md) \u2014 repo structure and conventions",
    "",
  ];

  for (const category of README_CATEGORY_ORDER) {
    const inCategory = sorted.filter(({ manifest }) => manifest.category === category);
    if (inCategory.length === 0) continue;

    const heading = category.charAt(0).toUpperCase() + category.slice(1);
    lines.push(`## ${heading}`);
    lines.push("");

    for (const { dir, manifest } of inCategory) {
      const commands = Array.isArray(manifest.commands) ? manifest.commands : [];
      const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
      const providers = Array.isArray(manifest.providers) ? manifest.providers : [];

      lines.push(`### [${manifest.name}](../extensions/${dir}/)`);
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

// -------------------------------------------------------------------------------------------------
// Troubleshooting index (root README block)
//
// Each extension's README may include a `## Troubleshooting` section. When it
// does, the section is parsed for its bolded question entries (lines that
// start with `**...:**` or `**...?**`) and surfaced in the root README
// through an auto-generated table of contents. This lets users land on a
// specific symptom quickly without knowing which extension owns it.
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
    README_TROUBLESHOOTING_START_MARKER,
    "Jump to an extension's Troubleshooting section to see the full fix. This index is generated from the `## Troubleshooting` section in each extension README, so it never drifts.",
    "",
  ];

  let anyEntries = false;
  for (const { dir, manifest } of sorted) {
    const readmePath = path.join(EXTENSIONS_DIR, dir, "README.md");
    const entries = extractTroubleshootingEntries(readmePath);
    if (entries.length === 0) continue;

    anyEntries = true;
    lines.push(`**[${manifest.name}](./extensions/${dir}/#troubleshooting)**`);
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

  lines.push(README_TROUBLESHOOTING_END_MARKER);
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
    "\u2502   \u2514\u2500\u2500 workflows/              \u2190 CI, release-please, sync-agentforce-sdk",
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
    "\u2502   \u2514\u2500\u2500 commands.md             \u2190 GENERATED per-extension command reference",
    "\u251c\u2500\u2500 scripts/",
    "\u2502   \u251c\u2500\u2500 generate-catalog.mjs    \u2190 Reads manifests, writes registry + index + docs",
    "\u2502   \u251c\u2500\u2500 scaffold.mjs            \u2190 Scaffolds a new extension",
    "\u2502   \u2514\u2500\u2500 validate.sh             \u2190 Full validation (generate + format + check + test)",
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

function listExtensionFiles(dir) {
  const extDir = path.join(EXTENSIONS_DIR, dir);
  const files = [];

  function walk(current, relativeDir = "") {
    const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name);
    });

    for (const entry of entries) {
      const rel = path.posix.join(relativeDir, entry.name);
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "vendor") continue;
        walk(full, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (shouldIncludeExtensionFile(rel)) files.push(rel);
    }
  }

  walk(extDir);
  return files;
}

function shouldIncludeExtensionFile(rel) {
  if (EXTENSION_FILE_MAP_INCLUDE.has(rel)) return true;
  if (rel.startsWith("lib/") && rel.endsWith(".ts")) return true;
  if (rel.startsWith("tests/") && rel.endsWith(".test.ts")) return true;
  if (rel.startsWith("assets/fonts/") && (rel.endsWith("LICENSE") || rel.endsWith("SOURCE.md"))) {
    return true;
  }
  return false;
}

function fileDescription(rel) {
  if (rel === "index.ts") return "Pi extension entry point";
  if (rel === "manifest.json") return "source-of-truth extension metadata";
  if (rel === "README.md") return "human + agent walkthrough";
  if (rel === "AGENTS.md") return "extension-specific agent editing rules";
  if (rel === "ROADMAP.md") return "extension-specific phased roadmap";
  if (rel === "CREDITS.md") return "extension attribution";
  if (rel.endsWith(".test.ts")) return "unit / smoke test";
  if (rel.startsWith("lib/") && rel.endsWith(".ts")) return "implementation module";
  if (rel.startsWith("assets/")) return "bundled asset metadata";
  return "supporting file";
}

function buildTree(files, dir) {
  const root = { children: new Map() };

  for (const rel of files) {
    let node = root;
    const parts = rel.split("/");
    for (const part of parts) {
      if (!node.children.has(part)) node.children.set(part, { children: new Map() });
      node = node.children.get(part);
    }
    node.file = true;
    node.rel = rel;
  }

  const lines = [`extensions/${dir}/`];
  function emit(node, depth) {
    const entries = [...node.children.entries()].sort(([leftName, left], [rightName, right]) => {
      if (!!left.file !== !!right.file) return left.file ? 1 : -1;
      return leftName.localeCompare(rightName);
    });
    for (const [name, child] of entries) {
      const indent = "  ".repeat(depth);
      if (child.file) {
        const padded = name.padEnd(Math.max(1, 28 - indent.length));
        lines.push(`${indent}${padded}← ${fileDescription(child.rel)}`);
      } else {
        lines.push(`${indent}${name}/`);
        emit(child, depth + 1);
      }
    }
  }
  emit(root, 1);
  return lines.join("\n");
}

function generateExtensionFileStructure(dir) {
  const files = listExtensionFiles(dir);
  return [
    EXT_FILE_STRUCTURE_START_MARKER,
    "```",
    buildTree(files, dir),
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

function generatedList(items) {
  return items.length > 0 ? items.map((item) => `\`${item}\``).join(", ") : "_none_";
}

function generateAgentOrientationDoc(manifests) {
  const sorted = sortByCategoryThenName(manifests);
  const lines = [
    "# sf-pi Agent Orientation",
    "",
    "> **Auto-generated from manifests and repo layout.**",
    "> Run `npm run generate-catalog` to refresh; do not edit by hand.",
    "",
    "## Start here",
    "",
    "1. [`catalog/index.json`](../catalog/index.json) — canonical machine-readable extension inventory.",
    "2. [`docs/commands.md`](./commands.md) — generated slash-command reference.",
    "3. [`ARCHITECTURE.md`](../ARCHITECTURE.md) — repo structure and editing conventions.",
    "4. `extensions/<id>/README.md` — behavior and runtime flow for a specific extension.",
    "5. `extensions/<id>/AGENTS.md` — extension-specific editing rules when present.",
    "",
    "## Extension map",
    "",
    "| Extension | Category | Default | Summary | Commands | Tools | Providers | Events | Key path |",
    "| --------- | -------- | ------- | ------- | -------- | ----- | --------- | ------ | -------- |",
  ];

  for (const { dir, manifest } of sorted) {
    lines.push(
      `| [${manifest.name}](../extensions/${dir}/) | ${manifest.category} | ${defaultLabel(manifest)} | ${manifest.docs?.summary ?? manifest.description} | ${generatedList(manifest.commands ?? [])} | ${generatedList(manifest.tools ?? [])} | ${generatedList(manifest.providers ?? [])} | ${generatedList(manifest.events ?? [])} | \`extensions/${dir}/index.ts\` |`,
    );
  }

  lines.push(
    "",
    "## Manifest doc metadata",
    "",
    "Extensions may optionally add `docs.summary`, `docs.primaryFiles`, `docs.stateFiles`, `docs.env`, and `docs.safety` to their manifest. When present, those fields flow into generated inventories without adding another source of truth.",
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
      ["scripts/generate-catalog.mjs", "catalog/index.json", "catalog/registry.ts"],
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
    "- `docs/commands.md`",
    "- `docs/agent-orientation.md`",
    "- generated marker blocks in `README.md` and `ARCHITECTURE.md`",
    "- generated file-structure marker blocks in `extensions/*/README.md`",
    "- normalized `catalog/announcements.json` release entry",
    "",
    "## Automation shortcuts",
    "",
    "- `npm run docs:health:check` — documentation drift and public-safety lint.",
    "- `npm run docs:changed` — changed-file impact summary for docs review.",
    "- `npm run validate:ci` — local approximation of CI's validation lane.",
  );

  return lines.join("\n");
}

async function writeOrCheckAgentOrientationDoc(manifests) {
  const raw = generateAgentOrientationDoc(manifests);
  const formatted = await prettier.format(raw, { parser: "markdown" });
  writeOrCheck(AGENT_ORIENTATION_DOC_PATH, formatted, "docs/agent-orientation.md");
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

async function replaceMarkedBlock(filePath, label, startMarker, endMarker, rawBlock) {
  const current = readFileSync(filePath, "utf8");
  const startIndex = current.indexOf(startMarker);
  const endIndex = current.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    console.error(
      `❌ ${path.relative(ROOT, filePath)} is missing markers: ${startMarker} / ${endMarker}`,
    );
    process.exit(1);
  }

  const generatedBlock = (await prettier.format(rawBlock, { parser: "markdown" })).trim();

  const before = current.slice(0, startIndex).replace(/\s*$/, "");
  const after = current.slice(endIndex + endMarker.length).replace(/^\s*/, "");
  const next = `${before}\n\n${generatedBlock}\n\n${after}`;

  writeOrCheck(filePath, next, label);
}

async function writeOrCheckReadme(manifests) {
  await replaceMarkedBlock(
    README_PATH,
    "README.md bundled extensions section",
    README_START_MARKER,
    README_END_MARKER,
    generateReadmeBundledExtensions(manifests),
  );

  await replaceMarkedBlock(
    README_PATH,
    "README.md command reference section",
    README_COMMANDS_START_MARKER,
    README_COMMANDS_END_MARKER,
    generateCommandReferenceBlock(manifests),
  );

  await replaceMarkedBlock(
    README_PATH,
    "README.md troubleshooting index",
    README_TROUBLESHOOTING_START_MARKER,
    README_TROUBLESHOOTING_END_MARKER,
    generateTroubleshootingIndex(manifests),
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

// -------------------------------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------------------------------

const manifests = discoverManifests();

if (manifests.length === 0) {
  console.error("❌ No valid manifests found in extensions/*/manifest.json");
  process.exit(1);
}

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

await writeOrCheckReadme(manifests);

await writeOrCheckArchitecture(manifests);

await writeOrCheckCommandsDoc(manifests);

await writeOrCheckAgentOrientationDoc(manifests);

await writeOrCheckExtensionReadmes(manifests);

refreshAnnouncementsFromChangelog(path.join(CATALOG_DIR, "announcements.json"));
validateRecommendations(path.join(CATALOG_DIR, "recommendations.json"));
validateAnnouncements(path.join(CATALOG_DIR, "announcements.json"));

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
function validateRecommendations(filePath) {
  if (!existsSync(filePath)) {
    console.log("ℹ catalog/recommendations.json missing (optional) — skipping validation");
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

  if (manifest.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1 (got ${JSON.stringify(manifest.schemaVersion)})`);
  }
  if (typeof manifest.revision !== "string" || manifest.revision.length === 0) {
    errors.push("revision must be a non-empty string");
  }
  if (!Array.isArray(manifest.bundles)) {
    errors.push("bundles must be an array");
  }
  if (!manifest.items || typeof manifest.items !== "object") {
    errors.push("items must be an object keyed by item id");
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

  const itemCount = Object.keys(manifest.items).length;
  const bundleCount = manifest.bundles.length;
  console.log(
    `✅ catalog/recommendations.json — ${itemCount} item(s), ${bundleCount} bundle(s), revision ${manifest.revision}`,
  );
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

function validateAnnouncements(filePath) {
  if (!existsSync(filePath)) {
    console.log("ℹ catalog/announcements.json missing (optional) — skipping validation");
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
    }
  }

  if (errors.length > 0) {
    console.error("❌ catalog/announcements.json is invalid:");
    for (const message of errors) console.error(`   - ${message}`);
    process.exit(1);
  }

  const count = manifest.announcements.length;
  const latestSuffix = manifest.latestVersion ? `, latestVersion ${manifest.latestVersion}` : "";
  console.log(
    `✅ catalog/announcements.json — ${count} item(s), revision ${manifest.revision}${latestSuffix}`,
  );
}
