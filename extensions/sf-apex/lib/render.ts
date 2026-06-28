/* SPDX-License-Identifier: Apache-2.0 */
/** Human-facing expanded Apex Result Card renderer. */

import type {
  ApexApiCallRailItem,
  ApexRunDigest,
  ApexRunSection,
  DigestRow,
  ToolResult,
} from "./types.ts";

const LABEL_WIDTH = 12;

export function renderApexResultMarkdown(result: ToolResult): string {
  const digest = asDigest(result.details?.digest);
  if (!digest) return result.content?.[0]?.text ?? "";

  const lines: string[] = [];
  const statusIcon = statusIconFor(digest.status);
  const meta = [digest.org?.alias, ...(digest.meta ?? [])].filter(Boolean).join(" · ");
  lines.push(`${statusIcon} ${digest.icon} ${digest.title}${meta ? ` · ${meta}` : ""}`);
  appendApiRail(lines, digest.api_calls);

  for (const section of digest.sections) {
    if (isHiddenHumanSection(section)) continue;
    appendSection(lines, section);
  }

  return lines.join("\n");
}

function appendApiRail(lines: string[], calls: ApexApiCallRailItem[] | undefined): void {
  if (!calls?.length) return;
  lines.push("   API");
  const max = 6;
  for (const call of calls.slice(0, max)) {
    const method = pad(call.method, 8);
    const detail = call.detail ? ` ${call.detail}` : "";
    lines.push(`   │ ${method} ${call.path}${detail ? `  ${detail}` : ""}`);
  }
  if (calls.length > max) lines.push(`   │ … +${calls.length - max} more native calls in digest`);
}

function isHiddenHumanSection(section: ApexRunSection): boolean {
  return section.title === "Evidence" || section.title === "Next";
}

function appendSection(lines: string[], section: ApexRunSection): void {
  if (section.rows.length === 0) return;
  lines.push("");
  lines.push(sectionTitle(section.icon, section.title));
  for (const row of section.rows) lines.push(formatRow(row));
}

function sectionTitle(icon: string, title: string): string {
  return `—— ${icon} ${title} ——`;
}

function formatRow(row: DigestRow): string {
  return `  ${row.icon} ${pad(row.label, LABEL_WIDTH)} ${row.value}`;
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + " ".repeat(width - value.length);
}

function statusIconFor(status: ApexRunDigest["status"]): string {
  if (status === "pass") return "✅";
  if (status === "fail") return "❌";
  if (status === "warning") return "⚠️";
  return "ℹ️";
}

function asDigest(value: unknown): ApexRunDigest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ApexRunDigest>;
  if (typeof candidate.action !== "string") return undefined;
  if (typeof candidate.title !== "string") return undefined;
  if (!Array.isArray(candidate.sections)) return undefined;
  return candidate as ApexRunDigest;
}
