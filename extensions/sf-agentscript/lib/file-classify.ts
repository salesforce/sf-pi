/* SPDX-License-Identifier: Apache-2.0 */
/**
 * File classification helpers for sf-agentscript.
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
 * Behavior:
 *  - Pi's `@` prefix is stripped and the result is anchored to `cwd`.
 *  - Relative paths are resolved against `cwd`. The final path MUST stay
 *    inside `cwd`; `..` traversal that escapes the workspace is rejected.
 *  - Absolute paths are trusted (the caller explicitly typed an absolute
 *    path) but `..` segments before resolution are still rejected so the
 *    LLM can't smuggle escapes past a cursory review of its own arguments.
 *
 * Throws PathEscapeError on rejection. Tools should map this to a clean
 * INVALID_PATH error for the LLM.
 */
export class PathEscapeError extends Error {
  readonly code = "PATH_OUTSIDE_WORKSPACE";
  constructor(
    message: string,
    readonly inputPath: string,
    readonly resolvedPath: string,
  ) {
    super(message);
  }
}

function containsTraversal(p: string): boolean {
  // Match a literal `..` segment, not `...` or `..foo`.
  return /(^|[\\/])\.\.([\\/]|$)/.test(p);
}

function isInside(child: string, parent: string): boolean {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  if (c === p) return true;
  const sep = path.sep;
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

export function resolveToolPath(inputPath: string, cwd: string): string {
  const isAtPrefixed = inputPath.startsWith("@");
  const cleaned = isAtPrefixed ? inputPath.slice(1) : inputPath;

  if (path.isAbsolute(cleaned)) {
    if (containsTraversal(cleaned)) {
      throw new PathEscapeError(
        `Path contains '..' traversal segments: ${inputPath}`,
        inputPath,
        cleaned,
      );
    }
    return path.resolve(cleaned);
  }

  const resolved = path.resolve(cwd, cleaned);
  if (!isInside(resolved, cwd)) {
    throw new PathEscapeError(
      `Relative path escapes the workspace: ${inputPath} -> ${resolved}. ` +
        `Use an absolute path if the file lives outside the workspace.`,
      inputPath,
      resolved,
    );
  }
  return resolved;
}
