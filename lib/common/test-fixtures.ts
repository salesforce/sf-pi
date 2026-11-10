/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared constants for test fixtures.
 *
 * When the repo URL changes (e.g., fork, rename, move), update this file
 * in one place instead of every test that embeds a literal package source.
 */

import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Canonical package source used throughout test fixtures. */
export const TEST_PACKAGE_SOURCE = "git:github.com/salesforce/sf-pi";

/**
 * Write a fake CLI that runs `source` (a Node script body) and is spawnable by
 * bare name or path on every platform: an executable shebang file on macOS and
 * Linux, a `.js` file plus an npm-style `.cmd` wrapper on Windows. Returns the
 * path to spawn. Test-only.
 */
export function writeFakeNodeCli(file: string, source: string): string {
  const script = `#!/usr/bin/env node\n${source}\n`;
  if (process.platform !== "win32") {
    writeFileSync(file, script, "utf8");
    chmodSync(file, 0o755);
    return file;
  }
  writeFileSync(`${file}.js`, script, "utf8");
  writeFileSync(
    `${file}.cmd`,
    `@ECHO off\r\n"%_prog%"  "%dp0%\\${path.basename(file)}.js" %*\r\n`,
    "utf8",
  );
  return `${file}.cmd`;
}
