#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Generate sanitized Instruction Surface JSON/Markdown through the exact Pi runtime. */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Run Pi's CLI entry with this Node binary: node_modules/.bin/pi is a shell
// script (or a .cmd wrapper on Windows) that cannot be spawned portably.
const piCli = path.join(
  repoRoot,
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "bundle",
  "cli.js",
);
const fixture = path.join(repoRoot, "scripts", "fixtures", "instruction-surface-probe.ts");
const outputDir = resolveOutput(process.argv.slice(2));
mkdirSync(outputDir, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    piCli,
    "--offline",
    "--approve",
    "--no-session",
    "-e",
    fixture,
    "--print",
    "/sf-pi-instruction-surface-probe",
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      PI_OFFLINE: "1",
      SF_PI_INSTRUCTION_SURFACE_PACKAGE_ROOT: repoRoot,
      SF_PI_INSTRUCTION_SURFACE_OUTPUT: outputDir,
      SF_PI_INSTRUCTION_SURFACE_INCLUDE_BUNDLED_CONTEXT: "1",
    },
    encoding: "utf8",
    timeout: 30_000,
  },
);

if (result.status !== 0) {
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

console.log(`Instruction Surface report written to:`);
console.log(`- ${path.join(outputDir, "report.json")}`);
console.log(`- ${path.join(outputDir, "report.md")}`);

function resolveOutput(argv) {
  const index = argv.indexOf("--output");
  if (index >= 0) {
    const value = argv[index + 1];
    if (!value) throw new Error("--output requires a directory.");
    return path.resolve(process.cwd(), value);
  }
  return path.join(repoRoot, ".pi", "state", "sf-brain", "instruction-surface");
}
