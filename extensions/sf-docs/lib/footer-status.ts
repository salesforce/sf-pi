/* SPDX-License-Identifier: Apache-2.0 */
/** Pure SF Docs footer classification and compact DevBar rendering. */
import type { EndpointResolution } from "./types.ts";

export type DocsFooterKind = "not-configured" | "setup" | "ready";

export interface DocsFooterTheme {
  fg(color: string, text: string): string;
}

export interface DocsFooterStatusInput {
  icon: string;
  kind: DocsFooterKind;
}

export function classifyDocsFooterStatus(endpoint: EndpointResolution): DocsFooterKind {
  if (endpoint.ok) return "ready";
  return endpoint.source === "none" ? "not-configured" : "setup";
}

/** Render a compact Docs pill without exposing the configured endpoint. */
export function formatDocsFooterStatus(
  input: DocsFooterStatusInput,
  theme: DocsFooterTheme,
): string | null {
  if (input.kind === "not-configured") return null;
  const prefix = `${input.icon} ${theme.fg("dim", "Docs")}`;
  if (input.kind === "setup") return `${prefix} ${theme.fg("warning", "! setup")}`;
  return `${prefix} ${theme.fg("success", "✓")}`;
}
