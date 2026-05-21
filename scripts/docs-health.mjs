/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Documentation health checker.
 *
 * This script intentionally checks factual, easy-to-drift documentation
 * contracts instead of trying to judge prose quality. It is a guardrail for
 * agents and humans: generated blocks stay generated, hand-written docs keep
 * required sections, and public-facing docs avoid obvious private artifacts.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const EXTENSIONS_DIR = path.join(ROOT, "extensions");
const CHECK_ONLY = process.argv.includes("--check");
const JSON_MODE = process.argv.includes("--json");

const REQUIRED_README_SECTIONS = [
  "What It Does",
  "Runtime Flow",
  "Behavior Matrix",
  "File Structure",
  "Testing Strategy",
  "Troubleshooting",
];

const GENERATED_FILES = [
  "catalog/index.json",
  "catalog/registry.ts",
  "docs/extensions.md",
  "docs/.vitepress/generated-extension-sidebar.ts",
  "docs/commands.md",
  "docs/agent-orientation.md",
];

const PUBLIC_SAFETY_PATTERNS = [
  {
    id: "salesforce-sandbox-host",
    regex: /[a-z0-9-]+--[a-z0-9-]+\.sandbox\.my\.salesforce\.com/i,
    message: "Salesforce sandbox hostnames must not appear in public docs.",
  },
  {
    id: "slack-permalink",
    regex: /https:\/\/[^\s)]+\.slack\.com\/archives\//i,
    message: "Slack permalinks must not appear in public docs.",
  },
  {
    id: "slack-team-id",
    regex: /\bT(?!0{2}|01XYZ)[0-9][A-Z0-9]{7,}\b/,
    message: "Slack team IDs must not appear in public docs.",
  },
  {
    id: "slack-user-id",
    regex: /\bU(?!0{2}|01ABC)[0-9][A-Z0-9]{7,}\b/,
    message: "Slack user IDs must not appear in public docs; use generic examples.",
  },
  {
    id: "slack-channel-id",
    regex: /\bC(?!0{2}|01ABC|09Z)[0-9][A-Z0-9]{7,}\b/,
    message: "Slack channel IDs must not appear in public docs; use generic examples.",
  },
  {
    id: "specific-customer-name",
    regex: /\bVivint\b/i,
    message: "Customer-specific names must not appear in public docs.",
  },
];

const ALLOWED_PUBLIC_SAFETY_MATCHES = new Set([
  // Generic Slack examples in docs/changelog, not real workspace IDs.
  "CHANGELOG.md:183:slack-user-id",
  "CHANGELOG.md:227:slack-user-id",
  "CHANGELOG.md:957:slack-user-id",
  "extensions/sf-slack/README.md:372:slack-user-id",
]);

const findings = [];

function rel(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, "/");
}

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

function listFiles(dir, predicate) {
  const root = path.join(ROOT, dir);
  const files = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "vendor") continue;
        walk(full);
      } else if (entry.isFile()) {
        const relative = rel(full);
        if (predicate(relative)) files.push(relative);
      }
    }
  }
  if (existsSync(root)) walk(root);
  return files.sort((left, right) => left.localeCompare(right));
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

function checkRecommendationTable() {
  const recommendations = readJson("catalog/recommendations.json");
  const defaultBundle = recommendations.bundles.find((bundle) => bundle.id === "default");
  if (!defaultBundle) return fail("catalog/recommendations.json", "Missing default bundle.");
  const readme = readText("README.md");
  const word = numberWord(defaultBundle.items.length);
  if (!readme.includes(`All ${word} packages`)) {
    fail("README.md", `Default bundle prose should say "All ${word} packages".`);
  }
  for (const itemId of defaultBundle.items) {
    if (!readme.includes(`\`${itemId}\``) && !readme.includes(`**[\`${itemId}\``)) {
      fail("README.md", `Recommended bundle item ${itemId} is missing from the table.`);
    }
  }
}

