/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Summarize documentation impact from changed files.
 *
 * Agents use this after a code diff to avoid guessing which docs need review.
 * It does not modify files; it prints deterministic guidance from path rules.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function changedFiles() {
  const base = process.env.DOCS_CHANGED_BASE || "origin/main...HEAD";
  try {
    const out = execSync(`git diff --name-only ${base}`, { cwd: ROOT, encoding: "utf8" }).trim();
    if (out) return out.split("\n").filter(Boolean);
  } catch {
    // Fall through to local working tree diff.
  }
  const out = execSync("git diff --name-only HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  return out ? out.split("\n").filter(Boolean) : [];
}

function add(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

const files = changedFiles();
const docs = new Map();

for (const file of files) {
  const extensionMatch = file.match(/^extensions\/([^/]+)\//);
  if (extensionMatch) {
    const id = extensionMatch[1];
    add(docs, `extensions/${id}`, `Review extensions/${id}/README.md`);
    if (file.includes("/lib/") || file.endsWith("/index.ts")) {
      add(docs, `extensions/${id}`, "Run npm run generate-catalog to refresh generated file map");
    }
    if (file.endsWith("manifest.json")) {
      add(
        docs,
        `extensions/${id}`,
        "Run npm run generate-catalog; root README/catalog/docs may change",
      );
    }
    if (file.includes("send") || file.includes("canvas") || file.includes("guardrail")) {
      add(docs, `extensions/${id}`, `Review extensions/${id}/AGENTS.md for safety-surface changes`);
    }
  }

  if (file === "package.json" || file === "package-lock.json") {
    add(
      docs,
      "runtime/deps",
      "Review README Supported platforms and CONTRIBUTING scripts/dependencies",
    );
    add(docs, "runtime/deps", "Review CHANGELOG Unreleased for dependency/runtime floor changes");
  }
  if (file.startsWith("scripts/")) {
    add(
      docs,
      "scripts",
      "Review ARCHITECTURE.md Important scripts and CONTRIBUTING.md script reference",
    );
  }
  if (file.startsWith(".github/workflows/")) {
    add(docs, "ci", "Review CONTRIBUTING.md validation/CI sections and ROADMAP shipped automation");
  }
  if (file === "catalog/recommendations.json") {
    add(
      docs,
      "recommendations",
      "Review README Recommended Extensions and run npm run generate-catalog",
    );
  }
  if (file === "catalog/announcements.json" || file === "CHANGELOG.md") {
    add(
      docs,
      "announcements",
      "Run npm run generate-catalog to refresh release announcement metadata",
    );
  }
}

if (files.length === 0) {
  console.log("No changed files detected.");
  process.exit(0);
}

console.log("Changed files:");
for (const file of files) console.log(`- ${file}`);
console.log("");

if (docs.size === 0) {
  console.log("No documentation impact rules matched.");
  process.exit(0);
}

console.log("Documentation impact:");
for (const [area, items] of [...docs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`\n${area}`);
  for (const item of [...items].sort()) console.log(`- ${item}`);
}
