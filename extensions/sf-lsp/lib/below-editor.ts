/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Compact one-line widget rendered below the editor.
 *
 *   LSP · Foo.cls ok 312ms · Apex LWC AS
 *
 * The widget disappears once there has been no activity for
 * `STALE_THRESHOLD_MS`, so an otherwise-idle session doesn't carry a
 * misleading "last run" line forever.
 */
import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  LANGUAGE_ORDER,
  formatDuration,
  languageLabel,
  statusBadgeLabel,
  statusColor,
  statusGlyph,
  type LspActivityEntry,
  type LspActivityStore,
} from "./activity.ts";
import type { SupportedLanguage } from "./types.ts";

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export function buildBelowEditorLines(
  store: LspActivityStore,
  theme: Theme,
  now: number = Date.now(),
): string[] {
  if (!store.hasActivity) return [];

  const latest = findLatestEntry(store, now);
  if (!latest) return [];

  const prefix = theme.fg("muted", "LSP · ");
  const file = theme.fg("accent", latest.fileName ?? "(no file)");
  const badgeColor = statusColor(latest.status);
  const badge = theme.fg(badgeColor, theme.bold(statusBadgeLabel(latest.status)));
  const duration = theme.fg("dim", formatDuration(latest.durationMs));
  const errorSummary =
    latest.status === "error" && latest.diagnosticCount > 0
      ? ` ${theme.fg("error", `${latest.diagnosticCount} err`)}`
      : "";

  const langDots = LANGUAGE_ORDER.map((language) => renderLanguageDot(language, store, theme)).join(
    " ",
  );

  return [
    `${prefix}${file} ${badge} ${duration}${errorSummary} ${theme.fg("muted", "·")} ${langDots}`,
  ];
}

function renderLanguageDot(
  language: SupportedLanguage,
  store: LspActivityStore,
  theme: Theme,
): string {
  const entry = store.byLanguage.get(language);
  const status = entry?.status ?? "idle";
  const glyph = statusGlyph(status);
  const color = statusColor(status);
  return `${theme.fg(color, glyph)} ${theme.fg("dim", languageLabel(language))}`;
}

function findLatestEntry(store: LspActivityStore, now: number): LspActivityEntry | undefined {
  let latest: LspActivityEntry | undefined;
  for (const entry of store.byLanguage.values()) {
    if (!entry.updatedAt) continue;
    if (now - entry.updatedAt > STALE_THRESHOLD_MS) continue;
    if (!latest || (latest.updatedAt ?? 0) < entry.updatedAt) latest = entry;
  }
  return latest;
}
