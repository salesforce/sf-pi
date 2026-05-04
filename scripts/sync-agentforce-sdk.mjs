#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Sync the @agentscript/agentforce SDK dist into sf-agentscript-assist.
 *
 * Intended for CI and maintainers only. Not run on end-user npm install.
 *
 * Usage:
 *   node scripts/sync-agentforce-sdk.mjs                  # pin to UPSTREAM_SHA below
 *   node scripts/sync-agentforce-sdk.mjs --ref <sha|tag>  # override pin
 *   node scripts/sync-agentforce-sdk.mjs --check          # no writes, exit 1 if out of date
 *
 * What it does:
 *   1. Shallow-clone salesforce/agentscript at a pinned commit SHA into a temp dir.
 *   2. pnpm install --ignore-scripts (native tree-sitter isn't needed for the
 *      parser-javascript build variant).
 *   3. pnpm --filter '@agentscript/agentforce...' build (builds dependency graph
 *      up to and including agentforce).
 *   4. Copy dist/browser.js, dist/browser.js.map, dist/index.d.ts to
 *      extensions/sf-agentscript-assist/lib/vendor/agentforce/.
 *      We pick browser.js because it is a single self-contained ESM bundle with
 *      no external peer imports — compile() and parse() work in Node out of the
 *      box.
 *   5. Write UPSTREAM.md with commit SHA, upstream version, sync date, and the
 *      Apache-2.0 NOTICE excerpt.
 *
 * If you change the pinned SHA, commit the new vendored files alongside.
 *
 * CAUTION: The vendored bundle is source-agnostic — we do not edit it. If
 * upstream changes break us, bump the pin to a working SHA instead of patching.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// -------------------------------------------------------------------------------------------------
// Pinned upstream — bump intentionally, CI will PR a diff when the weekly
// workflow detects drift.
// -------------------------------------------------------------------------------------------------

const UPSTREAM_REPO = "https://github.com/salesforce/agentscript.git";
const UPSTREAM_SHA = "b98c087bd09d91de7f4cc1bfe829a98be573aaa6";

// -------------------------------------------------------------------------------------------------
// Paths
// -------------------------------------------------------------------------------------------------

const VENDOR_DIR = path.join(
  ROOT,
  "extensions",
  "sf-agentscript-assist",
  "lib",
  "vendor",
  "agentforce",
);

const VENDORED_FILES = [
  { src: "packages/agentforce/dist/browser.js", dest: "browser.js" },
  { src: "packages/agentforce/dist/browser.js.map", dest: "browser.js.map" },
  { src: "packages/agentforce/dist/index.d.ts", dest: "index.d.ts" },
];

// -------------------------------------------------------------------------------------------------
// CLI parsing
// -------------------------------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { ref: UPSTREAM_SHA, check: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ref" && args[i + 1]) {
      result.ref = args[++i];
    } else if (args[i] === "--check") {
      result.check = true;
    }
  }
  return result;
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function readBytes(filePath) {
  try {
    return readFileSync(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function readTextIfPresent(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return "";
    throw error;
  }
}

function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.equals(b);
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function buildUpstream(workdir, ref) {
  console.log(`→ Cloning ${UPSTREAM_REPO} at ${ref}...`);
  run("git", ["init", "-q"], workdir);
  run("git", ["remote", "add", "origin", UPSTREAM_REPO], workdir);
  run("git", ["fetch", "--depth=1", "origin", ref], workdir);
  run("git", ["checkout", "-q", "FETCH_HEAD"], workdir);

  const upstreamVersion = JSON.parse(
    readFileSync(path.join(workdir, "packages/agentforce/package.json"), "utf8"),
  ).version;
  const resolvedSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workdir,
    encoding: "utf8",
  }).trim();

  console.log(
    `→ Upstream @agentscript/agentforce@${upstreamVersion} (${resolvedSha.slice(0, 10)})`,
  );

  // Use pnpm via npx so contributors don't need a global install.
  // --ignore-scripts avoids the native tree-sitter build which isn't needed for
  // the parser-javascript variant we vendor.
  console.log(`→ pnpm install --ignore-scripts ...`);
  run("npx", ["-y", "pnpm@10.33.1", "install", "--ignore-scripts", "--frozen-lockfile"], workdir);

  // Build only the packages the agentforce SDK needs, skipping the native
  // tree-sitter variant (which requires a `tree-sitter` CLI binary that is
  // not needed for the parser-javascript bundle we actually vendor).
  const buildFilters = [
    "@agentscript/types",
    "@agentscript/parser-javascript",
    "@agentscript/parser",
    "@agentscript/language",
    "@agentscript/compiler",
    "@agentscript/agentscript-dialect",
    "@agentscript/agentforce-dialect",
    "@agentscript/agentfabric-dialect",
    "@agentscript/agentforce",
  ];
  const filterArgs = buildFilters.flatMap((name) => ["--filter", name]);

  console.log(`→ pnpm ${filterArgs.join(" ")} build ...`);
  run("npx", ["-y", "pnpm@10.33.1", ...filterArgs, "build"], workdir);

  return { resolvedSha, upstreamVersion };
}

