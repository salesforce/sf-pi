#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Ensure every .ts / .mjs source file in the repo starts with the SPDX
 * Apache-2.0 header.
 *
 * Usage:
 *   node scripts/add-spdx-headers.mjs                 # scan whole repo, write missing
 *   node scripts/add-spdx-headers.mjs --check         # scan whole repo, exit 1 if missing
 *   node scripts/add-spdx-headers.mjs path/a.ts path/b.mjs   # scope to given files
 *   node scripts/add-spdx-headers.mjs --check path/a.ts      # --check on given files
 *
 * Positional-args mode is how lint-staged wires us into the pre-commit
 * hook: we get only the staged files and quietly add the header when it's
 * missing so the developer doesn't discover the omission in CI. Whole-repo
 * mode (`--check`) is what CI's Validate job runs.
 *
 * This script is idempotent. Files that already have the header are skipped.
 * Generated files in catalog/registry.ts and catalog/index.json are excluded
 * because the generator rewrites them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const HEADER = "/* SPDX-License-Identifier: Apache-2.0 */";
const EXTS = new Set([".ts", ".mjs"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "dist", "coverage", "docs", "vendor"]);
const EXCLUDE_FILES = new Set([
  "catalog/registry.ts", // generated
]);

const checkMode = process.argv.includes("--check");
// Any non-flag argument is treated as an explicit file path. When at least
// one is present we run in "scoped" mode and skip the whole-repo scan.
// Paths may be absolute (what lint-staged passes) or repo-relative; we
// normalize to repo-relative below so EXCLUDE_FILES matches still work.
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));

function listFiles() {
  if (positional.length > 0) {
    const cwd = process.cwd();
    return positional.map((p) => {
      const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
      const rel = path.relative(cwd, abs);
      // Fall back to the raw path if relative() would step outside cwd
      // (shouldn't happen in practice but keeps the script robust).
      return rel.startsWith("..") ? abs : rel;
    });
  }
  // Prefer `git ls-files` to honor .gitignore; fall back to find.
  try {
    const out = execSync("git ls-files", { encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    const out = execSync(
      `find . -type f \\( -name "*.ts" -o -name "*.mjs" \\) -not -path "./node_modules/*" -not -path "./.git/*"`,
      { encoding: "utf8" },
    );
    return out
      .split("\n")
      .filter(Boolean)
      .map((p) => p.replace(/^\.\//, ""));
  }
}

function shouldProcess(file) {
  const ext = path.extname(file);
  if (!EXTS.has(ext)) return false;
  if (EXCLUDE_FILES.has(file)) return false;
  const parts = file.split(path.sep);
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return false;
  return true;
}

function hasHeader(content) {
  // Accept either the exact one-line form or an existing comment that
  // includes the SPDX identifier on the first few lines.
  const firstChunk = content.slice(0, 200);
  return /SPDX-License-Identifier:\s*Apache-2\.0/.test(firstChunk);
}

function addHeader(content) {
  // Preserve leading shebang if present.
  if (content.startsWith("#!")) {
    const nl = content.indexOf("\n");
    return `${content.slice(0, nl + 1)}${HEADER}\n${content.slice(nl + 1)}`;
  }
  return `${HEADER}\n${content}`;
}

const files = listFiles().filter(shouldProcess);
const missing = [];
let changed = 0;

for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (hasHeader(content)) continue;
  missing.push(file);
  if (!checkMode) {
    writeFileSync(file, addHeader(content), "utf8");
    changed += 1;
  }
}

if (checkMode) {
  if (missing.length > 0) {
    console.error(`Missing SPDX header in ${missing.length} file(s):`);
    for (const f of missing) console.error(`  - ${f}`);
    console.error("\nRun: node scripts/add-spdx-headers.mjs");
    process.exit(1);
  }
  console.log(`✅ All ${files.length} source files have SPDX headers.`);
  process.exit(0);
}

console.log(`✅ Added SPDX header to ${changed} file(s). Skipped ${files.length - changed}.`);
