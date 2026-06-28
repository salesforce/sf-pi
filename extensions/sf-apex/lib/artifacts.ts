/* SPDX-License-Identifier: Apache-2.0 */
/** Artifact persistence for Apex logs, digests, anonymous runs, and test results. */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import type { ApexArtifact } from "./types.ts";

const ROOT = globalAgentPath("sf-pi", "sf-apex");

export async function writeApexArtifact(
  kind: string,
  filename: string,
  content: unknown,
): Promise<ApexArtifact> {
  const dir = path.join(ROOT, kind);
  await mkdir(dir, { recursive: true });
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fullPath = path.join(dir, safeName);
  const text = typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
  await writeFile(fullPath, text, "utf8");
  return { path: fullPath, kind };
}

export function artifactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
