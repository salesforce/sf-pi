/* SPDX-License-Identifier: Apache-2.0 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const HUSKY_BIN = path.join(ROOT, "node_modules", "husky", "bin.js");

// pi installs git packages with runtime dependencies only. In that mode Husky is
// intentionally absent, so the prepare hook must stay silent for end users.
if (!existsSync(HUSKY_BIN) || !existsSync(path.join(ROOT, ".git"))) {
  process.exit(0);
}

const result = spawnSync(process.execPath, [HUSKY_BIN], {
  cwd: ROOT,
  stdio: "inherit",
});

if (result.error) {
  console.warn(`sf-pi: skipped Husky hook setup (${result.error.message})`);
  process.exit(0);
}

if (result.status && result.status !== 0) {
  console.warn(`sf-pi: skipped Husky hook setup (exit ${result.status})`);
}
