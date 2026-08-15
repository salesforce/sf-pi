/* SPDX-License-Identifier: Apache-2.0 */
/** Generated structural inventories for contributor-facing documentation. */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const CONTRIBUTOR_SCRIPTS_START_MARKER = "<!-- GENERATED:contributor-scripts:start -->";
export const CONTRIBUTOR_SCRIPTS_END_MARKER = "<!-- GENERATED:contributor-scripts:end -->";
export const E2E_HARNESSES_START_MARKER = "<!-- GENERATED:e2e-harnesses:start -->";
export const E2E_HARNESSES_END_MARKER = "<!-- GENERATED:e2e-harnesses:end -->";
export const COMMON_MODULES_START_MARKER = "<!-- GENERATED:common-modules:start -->";
export const COMMON_MODULES_END_MARKER = "<!-- GENERATED:common-modules:end -->";

const E2E_POSTURES = new Set(["read-only", "plan-only", "bounded-mutation", "model-only"]);
const SCRIPT_GROUP_ORDER = [
  "Generated sources",
  "Documentation",
  "Static checks",
  "Formatting and linting",
  "Tests",
  "Validation",
  "E2E and live proofs",
  "Development utilities",
  "Lifecycle hooks",
  "Other",
];

export function loadDocumentationInventories(root) {
  const packagePath = path.join(root, "package.json");
  const pkg = readJson(packagePath, "package.json");
  const scripts = pkg.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    throw new Error("package.json scripts must be an object");
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== "string" || command.length === 0) {
      throw new Error(`package.json scripts.${name} must be a non-empty string`);
    }
  }

  const e2eManifestPath = path.join(root, "scripts", "e2e", "harnesses.json");
  const e2eManifest = readJson(e2eManifestPath, "scripts/e2e/harnesses.json");
  const harnesses = validateE2EHarnesses(root, scripts, e2eManifest);
  return { scripts, harnesses };
}

export function renderContributorScriptInventory(scripts) {
  const groups = new Map(SCRIPT_GROUP_ORDER.map((group) => [group, []]));
  for (const name of Object.keys(scripts).sort((left, right) => left.localeCompare(right))) {
    groups.get(scriptGroup(name)).push(name);
  }

  const scriptCount = Object.keys(scripts).length;
  const lines = [
    CONTRIBUTOR_SCRIPTS_START_MARKER,
    "This complete inventory is generated from `package.json`; edit that file and run `npm run generate-catalog`.",
    "",
    "<details>",
    `<summary>Show all ${scriptCount} package scripts</summary>`,
    "",
  ];
  for (const group of SCRIPT_GROUP_ORDER) {
    const names = groups.get(group);
    if (names.length === 0) continue;
    lines.push(`**${group}**`, "", ...names.map((name) => `- \`npm run ${name}\``), "");
  }
  lines.push("</details>", "", CONTRIBUTOR_SCRIPTS_END_MARKER);
  return lines.join("\n");
}

export function renderE2EHarnessInventory(harnesses) {
  const lines = [
    E2E_HARNESSES_START_MARKER,
    "This inventory is generated from `scripts/e2e/harnesses.json` and checked against `package.json` plus the runnable harness files.",
    "",
    "| Harness | Run | Target | Posture | Artifacts |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const harness of harnesses) {
    const link = path.posix.relative("scripts/e2e", harness.entry);
    const command = `npm run ${harness.script}${harness.arguments ? ` -- ${harness.arguments}` : ""}`;
    lines.push(
      `| [${escapeCell(harness.title)}](./${link})<br>${escapeCell(harness.summary)} | \`${escapeCode(command)}\` | ${escapeCell(harness.target)} | \`${harness.posture}\` | ${escapeCell(harness.artifacts)} |`,
    );
  }
  lines.push(E2E_HARNESSES_END_MARKER);
  return lines.join("\n");
}

export function renderCommonModuleInventory(root) {
  const commonRoot = path.join(root, "lib", "common");
  if (!existsSync(commonRoot) || !statSync(commonRoot).isDirectory()) {
    throw new Error("lib/common must be a directory");
  }

  const entries = readdirSync(commonRoot, { withFileTypes: true })
    .filter((entry) => entry.name !== "README.md")
    .sort((left, right) => left.name.localeCompare(right.name));
  const lines = [
    COMMON_MODULES_START_MARKER,
    "This complete top-level inventory is generated from `lib/common/`. Directory counts include nested TypeScript files.",
    "",
    "| Path | Kind | Production TypeScript | Test TypeScript |",
    "| --- | --- | ---: | ---: |",
  ];
  for (const entry of entries) {
    const absolute = path.join(commonRoot, entry.name);
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      lines.push(`| \`${entry.name}\` | module | 1 | 0 |`);
      continue;
    }
    if (!entry.isDirectory()) continue;
    const counts = countTypeScript(absolute);
    lines.push(`| \`${entry.name}/\` | directory | ${counts.production} | ${counts.tests} |`);
  }
  lines.push(COMMON_MODULES_END_MARKER);
  return lines.join("\n");
}