function numberWord(value) {
  const words = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
  ];
  return words[value] ?? String(value);
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
    for (const section of REQUIRED_README_SECTIONS) {
      if (!new RegExp(`^##\\s+${escapeRegex(section)}\\s*$`, "m").test(readme)) {
        fail(readmePath, `Missing required section: ## ${section}`);
      }
    }
    if (!readme.includes("<!-- GENERATED:file-structure:start -->")) {
      fail(readmePath, "Missing generated file-structure start marker.");
    }
    if (!readme.includes("<!-- GENERATED:file-structure:end -->")) {
      fail(readmePath, "Missing generated file-structure end marker.");
    }

    const manifest = readJson(`${base}/manifest.json`);
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

function checkManifestToolsMatchCode() {
  // Enforce two things at once:
  // 1. Every tool name listed in manifest.tools is actually registered in source.
  // 2. The tool registration follows the standard module shape so agents always
  //    know where to look:
  //      - either lib/<tool>-tool.ts exports `register<PascalCase>Tool`, or
  //      - any lib/*.ts file in the extension calls `pi.registerTool({ name: "<tool>", ... })`.
  //
  // Documented in AGENTS.md → "Tool registration convention".
  for (const dir of extensionDirs()) {
    const base = `extensions/${dir}`;
    const manifestPath = `${base}/manifest.json`;
    if (!existsSync(path.join(ROOT, manifestPath))) continue;
    const manifest = readJson(manifestPath);
    const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
    if (tools.length === 0) continue;

    const libDir = path.join(ROOT, base, "lib");
    const libFiles = existsSync(libDir)
      ? readdirSync(libDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
          .map((entry) => path.join(libDir, entry.name))
      : [];
    const indexFile = path.join(ROOT, base, "index.ts");
    const allFiles = [indexFile, ...libFiles];
    const allSource = allFiles
      .filter((p) => existsSync(p))
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");

    // Two-step check:
    //   1. Some file in the extension calls pi.registerTool(...).
    //   2. The exact tool-name string literal appears somewhere in source.
    // This tolerates the common pattern of declaring `export const X_TOOL_NAME = "x"`
    // and passing the constant to `name:` (sf-data360), without false positives
    // from other extensions: a typo in manifest.tools wouldn't match the literal.
    const hasRegisterCall = /\bpi\.registerTool\s*[<(]/.test(allSource);
    if (!hasRegisterCall) {
      fail(
        manifestPath,
        `manifest.tools is non-empty but no pi.registerTool() call was found in index.ts or lib/.`,
      );
      continue;
    }
    for (const tool of tools) {
      const literalPattern = new RegExp(`["\`']${escapeRegex(tool)}["\`']`);
      if (!literalPattern.test(allSource)) {
        fail(
          manifestPath,
          `Tool "${tool}" listed in manifest.tools but the exact name literal was not found in index.ts or lib/. Either fix the manifest typo or expose the name via a const string.`,
        );
      }
    }
  }
}

// Per-file LOC advisory thresholds. AGENTS.md §3 calls out "if 200 lines
// could be 50, rewrite it." In practice we use a softer informational
// threshold so growth is visible during PR review without forcing today's
// refactor. Output is `warn`-level only — it never fails CI.
const FILE_LOC_ADVISORY = 800;
const FILE_LOC_HARD_ADVISORY = 1500;

function checkExtensionFileSize() {
  for (const dir of extensionDirs()) {
    const baseAbs = path.join(ROOT, "extensions", dir);
    if (!existsSync(baseAbs)) continue;
    const candidates = [];
    const indexAbs = path.join(baseAbs, "index.ts");
    if (existsSync(indexAbs)) candidates.push(indexAbs);
    const libAbs = path.join(baseAbs, "lib");
    if (existsSync(libAbs)) {
      try {
        for (const entry of readdirSync(libAbs, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          if (!entry.name.endsWith(".ts")) continue;
          candidates.push(path.join(libAbs, entry.name));
        }
      } catch {
        // ignore unreadable lib/ directories
      }
    }

    for (const file of candidates) {
      const text = readFileSync(file, "utf8");
      const loc = text.split("\n").length;
      const rel = path.relative(ROOT, file).replaceAll(path.sep, "/");
      if (loc >= FILE_LOC_HARD_ADVISORY) {
        warn(
          rel,
          `File is ${loc} LOC (≥ ${FILE_LOC_HARD_ADVISORY}). Strongly consider splitting on next touch.`,
          "AGENTS.md \u00a73: split by responsibility. Advisory only \u2014 does not fail CI.",
        );
      } else if (loc >= FILE_LOC_ADVISORY) {
        warn(
          rel,
          `File is ${loc} LOC (≥ ${FILE_LOC_ADVISORY}). Consider splitting if you're already touching this file.`,
          "Advisory only \u2014 does not fail CI.",
        );
      }
    }
  }
}

function checkStateStoreLocation() {
  // Q4 of the AGENTS.md state-persistence decision tree (per-user JSON state)
  // must use the shared lib/common/state-store.ts helper. We enforce that by
  // forbidding `state-store.ts` from existing inside any extension's lib/.
  // Documented in docs/adr/0006-extension-consistency-baseline.md.
  for (const dir of extensionDirs()) {
    const candidate = path.join(ROOT, "extensions", dir, "lib", "state-store.ts");
    if (!existsSync(candidate)) continue;
    const text = readText(`extensions/${dir}/lib/state-store.ts`);
    // Allowed when the file is a thin delegator that imports the shared
    // helper from lib/common/state-store.ts. Other shapes — bespoke fs I/O,
    // hand-rolled JSON read/write — fail the lint.
    if (!/from\s+"\.\.\/\.\.\/\.\.\/lib\/common\/state-store\.ts"/.test(text)) {
      fail(
        `extensions/${dir}/lib/state-store.ts`,
        "Per-user JSON state must delegate to lib/common/state-store.ts. See AGENTS.md \u2192 'state-persistence decision tree'.",
      );
    }
  }
}

function checkManifestEventsMatchCode() {
  for (const dir of extensionDirs()) {
    const base = `extensions/${dir}`;
    const manifestPath = `${base}/manifest.json`;
    const indexPath = `${base}/index.ts`;
    if (!existsSync(path.join(ROOT, manifestPath)) || !existsSync(path.join(ROOT, indexPath))) {
      continue;
    }

    const manifest = readJson(manifestPath);
    const manifestEvents = new Set(manifest.events ?? []);
    const code = readText(indexPath);
    const codeEvents = new Set(
      [...code.matchAll(/\bpi\.on\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]),
    );

    for (const event of codeEvents) {
      if (!manifestEvents.has(event)) {
        fail(manifestPath, `Missing event from manifest: ${event}`);
      }
    }
    for (const event of manifestEvents) {
      if (!codeEvents.has(event)) {
        fail(manifestPath, `Manifest lists event not registered in index.ts: ${event}`);
      }
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
    if (changelog.includes(stale)) fail("CHANGELOG.md", `Stale docs phrase found: ${stale}`);
  }
}

function checkPublicSafety() {
  const docs = listFiles(".", (file) => {
    if (!file.endsWith(".md")) return false;
    if (file.startsWith("node_modules/")) return false;
    return true;
  });

  for (const file of docs) {
    const lines = readText(file).split("\n");
    lines.forEach((line, index) => {
      for (const pattern of PUBLIC_SAFETY_PATTERNS) {
        if (!pattern.regex.test(line)) continue;
        const key = `${file}:${index + 1}:${pattern.id}`;
        if (ALLOWED_PUBLIC_SAFETY_MATCHES.has(key)) continue;
        fail(file, pattern.message, `line ${index + 1}: ${line.trim()}`);
      }
    });
  }
}

function checkDocOwnership() {
  if (!existsSync(path.join(ROOT, "docs/doc-ownership.json"))) {
    fail("docs/doc-ownership.json", "Doc ownership map is missing.");
    return;
  }
  try {
    readJson("docs/doc-ownership.json");
  } catch (error) {
    fail("docs/doc-ownership.json", `Invalid JSON: ${error.message}`);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function run() {
  checkReadmePiVersion();
  checkRecommendationTable();
  checkGeneratedFilesExist();
  checkExtensionReadmes();
  checkExtensionFileSize();
  checkStateStoreLocation();
  checkManifestEventsMatchCode();
  checkManifestToolsMatchCode();
  checkChangelog();
  checkPublicSafety();
  checkDocOwnership();

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
