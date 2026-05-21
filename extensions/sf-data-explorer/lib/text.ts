/* SPDX-License-Identifier: Apache-2.0 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type ThemeLike = {
  bold: (s: string) => string;
  fg: (color: string, s: string) => string;
};

export function fit(text: string, width: number): string {
  return truncateToWidth(text, Math.max(0, width), "…");
}

export function pad(text: string, width: number): string {
  const fitted = fit(text, width);
  return fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted)));
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function isBackspaceKey(data: string): boolean {
  return data === "\x7f" || data === "\b" || data === "\x08";
}

export function wrapPlain(text: string, width: number, maxLines = 100): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = raw;
    if (!line.length) {
      out.push("");
      continue;
    }
    while (visibleWidth(line) > width) {
      out.push(fit(line, width));
      if (out.length >= maxLines) return out;
      const consumed = Math.max(1, Math.floor(width * 0.85));
      if (consumed >= line.length) {
        line = "";
        break;
      }
      line = line.slice(consumed);
    }
    if (line.length > 0) {
      out.push(line);
      if (out.length >= maxLines) return out;
    }
  }
  return out;
}

export function quoteData360Identifier(identifier: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)
    ? identifier
    : `"${identifier.replace(/"/g, '""')}"`;
}

export function timestampForFile(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function safeFilePart(text: string): string {
  return (
    text
      .replace(/[^A-Za-z0-9_.-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "result"
  );
}