function writeUpstreamMd(resolvedSha, upstreamVersion, syncDate) {
  const short = resolvedSha.slice(0, 10);
  return `# Vendored: @agentscript/agentforce

This directory contains a build of the \`@agentscript/agentforce\` SDK from
[salesforce/agentscript](https://github.com/salesforce/agentscript), vendored so
that \`sf-agentscript-assist\` works offline, on plain \`npm install\`, without
requiring pnpm or a network round-trip.

**Do not edit the bundled files.** If upstream behavior needs to change, bump
the pin via \`scripts/sync-agentforce-sdk.mjs\` and commit the regenerated
bundle.

## Pin

- Upstream: https://github.com/salesforce/agentscript
- Commit: \`${resolvedSha}\` (\`${short}\`)
- Package version: \`@agentscript/agentforce@${upstreamVersion}\`
- Synced: ${syncDate}
- Build variant: parser-javascript (pure TS, no native/WASM deps)

## Files

| File | Purpose |
| --- | --- |
| \`browser.js\` | Self-contained ESM bundle of the SDK. Works in Node. |
| \`browser.js.map\` | Source map for the bundle. |
| \`index.d.ts\` | Bundled TypeScript declarations for the SDK. |

We vendor the \`browser.js\` bundle (not \`index.js\`) because it is a single
file with all dependencies inlined. \`index.js\` declares its workspace peers
(\`@agentscript/language\`, \`@agentscript/compiler\`, \`@agentscript/parser\`)
as external and would require us to vendor them too.

## License

The vendored code is distributed under the Apache License 2.0, identical to
this repository's license. Upstream copyright is held by Salesforce, Inc.
See the upstream repository for the full license text.

## Regenerating

Do not edit the vendored files by hand. To pick up an upstream fix:

\`\`\`bash
# 1. Update UPSTREAM_SHA in scripts/sync-agentforce-sdk.mjs
# 2. Run:
node scripts/sync-agentforce-sdk.mjs

# 3. Commit the result. CI runs the same script with --check so drift is caught.
\`\`\`

CI runs \`scripts/sync-agentforce-sdk.mjs --check\` on every PR to ensure the
committed vendor output matches what the pinned commit produces.
`;
}

// -------------------------------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------------------------------

function main() {
  const { ref, check } = parseArgs();

  if (check && !existsSync(VENDOR_DIR)) {
    console.error(`❌ Vendor directory missing: ${path.relative(ROOT, VENDOR_DIR)}`);
    console.error(`   Run: node scripts/sync-agentforce-sdk.mjs`);
    process.exit(1);
  }

  const workdir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-agentforce-sync-"));
  console.log(`→ Workdir: ${workdir}`);

  let resolvedSha;
  let upstreamVersion;
  try {
    const built = buildUpstream(workdir, ref);
    resolvedSha = built.resolvedSha;
    upstreamVersion = built.upstreamVersion;

    ensureDir(VENDOR_DIR);

    let drift = false;

    for (const file of VENDORED_FILES) {
      const srcPath = path.join(workdir, file.src);
      const destPath = path.join(VENDOR_DIR, file.dest);

      const newBytes = readBytes(srcPath);
      if (!newBytes) {
        throw new Error(`Expected build output missing: ${file.src}`);
      }
      const currentBytes = readBytes(destPath);

      if (!bytesEqual(currentBytes, newBytes)) {
        drift = true;
        if (!check) {
          writeFileSync(destPath, newBytes);
          console.log(`✅ Wrote ${path.relative(ROOT, destPath)} (${newBytes.length} bytes)`);
        } else {
          console.error(`❌ Drift: ${path.relative(ROOT, destPath)}`);
        }
      } else {
        console.log(`✓ Up to date: ${path.relative(ROOT, destPath)}`);
      }
    }

    // Write UPSTREAM.md
    const syncDate = new Date().toISOString().slice(0, 10);
    const upstreamMd = writeUpstreamMd(resolvedSha, upstreamVersion, syncDate);
    const upstreamMdPath = path.join(VENDOR_DIR, "UPSTREAM.md");
    const currentMd = readTextIfPresent(upstreamMdPath);

    // Ignore the `Synced:` line when comparing — it changes every run.
    const normalize = (s) => s.replace(/^- Synced: .*$/m, "");
    if (normalize(currentMd) !== normalize(upstreamMd)) {
      if (!check) {
        writeFileSync(upstreamMdPath, upstreamMd);
        console.log(`✅ Wrote ${path.relative(ROOT, upstreamMdPath)}`);
      } else {
        drift = true;
        console.error(`❌ Drift: ${path.relative(ROOT, upstreamMdPath)}`);
      }
    } else {
      console.log(`✓ Up to date: ${path.relative(ROOT, upstreamMdPath)}`);
    }

    if (check && drift) {
      console.error("");
      console.error("Vendored @agentscript/agentforce is out of date.");
      console.error("Run: node scripts/sync-agentforce-sdk.mjs");
      process.exit(1);
    }
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }

  console.log("");
  console.log(`✅ Synced @agentscript/agentforce@${upstreamVersion} (${resolvedSha.slice(0, 10)})`);
}

main();
