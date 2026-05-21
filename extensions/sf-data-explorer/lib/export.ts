/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import path from "node:path";
import type { RunResult, SpaRow } from "./types.ts";
import { formatValue, safeFilePart, timestampForFile } from "./text.ts";

export type ExportFormat = "json" | "csv";

function csvEscape(value: unknown): string {
  const text = formatValue(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function rowsToCsv(rows: SpaRow[], columns: string[]): string {
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvEscape(row[c])).join(","));
  return `${lines.join("\n")}\n`;
}

export function resultToJsonEnvelope(result: RunResult): string {
  return `${JSON.stringify(
    {
      mode: result.mode,
      targetOrg: result.targetOrg,
      apiVersion: result.apiVersion,
      query: result.query,
      exportedAt: new Date().toISOString(),
      totalReturned: result.totalReturned,
      columns: result.columns,
      rows: result.rows,
    },
    null,
    2,
  )}\n`;
}

export async function saveResult(args: {
  cwd: string;
  result: RunResult;
  baseName: string;
  format: ExportFormat;
}): Promise<string> {
  const dir = path.join(args.cwd, ".sf-data-explorer", "exports");
  await fs.mkdir(dir, { recursive: true });
  const filename = `${safeFilePart(args.baseName)}-${timestampForFile()}.${args.format}`;
  const file = path.join(dir, filename);
  const content =
    args.format === "json"
      ? resultToJsonEnvelope(args.result)
      : rowsToCsv(args.result.rows, args.result.columns);
  await fs.writeFile(file, content, "utf8");
  return file;
}