export function discoverRunnableE2EEntries(root) {
  const e2eRoot = path.join(root, "scripts", "e2e");
  if (!existsSync(e2eRoot)) return [];
  const entries = [];
  for (const entry of readdirSync(e2eRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      entries.push(`scripts/e2e/${entry.name}`);
    } else if (entry.isDirectory() && existsSync(path.join(e2eRoot, entry.name, "run.ts"))) {
      entries.push(`scripts/e2e/${entry.name}/run.ts`);
    }
  }
  return entries.sort((left, right) => left.localeCompare(right));
}

function validateE2EHarnesses(root, scripts, manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("scripts/e2e/harnesses.json root must be an object");
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error("scripts/e2e/harnesses.json schemaVersion must be 1");
  }
  if (!Array.isArray(manifest.harnesses)) {
    throw new Error("scripts/e2e/harnesses.json harnesses must be an array");
  }

  const seenScripts = new Set();
  const seenEntries = new Set();
  for (const [index, harness] of manifest.harnesses.entries()) {
    const label = `scripts/e2e/harnesses.json harnesses[${index}]`;
    if (!harness || typeof harness !== "object" || Array.isArray(harness)) {
      throw new Error(`${label} must be an object`);
    }
    for (const field of ["script", "entry", "title", "summary", "target", "posture", "artifacts"]) {
      if (typeof harness[field] !== "string" || harness[field].length === 0) {
        throw new Error(`${label}.${field} must be a non-empty string`);
      }
    }
    if (harness.arguments !== undefined && typeof harness.arguments !== "string") {
      throw new Error(`${label}.arguments must be a string when set`);
    }
    if (!E2E_POSTURES.has(harness.posture)) {
      throw new Error(`${label}.posture must be one of ${[...E2E_POSTURES].join(", ")}`);
    }
    if (seenScripts.has(harness.script)) throw new Error(`${label}.script is duplicated`);
    if (seenEntries.has(harness.entry)) throw new Error(`${label}.entry is duplicated`);
    seenScripts.add(harness.script);
    seenEntries.add(harness.entry);

    const packageCommand = scripts[harness.script];
    if (typeof packageCommand !== "string") {
      throw new Error(
        `${label}.script ${JSON.stringify(harness.script)} is missing from package.json`,
      );
    }
    if (!packageCommand.includes(harness.entry)) {
      throw new Error(`${label}.entry is not invoked by package.json script ${harness.script}`);
    }
    const absoluteEntry = path.resolve(root, harness.entry);
    const relativeEntry = path.relative(root, absoluteEntry);
    if (
      relativeEntry === "" ||
      relativeEntry === ".." ||
      relativeEntry.startsWith(`..${path.sep}`) ||
      !existsSync(absoluteEntry) ||
      !statSync(absoluteEntry).isFile()
    ) {
      throw new Error(`${label}.entry does not resolve to a repository file`);
    }
  }

  const packageScripts = Object.keys(scripts)
    .filter((name) => name.startsWith("e2e:"))
    .sort();
  const manifestScripts = [...seenScripts].sort();
  assertEqualSets(
    packageScripts,
    manifestScripts,
    "package.json e2e:* scripts",
    "scripts/e2e/harnesses.json scripts",
  );
  assertEqualSets(
    discoverRunnableE2EEntries(root),
    [...seenEntries].sort(),
    "runnable scripts/e2e entries",
    "scripts/e2e/harnesses.json entries",
  );

  return manifest.harnesses;
}

function scriptGroup(name) {
  if (/^(generate-|import-)/.test(name)) return "Generated sources";
  if (name.startsWith("docs:")) return "Documentation";
  if (name === "check" || name.startsWith("check:") || name.startsWith("spdx")) {
    return "Static checks";
  }
  if (/^(format|eslint|lint)/.test(name)) return "Formatting and linting";
  if (name.startsWith("test")) return "Tests";
  if (name.startsWith("validate")) return "Validation";
  if (name.startsWith("e2e:")) return "E2E and live proofs";
  if (/^(scaffold|agentscript:|instruction-surface:)/.test(name)) return "Development utilities";
  if (name === "preinstall" || name === "prepare") return "Lifecycle hooks";
  return "Other";
}

function countTypeScript(directory) {
  let production = 0;
  let tests = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        if (entry.name.endsWith(".test.ts") || absolute.split(path.sep).includes("tests")) tests++;
        else production++;
      }
    }
  };
  walk(directory);
  return { production, tests };
}

function assertEqualSets(left, right, leftLabel, rightLabel) {
  const missing = left.filter((value) => !right.includes(value));
  const extra = right.filter((value) => !left.includes(value));
  if (missing.length === 0 && extra.length === 0) return;
  const details = [];
  if (missing.length > 0) details.push(`missing from ${rightLabel}: ${missing.join(", ")}`);
  if (extra.length > 0) details.push(`missing from ${leftLabel}: ${extra.join(", ")}`);
  throw new Error(`${leftLabel} must equal ${rightLabel}; ${details.join("; ")}`);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function escapeCode(value) {
  return String(value).replaceAll("`", "\\`");
}
