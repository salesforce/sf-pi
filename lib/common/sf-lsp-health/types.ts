/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared type for the three Salesforce LSP languages tracked by sf-lsp.
 * Mirrors `extensions/sf-lsp/lib/types.ts` `SupportedLanguage` — kept
 * here so shared modules don't import across extension boundaries.
 */
export type SupportedLspLanguage = "apex" | "lwc" | "agentscript";

/** Human-friendly full-name label used in the sf-devbar top bar. */
export function languageFullName(language: SupportedLspLanguage): string {
  switch (language) {
    case "apex":
      return "Apex";
    case "lwc":
      return "LWC";
    case "agentscript":
      return "AgentScript";
  }
}
