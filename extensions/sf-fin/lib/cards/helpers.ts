/* SPDX-License-Identifier: Apache-2.0 */
/** Shared helpers for SF Fin Result Card presenters. */
import type { FinRow, FinSpan, FinTone } from "../fin-card.ts";

/** Plain labels for the operations a fix names. */
export const FIX_LABEL: Record<string, string> = {
  package_install: "Install the Fin for Salesforce package",
  audit_fields_enable: "Turn on audit fields on record creation",
  digital_experiences_enable: "Turn on Digital Experiences (one-way)",
  enhanced_email_enable: "Turn on Enhanced Email",
  permissions_apply: "Create the Fin user and assign its permission sets",
  connect: "Connect Fin to this org",
  handoff_queue_create: "Create a Case queue for Fin's handoff",
};

export interface CardInput {
  text: string;
  ok: boolean;
  details: Record<string, unknown>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const STATUS_PREFIXES = ["✅", "❌", "⚠️", "⚠", "ℹ️", "ℹ", "⏳", "🧪"];

/** Drop one leading status emoji (the card shows status itself). */
export function stripStatus(line: string): string {
  const trimmed = line.trimStart();
  const prefix = STATUS_PREFIXES.find((p) => trimmed.startsWith(p));
  return prefix ? trimmed.slice(prefix.length).trimStart() : trimmed;
}

/** An operation's own step line (✅/⚠/❌ …) as a card row. */
export function stepRow(line: string): FinRow {
  const glyph = /^✅/u.test(line) ? "✓" : /^❌/u.test(line) ? "✕" : /^⏳/u.test(line) ? "…" : "⚠";
  return {
    icon: glyph,
    iconTone: glyph === "✓" ? "success" : glyph === "✕" ? "error" : "warning",
    value: stripStatus(line),
  };
}

/** Tool-call syntax stays in the model text; the card says it plainly. */
export function plainNext(next: string): string {
  const op = /operation='([a-z_]+)'/u.exec(next)?.[1];
  if (op && FIX_LABEL[op])
    return `${FIX_LABEL[op]}. The agent plans it first; you approve the change.`;
  if (/sf_fin |sdk operation=|allow_mutation/u.test(next))
    return "Ask the agent for the next step; it is in its result.";
  return next.replace(/\.$/u, "") + ".";
}

export function stateTone(state: string): FinTone {
  return state === "live"
    ? "success"
    : state === "draft"
      ? "warning"
      : state === "paused"
        ? "warning"
        : "muted";
}

export function stateGlyph(state: string): string {
  return state === "live" ? "●" : state === "paused" ? "‖" : state === "draft" ? "◐" : "○";
}

/** "check_salesforce_case_status" → "Check salesforce case status". */
export function readableName(name: string): string {
  return /^[a-z0-9_,]+$/u.test(name) ? humanize(name.replace(/,/gu, "")) : name;
}

export function quoted(text: string): string | undefined {
  return /"([^"]+)"/u.exec(text)?.[1];
}

/**
 * A short local time ("Fri 9:11 PM"), or the date for anything older than a
 * week. Uses the machine's time zone; undefined input stays undefined.
 */
export function localTime(iso: string | undefined, now: Date = new Date()): string | undefined {
  if (!iso) return undefined;
  const at = new Date(iso.replace(/\+0000$/u, "Z"));
  if (Number.isNaN(at.getTime())) return undefined;
  const ageDays = (now.getTime() - at.getTime()) / 86_400_000;
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (ageDays < 6.5 && ageDays > -1) {
    return `${at.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
  }
  return at.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: at.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function textLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

export function humanize(value: string): string {
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value
    : typeof value === "number"
      ? String(value)
      : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export type FinText = string | FinSpan[];
