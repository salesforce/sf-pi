/* SPDX-License-Identifier: Apache-2.0 */
/** Map d360_metadata summaries into the standard Data 360 result card. */

import type { D360MetadataInput } from "../metadata-tool.ts";
import type { D360ResultCard, D360ResultSection } from "./card.ts";

export interface MetadataCardOptions {
  targetOrg?: string;
  rawOutputPath?: string;
}

export function metadataResultToCard(
  input: D360MetadataInput,
  summaryText: string,
  details: Record<string, unknown>,
  opts: MetadataCardOptions = {},
): D360ResultCard {
  const isList = input.action === "list_dmos" || input.action === "list_dlos";
  return isList
    ? metadataListCard(input, summaryText, details, opts)
    : metadataDescribeCard(input, summaryText, details, opts);
}

function metadataListCard(
  input: D360MetadataInput,
  summaryText: string,
  details: Record<string, unknown>,
  opts: MetadataCardOptions,
): D360ResultCard {
  const label = input.action === "list_dmos" ? "DMOs" : "DLOs";
  const count = numberValue(details.count);
  const shown = numberValue(details.shownCount);
  const unfiltered = numberValue(details.unfilteredCount);
  const categoryCounts = objectValue(details.categoryCounts);
  const objectLines = extractMarkdownTableRows(summaryText).slice(0, 10);
  const sections: D360ResultSection[] = [];
  if (objectLines.length) sections.push({ title: label, icon: "📚", lines: objectLines });
  const categoryLine = Object.entries(categoryCounts)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(", ");
  if (categoryLine) sections.push({ title: "Categories", icon: "🏷️", lines: [categoryLine] });

  return withArtifact(
    {
      status: "success",
      icon: "🗂️",
      title: `Data 360 ${label}`,
      subtitle: [
        opts.targetOrg,
        input.action,
        count === undefined ? undefined : `${count} ${label}`,
      ]
        .filter(Boolean)
        .join(" · "),
      summary: firstLine(summaryText) ?? `Found ${count ?? 0} ${label}.`,
      facts: [
        fact("Count", count),
        fact("Showing", shown),
        fact("Unfiltered", unfiltered),
        input.category ? { label: "Category filter", value: input.category } : undefined,
      ].filter((f): f is { label: string; value: string } => Boolean(f)),
      sections,
      nextSteps: [
        `Use d360_metadata describe_${input.action === "list_dmos" ? "dmo" : "dlo"} for field-level detail.`,
      ],
    },
    opts.rawOutputPath,
  );
}

function metadataDescribeCard(
  input: D360MetadataInput,
  summaryText: string,
  details: Record<string, unknown>,
  opts: MetadataCardOptions,
): D360ResultCard {
  const apiName = stringValue(details.apiName) ?? input.api_name ?? "(unknown)";
  const fieldCount = numberValue(details.fieldCount);
  const shownFieldCount = numberValue(details.shownFieldCount);
  const header = parseDescriptionHeader(summaryText);
  const fieldLines = extractMarkdownTableRows(summaryText).slice(0, 12);

  return withArtifact(
    {
      status: "success",
      icon: "🗂️",
      title: "Data 360 metadata",
      subtitle: [
        opts.targetOrg,
        apiName,
        fieldCount === undefined ? undefined : `${fieldCount} fields`,
      ]
        .filter(Boolean)
        .join(" · "),
      summary: header.label ? `${header.label} schema.` : `Metadata for ${apiName}.`,
      facts: [
        { label: "API name", value: apiName },
        header.category ? { label: "Category", value: header.category } : undefined,
        header.dataSpace ? { label: "Data space", value: header.dataSpace } : undefined,
        fact("Fields", fieldCount),
        fact("Showing", shownFieldCount),
      ].filter((f): f is { label: string; value: string } => Boolean(f)),
      sections: fieldLines.length
        ? [{ title: "Fields", icon: "🔤", lines: fieldLines }]
        : undefined,
      nextSteps: ["Use d360 execute d360_query_sql with verified field names for data sampling."],
    },
    opts.rawOutputPath,
  );
}

function withArtifact(card: D360ResultCard, rawOutputPath: string | undefined): D360ResultCard {
  if (!rawOutputPath) return card;
  return {
    ...card,
    artifacts: [{ label: "Full JSON", path: rawOutputPath, kind: "json" }],
  };
}

function parseDescriptionHeader(text: string): {
  label?: string;
  category?: string;
  dataSpace?: string;
} {
  const lines = text.split(/\r?\n/);
  return {
    label: lines[0]?.trim() || undefined,
    category: valueAfterPrefix(lines, "Category:"),
    dataSpace: valueAfterPrefix(lines, "Data space:"),
  };
}

function valueAfterPrefix(lines: string[], prefix: string): string | undefined {
  const line = lines.find((entry) => entry.startsWith(prefix));
  return line?.slice(prefix.length).trim() || undefined;
}

function extractMarkdownTableRows(text: string): string[] {
  const rows: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    if (/^\|\s*-+/.test(line)) continue;
    if (/^\|\s*(Category|Field)\s*\|/.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/^`|`$/g, ""));
    if (cells.length >= 3) rows.push(formatTableRow(cells));
  }
  return rows;
}

function formatTableRow(cells: string[]): string {
  if (cells.length >= 6) {
    const [field, label, type, primary, mapped, usage] = cells;
    const flags = [
      primary ? "primary" : undefined,
      mapped ? "mapped" : undefined,
      usage || undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    return `• ${field}${label ? ` — ${label}` : ""}${type ? ` · ${type}` : ""}${flags ? ` · ${flags}` : ""}`;
  }
  const [category, display, apiName] = cells;
  return `• ${display || apiName}${apiName ? ` — ${apiName}` : ""}${category ? ` · ${category}` : ""}`;
}

function fact(
  label: string,
  value: number | undefined,
): { label: string; value: string } | undefined {
  return value === undefined ? undefined : { label, value: String(value) };
}

function firstLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
