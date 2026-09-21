/* SPDX-License-Identifier: Apache-2.0 */
/** Artifact persistence for Flow diagnostics, topology, validation, and tests. */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import type { FlowArtifact } from "./types.ts";

const ROOT = globalAgentPath("sf-pi", "sf-flow");

export async function writeFlowArtifact(
  kind: string,
  filename: string,
  content: unknown,
): Promise<FlowArtifact> {
  const dir = path.join(ROOT, safeName(kind));
  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, safeName(filename));
  const text = typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
  await writeFile(fullPath, text, "utf8");
  return { path: fullPath, kind };
}

export function artifactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}
