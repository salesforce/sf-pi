/* SPDX-License-Identifier: Apache-2.0 */
/** Writes Apex evidence files under a caller-owned root. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ApexArtifact } from "./types.ts";

export interface ApexArtifactWriter {
  directory(kind: string, child?: string): Promise<string>;
  write(kind: string, filename: string, content: unknown): Promise<ApexArtifact>;
}

export interface ApexArtifactWriterOptions {
  private?: boolean;
  signal?: AbortSignal;
}

export function createApexArtifactWriter(
  root: string,
  options: ApexArtifactWriterOptions = {},
): ApexArtifactWriter {
  const safe = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+$/, "_");
  const directory = async (kind: string, child?: string) => {
    options.signal?.throwIfAborted();
    const dir = path.join(root, safe(kind), ...(child ? [safe(child)] : []));
    await mkdir(dir, { recursive: true, ...(options.private ? { mode: 0o700 } : {}) });
    return dir;
  };
  return {
    directory,
    async write(kind, filename, content) {
      const file = path.join(await directory(kind), safe(filename));
      options.signal?.throwIfAborted();
      const text = typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
      await writeFile(file, text, {
        encoding: "utf8",
        ...(options.private ? { mode: 0o600 } : {}),
      });
      return { path: file, kind };
    },
  };
}

export function artifactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
