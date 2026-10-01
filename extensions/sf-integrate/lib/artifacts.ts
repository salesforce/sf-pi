/* SPDX-License-Identifier: Apache-2.0 */
/** Private integration plan and run artifacts. */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import type { IntegrationArtifact } from "./types.ts";

const ROOT = globalAgentPath("sf-pi", "sf-integrate");

export async function writeIntegrationArtifact(
  kind: string,
  filename: string,
  content: unknown,
): Promise<IntegrationArtifact> {
  const directory = path.join(ROOT, safeName(kind));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const fullPath = path.join(directory, safeName(filename));
  const text = typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
  await writeFile(fullPath, text, { encoding: "utf8", mode: 0o600 });
  return { path: fullPath, kind };
}

export function integrationArtifactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}
