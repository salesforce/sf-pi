/* SPDX-License-Identifier: Apache-2.0 */
/** Digest builders for the SF LWC lifecycle tool. */

import type { DigestRow, LwcRunDigest, LwcRunSection, SfLwcAction } from "./types.ts";

export function row(icon: string, label: string, value: unknown): DigestRow {
  return { icon, label, value: stringify(value) };
}

export function section(icon: string, title: string, rows: DigestRow[]): LwcRunSection {
  return { icon, title, rows };
}

export function buildDigest(
  input: Partial<LwcRunDigest> & { action: SfLwcAction; title: string },
): LwcRunDigest {
  return {
    action: input.action,
    kind: input.kind ?? input.action,
    status: input.status ?? "info",
    icon: input.icon ?? "🧩",
    title: input.title,
    workspace: input.workspace,
    scope: input.scope,
    meta: input.meta,
    local_rail: input.local_rail,
    sections: input.sections ?? [],
    artifacts: input.artifacts,
    primary_reason: input.primary_reason,
    next_step: input.next_step,
    recommended_tools: input.recommended_tools,
    recommended_skills: input.recommended_skills,
  };
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
}
