/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Footer status segment for sf-lsp.
 *
 * Produces the string consumed by `ctx.ui.setStatus("sf-lsp", …)` and
 * picked up by sf-devbar via `footerData.getExtensionStatuses()`. Kept as
 * a tiny pure function so it's trivially unit-testable with a stub theme.
 *
 * Output examples:
 *   LSP:●●●  (apex=clean, lwc=clean, agentscript=clean)
 *   LSP:●●○  (agentscript unavailable)
 *   LSP:●✗●  (lwc has errors)
 */
import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  LANGUAGE_ORDER,
  languageLabel,
  statusColor,
  statusGlyph,
  type LspActivityStore,
} from "./activity.ts";

export function formatFooterStatus(store: LspActivityStore, theme: Theme): string {
  const dots: string[] = [];
  const labels: string[] = [];

  for (const language of LANGUAGE_ORDER) {
    const entry = store.byLanguage.get(language);
    const status = entry?.status ?? "idle";
    const color = statusColor(status);
    const glyph = statusGlyph(status);
    dots.push(theme.fg(color, glyph));
    labels.push(languageLabel(language));
  }

  const prefix = theme.fg("muted", "LSP:");
  const labelTail = theme.fg("dim", ` ${labels.join("·")}`);
  return `${prefix}${dots.join("")}${labelTail}`;
}
