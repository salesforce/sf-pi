/* SPDX-License-Identifier: Apache-2.0 */
/** Human-facing expanded SOQL Result Card renderer. */

import type {
  SoqlRunDigest,
  SoqlRunSection,
  DigestRow,
  ToolResult,
  SoqlApiCallRailItem,
} from "./types.ts";

const LABEL_WIDTH = 14;

export function renderSoqlResultMarkdown(result: ToolResult): string {
  const digest = asDigest(result.details?.digest);
  if (!digest) return result.content?.[0]?.text ?? "";

  const lines: string[] = [];
  const statusIcon = statusIconFor(digest.status);
  const meta = [digest.org?.alias, ...(digest.meta ?? [])].filter(Boolean).join(" · ");
  lines.push(`${statusIcon} ${digest.icon} ${digest.title}${meta ? ` · ${meta}` : ""}`);
  appendApiRail(lines, digest.api_calls);
  appendFullQuery(lines, digest);
  for (const section of digest.sections) appendSection(lines, section);
  return lines.join("\n");
}

function appendFullQuery(lines: string[], digest: SoqlRunDigest): void {
  const query = digest.query?.normalized ?? digest.query?.raw;
  if (!query) return;
  lines.push("");
  lines.push("—— 🧾 SOQL Query ——");
  for (const line of query.split(/\r?\n/)) lines.push(`  ${line}`);
  if (digest.query?.operation === "queryAll" && !/\bALL\s+ROWS\b/i.test(query)) {
    lines.push("  ALL ROWS");
  } else if (digest.query?.all_rows && digest.query.raw && digest.query.raw !== query) {
    lines.push("  ALL ROWS");
  }
}

function appendApiRail(lines: string[], calls: SoqlApiCallRailItem[] | undefined): void {
  if (!calls?.length) return;
  lines.push("   API");
  const max = 6;
  for (const call of calls.slice(0, max)) {
    const method = pad(call.method, 8);
    const detail = call.detail ? `  ${call.detail}` : "";
    lines.push(`   │ ${method} ${call.path}${detail}`);
  }
  if (calls.length > max) lines.push(`   │ … +${calls.length - max} more native calls in digest`);
}

function appendSection(lines: string[], section: SoqlRunSection): void {
  if (section.rows.length === 0) return;
  lines.push("");
  lines.push(`—— ${section.icon} ${section.title} ——`);
  for (const item of section.rows) lines.push(formatRow(item));
}

function formatRow(item: DigestRow): string {
  if (item.label.length <= LABEL_WIDTH)
    return `  ${item.icon} ${pad(item.label, LABEL_WIDTH)} ${item.value}`;
  return `  ${item.icon} ${item.label}\n     ${item.value}`;
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + " ".repeat(width - value.length);
}

function statusIconFor(status: SoqlRunDigest["status"]): string {
  if (status === "pass") return "✅";
  if (status === "fail") return "❌";
  if (status === "warning") return "⚠️";
  return "ℹ️";
}

function asDigest(value: unknown): SoqlRunDigest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SoqlRunDigest>;
  if (typeof candidate.action !== "string") return undefined;
  if (typeof candidate.title !== "string") return undefined;
  if (!Array.isArray(candidate.sections)) return undefined;
  return candidate as SoqlRunDigest;
}
