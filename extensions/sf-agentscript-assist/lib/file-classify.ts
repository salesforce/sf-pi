/* SPDX-License-Identifier: Apache-2.0 */
/**
 * File classification helpers for sf-agentscript-assist.
 *
 * Only `.agent` files are handled by this extension. Everything else is
 * deliberately ignored.
 */

import path from "node:path";

/**
 * True for paths that should be diagnosed by this extension.
 *
 * Case-insensitive; handles Windows backslash paths.
 */
export function isAgentScriptFile(filePath: string): boolean {
  return filePath.replace(/\\/g, "/").toLowerCase().endsWith(".agent");
}

/**
 * Normalize a tool-supplied path into an absolute filesystem path.
 *
 * Matches the behavior of sf-lsp so both extensions resolve paths the same
 * way:
 *  - Pi's `@` prefix for repo-relative paths is stripped.
 *  - Relative paths are resolved against `cwd`.
 *  - Already-absolute paths are preserved.
 */
export function resolveToolPath(inputPath: string, cwd: string): string {
  const cleaned = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
  if (path.isAbsolute(cleaned)) {
    return path.resolve(cleaned);
  }
  return path.resolve(cwd, cleaned);
}
