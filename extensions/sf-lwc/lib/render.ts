/* SPDX-License-Identifier: Apache-2.0 */
/** Human-facing expanded LWC Result Card renderer. */

import type {
  DigestRow,
  LwcLocalRailItem,
  LwcRunDigest,
  LwcRunSection,
  ToolResult,
} from "./types.ts";

const LABEL_WIDTH = 15;

export function renderLwcResultMarkdown(result: ToolResult): string {
  const digest = asDigest(result.details?.digest);
  if (!digest) return result.content?.[0]?.text ?? "";

  const lines: string[] = [];
  const statusIcon = statusIconFor(digest.status);
  const meta = [digest.workspace?.project_root, ...(digest.meta ?? [])].filter(Boolean).join(" · ");
  lines.push(`${statusIcon} ${digest.icon} ${digest.title}${meta ? ` · ${meta}` : ""}`);
  appendLocalRail(lines, digest.local_rail);
  for (const section of digest.sections) appendSection(lines, section);
  appendRecommendations(lines, digest);
  if (digest.artifacts?.length) {
    appendSection(lines, {
      icon: "📦",
      title: "Artifacts",
      rows: digest.artifacts.slice(0, 6).map((artifact) => ({
        icon: "📄",
        label: artifact.kind,
        value: artifact.path,
      })),
    });
    if (digest.artifacts.length > 6)
      lines.push(`  📄 more            +${digest.artifacts.length - 6} more artifacts`);
  }
  if (digest.next_step) {
    lines.push("");
    lines.push("—— ➡️ Next Step ——");
    lines.push(`  ${digest.next_step}`);
  }
  return lines.join("\n");
}

function appendLocalRail(lines: string[], rail: LwcLocalRailItem[] | undefined): void {
  if (!rail?.length) return;
  lines.push("   Local");
  const max = 6;
  for (const item of rail.slice(0, max)) {
    const kind = pad(item.kind, 10);
    const detail = item.detail ? `  ${item.detail}` : "";
    lines.push(`   │ ${kind} ${item.target}${detail}`);
  }
  if (rail.length > max) lines.push(`   │ … +${rail.length - max} more local entries in digest`);
}

function appendRecommendations(lines: string[], digest: LwcRunDigest): void {
  const rows: DigestRow[] = [];
  for (const skill of digest.recommended_skills ?? [])
    rows.push({ icon: "🧠", label: "skill", value: skill });
  for (const tool of digest.recommended_tools ?? [])
    rows.push({ icon: "🛠️", label: "tool", value: tool });
  if (rows.length) appendSection(lines, { icon: "🧠", title: "Recommended Guidance", rows });
}

function appendSection(lines: string[], section: LwcRunSection): void {
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

function statusIconFor(status: LwcRunDigest["status"]): string {
  if (status === "pass") return "✅";
  if (status === "fail") return "❌";
  if (status === "warning") return "⚠️";
  return "ℹ️";
}

function asDigest(value: unknown): LwcRunDigest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<LwcRunDigest>;
  if (typeof candidate.action !== "string") return undefined;
  if (typeof candidate.title !== "string") return undefined;
  if (!Array.isArray(candidate.sections)) return undefined;
  return candidate as LwcRunDigest;
}
