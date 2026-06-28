/* SPDX-License-Identifier: Apache-2.0 */
/** Artifact persistence for SOQL runs, plans, schema, and flattened results. */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import type { SoqlArtifact } from "./types.ts";
import type { FlattenedRows } from "./flattener.ts";
import { toCsv } from "./flattener.ts";

const ROOT = globalAgentPath("sf-pi", "sf-soql");

export async function writeSoqlArtifact(
  kind: string,
  filename: string,
  content: unknown,
): Promise<SoqlArtifact> {
  const dir = path.join(ROOT, kind);
  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, safeName(filename));
  await writeFile(fullPath, toText(content), "utf8");
  return { path: fullPath, kind };
}

export async function writeRunBundle(params: {
  slug: string;
  query: string;
  raw: unknown;
  flattened: FlattenedRows;
  summary: unknown;
}): Promise<SoqlArtifact[]> {
  const dir = path.join(ROOT, "runs", `${artifactTimestamp()}-${safeName(params.slug)}`);
  await mkdir(dir, { recursive: true });
  const files: Array<[string, string, unknown]> = [
    ["query", "query.soql", params.query],
    ["raw", "result.raw.json", params.raw],
    ["flattened-json", "result.flattened.json", params.flattened.rawRows],
    ["flattened-csv", "result.flattened.csv", toCsv(params.flattened)],
    ["summary", "summary.json", params.summary],
  ];
  const artifacts: SoqlArtifact[] = [];
  for (const [kind, filename, content] of files) {
    const fullPath = path.join(dir, filename);
    await writeFile(fullPath, toText(content), "utf8");
    artifacts.push({ path: fullPath, kind });
  }
  return artifacts;
}

export function artifactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function safeName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function toText(content: unknown): string {
  return typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
}
