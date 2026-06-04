#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Report the exact official AgentScript packages SF Pi uses.
 *
 * This is a maintainer convenience for intentional package refreshes. It does
 * not mutate package.json/package-lock.json; use npm install --save-exact for
 * the specific packages you choose to bump.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGES = [
  { name: "@sf-agentscript/agentforce", kind: "direct" },
  { name: "@sf-agentscript/compiler", kind: "transitive" },
  { name: "@sf-agentscript/language", kind: "direct" },
  { name: "@sf-agentscript/lsp", kind: "direct" },
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function declaredVersions() {
  const pkg = readJson(path.join(ROOT, "package.json"));
  return pkg.dependencies ?? {};
}

function lockVersion(packageName) {
  try {
    const lock = readJson(path.join(ROOT, "package-lock.json"));
    return lock.packages?.[`node_modules/${packageName}`]?.version;
  } catch {
    return undefined;
  }
}

async function latestVersion(packageName) {
  try {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName).replace("%40", "@")}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return undefined;
    const body = await response.json();
    return body?.["dist-tags"]?.latest;
  } catch {
    return undefined;
  }
}

const deps = declaredVersions();
const rows = [];
for (const pkg of PACKAGES) {
  const declared = deps[pkg.name];
  const resolved = lockVersion(pkg.name);
  const latest = await latestVersion(pkg.name);
  rows.push({
    package: pkg.name,
    kind: pkg.kind,
    declared: declared ?? "—",
    resolved: resolved ?? "—",
    latest: typeof latest === "string" ? latest : "unknown",
    status:
      typeof latest === "string" && resolved
        ? latest === resolved
          ? "current"
          : "update available"
        : "unknown",
  });
}

console.table(rows);
console.log("\nIntentional refresh workflow:");
console.log(
  "  npm install --save-exact @sf-agentscript/agentforce@<version> @sf-agentscript/language@<version> @sf-agentscript/lsp@<version>",
);
console.log("  npm run check && npm test && npm run generate-catalog:check");
console.log("\nNote: @sf-agentscript/compiler is transitive through @sf-agentscript/agentforce.");
