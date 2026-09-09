/* SPDX-License-Identifier: Apache-2.0 */
/** Pure SF Docs footer classification and compact DevBar rendering. */
import type { EndpointResolution, TokenSource } from "./types.ts";

export type DocsFooterKind = "not-configured" | "setup" | "ready";

export interface DocsFooterTheme {
  fg(color: string, text: string): string;
}

export interface DocsFooterStatusInput {
  icon: string;
  kind: DocsFooterKind;
}

export function classifyDocsFooterStatus(input: {
  tokenSource: TokenSource;
  endpoint: EndpointResolution;
}): DocsFooterKind {
  const tokenConfigured = input.tokenSource !== "none";
  const endpointOk = input.endpoint.ok === true;
  const endpointPresent = input.endpoint.source !== "none";
  if (tokenConfigured && endpointOk) return "ready";
  if (!tokenConfigured && !endpointPresent) return "not-configured";
  return "setup";
}

/**
 * Render a compact Docs pill.
 *
 * Fully unconfigured stays off the bar so public installs stay quiet.
 * Partial setup (token XOR endpoint, or an invalid URL) is the upgrade footgun.
 */
export function formatDocsFooterStatus(
  input: DocsFooterStatusInput,
  theme: DocsFooterTheme,
): string | null {
  if (input.kind === "not-configured") return null;
  const prefix = `${input.icon} ${theme.fg("dim", "Docs")}`;
  if (input.kind === "setup") return `${prefix} ${theme.fg("warning", "! setup")}`;
  return `${prefix} ${theme.fg("success", "✓")}`;
}
