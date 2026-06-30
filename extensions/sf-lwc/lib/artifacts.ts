/* SPDX-License-Identifier: Apache-2.0 */
/** Artifact persistence for LWC scans, diagnostics, and local Jest runs. */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import type { LwcArtifact } from "./types.ts";

const ROOT = globalAgentPath("sf-pi", "sf-lwc");

export async function writeLwcArtifact(
  kind: string,
  filename: string,
  content: unknown,
): Promise<LwcArtifact> {
  const dir = path.join(ROOT, kind);
  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, safeName(filename));
  await writeFile(fullPath, toText(content), "utf8");
  return { path: fullPath, kind };
}

export async function writeLwcBundle(
  kind: string,
  slug: string,
  files: Array<{ filename: string; kind: string; content: unknown }>,
): Promise<LwcArtifact[]> {
  const dir = path.join(ROOT, kind, `${artifactTimestamp()}-${safeName(slug)}`);
  await mkdir(dir, { recursive: true });
  const artifacts: LwcArtifact[] = [];
  for (const file of files) {
    const fullPath = path.join(dir, safeName(file.filename));
    await writeFile(fullPath, toText(file.content), "utf8");
    artifacts.push({ path: fullPath, kind: file.kind });
  }
  return artifacts;
}

export function artifactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function safeName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function toText(content: unknown): string {
  return typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
}
