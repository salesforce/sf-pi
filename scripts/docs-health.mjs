/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Documentation health checker.
 *
 * This script intentionally checks factual, easy-to-drift documentation
 * contracts instead of trying to judge prose quality. It is a guardrail for
 * agents and humans: generated blocks stay generated, extension READMEs retain
 * their conditional human-facing sections, and tracked public text avoids
 * obvious private artifacts.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanTrackedManualEvidence } from "./lib/manual-evidence.mjs";
import { scanTrackedPublicArtifacts } from "./lib/public-artifact-safety.mjs";
import { validateExtensionReadmeContract } from "./lib/readme-contract.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const EXTENSIONS_DIR = path.join(ROOT, "extensions");
const CHECK_ONLY = process.argv.includes("--check");
const JSON_MODE = process.argv.includes("--json");

const GENERATED_FILES = [
  "catalog/index.json",
  "catalog/registry.ts",
  "docs/extensions.md",
  "docs/.vitepress/generated-extension-sidebar.ts",
  "docs/commands.md",
  "docs/agent-orientation.md",
];

const findings = [];

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function addFinding(level, file, message, detail) {
  findings.push({ level, file, message, ...(detail ? { detail } : {}) });
}

function fail(file, message, detail) {
  addFinding("error", file, message, detail);
}

function warn(file, message, detail) {
  addFinding("warn", file, message, detail);
}

function readText(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function extensionDirs() {
  return readdirSync(EXTENSIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function checkReadmePiVersion() {
  const pkg = readJson("package.json");
  const floor = pkg.peerDependencies?.["@earendil-works/pi-coding-agent"];
  if (!floor)
    return fail("package.json", "Missing @earendil-works/pi-coding-agent peerDependency.");
  const readme = readText("README.md");
  if (!readme.includes(`currently\n\`${floor}\``) && !readme.includes(`currently ${floor}`)) {
    fail("README.md", `Supported-platforms pi floor must match package.json (${floor}).`);
  }
}

function checkGeneratedFilesExist() {
  for (const file of GENERATED_FILES) {
    if (!existsSync(path.join(ROOT, file))) fail(file, "Generated file is missing.");
  }
}

function checkExtensionReadmes() {
  for (const dir of extensionDirs()) {
    const base = `extensions/${dir}`;
    const readmePath = `${base}/README.md`;
    if (!existsSync(path.join(ROOT, readmePath))) {
      fail(readmePath, "Extension README is missing.");
      continue;
    }
    const readme = readText(readmePath);
    const manifest = readJson(`${base}/manifest.json`);
    for (const message of validateExtensionReadmeContract(readme, manifest)) {
      fail(readmePath, message);
    }
    if (!readme.includes("<!-- GENERATED:file-structure:start -->")) {
      fail(readmePath, "Missing generated file-structure start marker.");
    }
    if (!readme.includes("<!-- GENERATED:file-structure:end -->")) {
      fail(readmePath, "Missing generated file-structure end marker.");
    }

    if (!new RegExp(`^#\\s+${escapeRegex(manifest.name)}\\s*$`, "m").test(readme)) {
      fail(readmePath, `H1 must match manifest name: # ${manifest.name}`);
    }
    for (const command of manifest.commands ?? []) {
      if (!readme.includes(command))
        warn(readmePath, `Command ${command} is not mentioned in README.`);
    }
    for (const tool of manifest.tools ?? []) {
      if (!readme.includes(tool)) warn(readmePath, `Tool ${tool} is not mentioned in README.`);
    }
    if (manifest.configurable && !existsSync(path.join(ROOT, base, "lib", "config-panel.ts"))) {
      fail(`${base}/manifest.json`, "configurable=true but lib/config-panel.ts is missing.");
    }
  }
}

function checkChangelog() {
  const changelog = readText("CHANGELOG.md");
  const unreleasedMatch = changelog.match(/^## Unreleased\s*\n([\s\S]*?)(?=^## \[|$)/m);
  const unreleased = unreleasedMatch?.[1] ?? "";
  const featureCount = (unreleased.match(/^###\s+Features\s*$/gm) ?? []).length;
  if (featureCount > 1) warn("CHANGELOG.md", "Unreleased section has duplicate Features headings.");
  for (const stale of ["stays at pi 0.70.3", "All seven packages", ">=0.70.3"]) {
    if (unreleased.includes(stale)) {
      fail("CHANGELOG.md", `Stale Unreleased phrase found: ${stale}`);
    }
  }
}

function checkManualEvidence() {
  for (const finding of scanTrackedManualEvidence(ROOT)) {
    fail(finding.file, finding.message);
  }
}

function checkPublicSafety() {
  for (const finding of scanTrackedPublicArtifacts(ROOT)) {
    fail(finding.file, finding.message, finding.detail);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function run() {
  checkReadmePiVersion();
  checkGeneratedFilesExist();
  checkExtensionReadmes();
  checkChangelog();
  checkManualEvidence();
  checkPublicSafety();

  const errors = findings.filter((finding) => finding.level === "error");
  if (JSON_MODE) {
    console.log(JSON.stringify({ ok: errors.length === 0, findings }, null, 2));
  } else if (findings.length === 0) {
    console.log("✅ Documentation health checks passed.");
  } else {
    for (const finding of findings) {
      const icon = finding.level === "error" ? "❌" : "⚠️";
      console.log(`${icon} ${finding.file}: ${finding.message}`);
      if (finding.detail) console.log(`   ${finding.detail}`);
    }
  }

  if (CHECK_ONLY && errors.length > 0) process.exit(1);
}

run();
