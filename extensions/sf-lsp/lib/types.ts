/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Minimal types for the sf-lsp extension.
 *
 * Only the LSP-related types that sf-lsp actually needs — no quality config,
 * validator, guardrail, or code analyzer types.
 */

// -------------------------------------------------------------------------------------------------
// Language types
// -------------------------------------------------------------------------------------------------

/**
 * Salesforce languages supported by this extension.
 */
export type SupportedLanguage = "apex" | "lwc" | "agentscript";

// -------------------------------------------------------------------------------------------------
// LSP diagnostic types
// -------------------------------------------------------------------------------------------------

/**
 * A single diagnostic from an LSP server.
 *
 * Severity levels (from the LSP spec):
 *   1 = Error, 2 = Warning, 3 = Information, 4 = Hint
 */
export interface LspDiagnostic {
  severity?: 1 | 2 | 3 | 4;
  message: string;
  source?: string;
  code?: string | number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

/**
 * Doctor status for one LSP language — reports availability and discovery info.
 */
export interface LspDoctorStatus {
  language: SupportedLanguage;
  available: boolean;
  source?: string;
  command?: string;
  detail: string;
}

/**
 * Result of diagnosing a single file.
 *
 * When the LSP server is unavailable, `unavailable` is set with the reason.
 * Otherwise, `diagnostics` contains the findings (may be empty for clean files).
 */
export interface LspResult {
  diagnostics: LspDiagnostic[];
  unavailable?: LspDoctorStatus;
}
