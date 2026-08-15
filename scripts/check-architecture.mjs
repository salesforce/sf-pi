/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Advisory source-architecture and blocking state-placement checks.
 *
 * Keep these findings separate from documentation health: they inspect source
 * module size and state-store placement rather than public documentation.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS_DIR = path.join(ROOT, "extensions");
const CHECK_ONLY = process.argv.includes("--check");
const JSON_MODE = process.argv.includes("--json");
const FILE_LOC_ADVISORY = 800;
const FILE_LOC_HARD_ADVISORY = 1500;
const findings = [];

function extensionDirs() {
  return readdirSync(EXTENSIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function addFinding(level, file, message, detail) {
  findings.push({ level, file, message, ...(detail ? { detail } : {}) });
}

function warn(file, message, detail) {
  addFinding("warn", file, message, detail);
}

function fail(file, message, detail) {
  addFinding("error", file, message, detail);
}

function checkExtensionFileSize() {
  for (const dir of extensionDirs()) {
    const base = path.join(EXTENSIONS_DIR, dir);
    const candidates = [];
    const index = path.join(base, "index.ts");
    if (existsSync(index)) candidates.push(index);
    const lib = path.join(base, "lib");
    if (existsSync(lib)) {
      for (const entry of readdirSync(lib, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".ts"))
          candidates.push(path.join(lib, entry.name));
      }
    }

    for (const file of candidates) {
      const loc = readFileSync(file, "utf8").split("\n").length;
      const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
      if (loc >= FILE_LOC_HARD_ADVISORY) {
        warn(
          relative,
          `File is ${loc} LOC (≥ ${FILE_LOC_HARD_ADVISORY}). Strongly consider splitting on next touch.`,
          "AGENTS.md editing rules: split by concrete responsibility. Advisory only — does not fail CI.",
        );
      } else if (loc >= FILE_LOC_ADVISORY) {
        warn(
          relative,
          `File is ${loc} LOC (≥ ${FILE_LOC_ADVISORY}). Consider splitting if you're already touching this file.`,
          "Advisory only — does not fail CI.",
        );
      }
    }
  }
}

function checkStateStoreLocation() {
  for (const dir of extensionDirs()) {
    const relative = `extensions/${dir}/lib/state-store.ts`;
    const candidate = path.join(ROOT, relative);
    if (!existsSync(candidate)) continue;
    const source = readFileSync(candidate, "utf8");
    if (!/from\s+"\.\.\/\.\.\/\.\.\/lib\/common\/state-store\.ts"/.test(source)) {
      fail(
        relative,
        "Per-user JSON state must delegate to lib/common/state-store.ts.",
        "See AGENTS.md → State placement.",
      );
    }
  }
}

checkExtensionFileSize();
checkStateStoreLocation();

const errors = findings.filter((finding) => finding.level === "error");
if (JSON_MODE) {
  console.log(JSON.stringify({ ok: errors.length === 0, findings }, null, 2));
} else if (findings.length === 0) {
  console.log("✅ Architecture checks passed.");
} else {
  for (const finding of findings) {
    const icon = finding.level === "error" ? "❌" : "⚠️";
    console.log(`${icon} ${finding.file}: ${finding.message}`);
    if (finding.detail) console.log(`   ${finding.detail}`);
  }
}

if (CHECK_ONLY && errors.length > 0) process.exit(1);
