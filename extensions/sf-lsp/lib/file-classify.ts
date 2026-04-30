/* SPDX-License-Identifier: Apache-2.0 */
/**
 * File classification helpers for sf-lsp.
 *
 * Maps file paths to Salesforce LSP languages and resolves tool paths
 * into absolute filesystem paths.
 */

import path from "node:path";
import type { SupportedLanguage } from "./types.ts";

/**
 * Regular expression for supported LWC component files.
 *
 * Matches: force-app/.../lwc/myComponent/myComponent.js (or .html)
 */
const LWC_FILE_PATTERN = /\/lwc\/[^/]+\/[^/]+\.(js|html)$/i;

/**
 * Decide which Salesforce LSP should handle a file.
 *
 * Returns `null` for unsupported files so callers can skip them.
 */
export function getSfLspLanguageForFile(filePath: string): SupportedLanguage | null {
  const normalized = filePath.replace(/\\/g, "/");

  if (normalized.endsWith(".agent")) {
    return "agentscript";
  }

  if (normalized.endsWith(".cls") || normalized.endsWith(".trigger")) {
    return "apex";
  }

  if (LWC_FILE_PATTERN.test(normalized)) {
    return "lwc";
  }

  return null;
}

/**
 * Normalize a tool path into an absolute filesystem path.
 *
 * Handles:
 * - Pi's `@` prefix on repo-relative paths
 * - Relative paths resolved against cwd
 * - Already-absolute paths
 */
export function resolveToolPath(inputPath: string, cwd: string): string {
  const cleaned = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;

  if (path.isAbsolute(cleaned)) {
    return path.resolve(cleaned);
  }

  return path.resolve(cwd, cleaned);
}

/**
 * Get the LSP language ID string to send in textDocument/didOpen.
 *
 * This maps our internal language names to the language IDs that each
 * LSP server expects.
 */
export function getLspLanguageId(language: SupportedLanguage, filePath: string): string {
  switch (language) {
    case "apex":
      return "apex";
    case "agentscript":
      return "agentscript";
    case "lwc":
      return filePath.endsWith(".html") ? "html" : "javascript";
  }
}
