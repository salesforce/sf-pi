#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fail when package-lock.json gains a new dependency install script without
 * review. Install scripts execute during npm installs unless callers pass
 * --ignore-scripts, so every allowed entry should be small, known, and
 * intentional.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const LOCK_PATH = path.join(ROOT, "package-lock.json");

const ALLOWED_INSTALL_SCRIPT_PACKAGES = new Map([
  ["", "sf-pi root prepare hook; guarded to no-op during pi git package installs."],
  [
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@google/genai",
    "nested dev dependency from pi-coding-agent model tooling.",
  ],
  [
    "node_modules/@earendil-works/pi-coding-agent/node_modules/protobufjs",
    "nested dev dependency from pi-coding-agent Google client tooling.",
  ],
  ["node_modules/@google/genai", "dev dependency from pi-ai model tooling."],
  ["node_modules/esbuild", "dev dependency from VitePress/Vite docs-site bundling."],
  ["node_modules/fsevents", "optional native watcher used by development tooling."],
  ["node_modules/protobufjs", "dev dependency from Google client tooling."],
]);

function readLockfile() {
  try {
    return JSON.parse(readFileSync(LOCK_PATH, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${path.relative(ROOT, LOCK_PATH)}: ${message}`, {
      cause: error,
    });
  }
}

function installScriptPackages(lockfile) {
  const packages = lockfile?.packages;
  if (!packages || typeof packages !== "object") {
    throw new Error("package-lock.json is missing the top-level packages object.");
  }

  return Object.entries(packages)
    .filter(([, pkg]) => pkg && typeof pkg === "object" && pkg.hasInstallScript === true)
    .map(([packagePath, pkg]) => ({
      packagePath,
      version: typeof pkg.version === "string" ? pkg.version : undefined,
      dev: pkg.dev === true,
      optional: pkg.optional === true,
    }))
    .sort((a, b) => a.packagePath.localeCompare(b.packagePath));
}

function displayPath(packagePath) {
  return packagePath === "" ? "<root>" : packagePath;
}

function main() {
  const packages = installScriptPackages(readLockfile());
  const unexpected = packages.filter(
    (pkg) => !ALLOWED_INSTALL_SCRIPT_PACKAGES.has(pkg.packagePath),
  );
  const staleAllowlist = [...ALLOWED_INSTALL_SCRIPT_PACKAGES.keys()].filter(
    (allowed) => !packages.some((pkg) => pkg.packagePath === allowed),
  );

  if (unexpected.length || staleAllowlist.length) {
    console.error("Lifecycle-script allowlist drift detected.\n");
    if (unexpected.length) {
      console.error("Unexpected packages with install scripts:");
      for (const pkg of unexpected) {
        console.error(
          `  - ${displayPath(pkg.packagePath)}${pkg.version ? `@${pkg.version}` : ""}` +
            `${pkg.dev ? " (dev)" : ""}${pkg.optional ? " (optional)" : ""}`,
        );
      }
      console.error("");
    }
    if (staleAllowlist.length) {
      console.error("Allowlist entries no longer present in package-lock.json:");
      for (const packagePath of staleAllowlist) {
        console.error(
          `  - ${displayPath(packagePath)} — ${ALLOWED_INSTALL_SCRIPT_PACKAGES.get(packagePath)}`,
        );
      }
      console.error("");
    }
    console.error(
      "If this drift is intentional, update ALLOWED_INSTALL_SCRIPT_PACKAGES in scripts/check-lifecycle-scripts.mjs with a public-safe rationale.",
    );
    process.exit(1);
  }

  console.log(
    `✅ lifecycle-script allowlist check passed (${packages.length} allowed install script package${packages.length === 1 ? "" : "s"})`,
  );
}

main();
