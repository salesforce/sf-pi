#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Git-install load smoke test.
 *
 * Reproduces how Pi installs SF Pi from git: copy the tracked tree into a
 * temporary directory, run `npm install --omit=dev --legacy-peer-deps`
 * (devDependencies and peerDependencies absent), then load every extension
 * through Pi's real extension loader, which aliases Pi's bundled modules.
 * A runtime import that only resolves in this repo's dev install fails here
 * the same way it fails for users.
 *
 * Uses this repo's dev copy of @earendil-works/pi-coding-agent as the host.
 * Network: npm registry (production dependencies only).
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const loaderPath = path.join(
  repoRoot,
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "core",
  "extensions",
  "loader.js",
);
if (!existsSync(loaderPath)) {
  console.error("❌ Pi's extension loader is missing; run npm ci first.");
  process.exit(1);
}

const work = mkdtempSync(path.join(tmpdir(), "sf-pi-git-install-"));
const keep = process.argv.includes("--keep");
try {
  // Files a commit of this tree would contain: tracked plus untracked files
  // that are not gitignored (so a local run before `git add` matches CI).
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repoRoot },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    const from = path.join(repoRoot, file);
    if (existsSync(from)) cpSync(from, path.join(work, file), { recursive: false });
  }
  execFileSync(
    "npm",
    ["install", "--omit=dev", "--legacy-peer-deps", "--no-audit", "--no-fund", "--ignore-scripts"],
    { cwd: work, stdio: ["ignore", "ignore", "inherit"] },
  );
  for (const devOnly of ["typebox", "typescript", "vitest"]) {
    if (existsSync(path.join(work, "node_modules", devOnly))) {
      throw new Error(`${devOnly} is present after --omit=dev; the install does not match Pi's.`);
    }
  }

  const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
  const entries = readdirSync(path.join(work, "extensions"))
    .map((name) => path.join(work, "extensions", name, "index.ts"))
    .filter((file) => existsSync(file))
    .sort();
  const result = await loadExtensions(entries, work);
  const errors = (result.errors ?? []).map((error) => ({
    extension: path.relative(work, error.path ?? ""),
    error: String(error.error ?? error.message ?? error).split("\n")[0],
  }));
  if (errors.length > 0) {
    console.error(
      `❌ ${errors.length} of ${entries.length} extensions failed to load from a git-style install:`,
    );
    for (const e of errors) console.error(`  - ${e.extension}: ${e.error}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ git-install load check passed (${entries.length} extensions)`);
  }
} finally {
  if (!keep) rmSync(work, { recursive: true, force: true });
  else console.log(`kept ${work}`);
}
