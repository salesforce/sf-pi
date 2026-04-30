/* SPDX-License-Identifier: Apache-2.0 */
/** Width-safe rendering helpers for sf-pi-manager's TUI overlay and config panel. */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

export function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

export function safeTruncate(text: string, width: number, ellipsis = "…"): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  if (safeWidth === 0) return "";
  return truncateToWidth(text, safeWidth, ellipsis);
}

export function clampAnsiLine(text: string, width: number): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  if (safeWidth === 0) return "";
  if (visibleWidth(text) <= safeWidth) return text;

  for (let candidateWidth = safeWidth; candidateWidth >= 0; candidateWidth -= 1) {
    const candidate = truncateToWidth(text, candidateWidth, "");
    if (visibleWidth(candidate) <= safeWidth) return candidate;
  }

  return "";
}

export function clampAnsiLines(lines: string[], width: number): string[] {
  return lines.map((line) => clampAnsiLine(line, width));
}

export function wrapPlainText(text: string, width: number): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (visibleWidth(next) <= safeWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines;
}

export function wrapAnsiText(text: string, width: number): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const wrapped = wrapTextWithAnsi(text, safeWidth);
  return wrapped.length > 0 ? wrapped.map((line) => clampAnsiLine(line, safeWidth)) : [""];
}

export function collapsedHint(
  remainingLines: number,
  width: number,
  expandHint = "Ctrl+O to expand",
): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const candidates = [
    `… (${remainingLines} more lines • ${expandHint})`,
    `… (${remainingLines} more lines)`,
    `… (+${remainingLines})`,
    "…",
  ];

  for (const candidate of candidates) {
    if (visibleWidth(candidate) <= safeWidth) return candidate;
  }

  return safeTruncate(candidates[candidates.length - 1] ?? "", safeWidth, "");
}
