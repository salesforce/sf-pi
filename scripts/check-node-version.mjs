/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const requiredVersion = extractNodeRuntimeFloor(packageJson.engines?.node) ?? "22.19.0";
const required = parseVersion(requiredVersion);
const current = parseVersion(process.versions.node);

function parseVersion(value) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(value));
  return {
    major: Number.parseInt(match?.[1] ?? "0", 10),
    minor: Number.parseInt(match?.[2] ?? "0", 10),
    patch: Number.parseInt(match?.[3] ?? "0", 10),
  };
}

function extractNodeRuntimeFloor(range) {
  const match = />=\s*v?(\d+(?:\.\d+){0,2})/.exec(String(range ?? ""));
  if (!match) return undefined;
  const parsed = parseVersion(match[1]);
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function isTooOld(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key];
  }
  return false;
}

if (isTooOld(current, required)) {
  console.error(`
sf-pi requires Node.js >=${requiredVersion}.
Detected Node.js ${process.version}.

Install or switch to Node 22, then reinstall pi and sf-pi:
  nvm install 22
  nvm use 22
  npm install -g --ignore-scripts @earendil-works/pi-coding-agent
  pi install git:github.com/salesforce/sf-pi
`);
  process.exit(1);
}
