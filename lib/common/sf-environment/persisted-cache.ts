/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Persist the last known Salesforce environment to disk.
 *
 * This lets startup show a recent snapshot immediately on the next launch,
 * then refresh it in the background without waiting on SF CLI commands.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { globalAgentPath } from "../pi-paths.ts";
import { detectProject } from "./detect.ts";
import type { SfEnvironment } from "./types.ts";

const CACHE_VERSION = 1;
const MAX_ENTRIES = 20;
const CACHE_FILE_NAME = "sf-environment.json";

interface PersistedCacheEntry {
  key: string;
  savedAt: number;
  env: SfEnvironment;
}

interface PersistedCacheFile {
  version: number;
  entries: PersistedCacheEntry[];
}

export function readPersistedSfEnvironment(cwd: string): SfEnvironment | null {
  const cache = readCacheFile();
  if (!cache) {
    return null;
  }

  const key = getEnvironmentCacheKey(cwd);
  const entry = cache.entries.find((item) => item.key === key);
  return entry?.env ?? null;
}

export function writePersistedSfEnvironment(cwd: string, env: SfEnvironment): void {
  const key = getEnvironmentCacheKey(cwd);
  const cache = readCacheFile() ?? { version: CACHE_VERSION, entries: [] };

  const entries = cache.entries.filter((entry) => entry.key !== key);
  entries.unshift({ key, savedAt: Date.now(), env });

  const nextCache: PersistedCacheFile = {
    version: CACHE_VERSION,
    entries: entries.sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_ENTRIES),
  };

  const filePath = getCacheFilePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(nextCache, null, 2)}\n`, "utf8");
}

export function clearPersistedSfEnvironment(cwd?: string): void {
  const filePath = getCacheFilePath();

  if (cwd === undefined) {
    rmSync(filePath, { force: true });
    return;
  }

  const cache = readCacheFile();
  if (!cache) {
    rmSync(filePath, { force: true });
    return;
  }

  const key = getEnvironmentCacheKey(cwd);
  const entries = cache.entries.filter((entry) => entry.key !== key);
  if (entries.length === 0) {
    rmSync(filePath, { force: true });
    return;
  }

  writeFileSync(
    filePath,
    `${JSON.stringify({ version: CACHE_VERSION, entries }, null, 2)}\n`,
    "utf8",
  );
}

export function getEnvironmentCacheKey(cwd: string): string {
  // Cache at the project root when available so nested folders in the same
  // Salesforce project reuse one last-known snapshot.
  const project = detectProject(cwd);
  return path.resolve(project.projectRoot ?? cwd);
}

function readCacheFile(): PersistedCacheFile | null {
  const filePath = getCacheFilePath();

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedCacheFile;
    if (!parsed || parsed.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) {
      return null;
    }

    const entries = parsed.entries.filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.key === "string" &&
        typeof entry.savedAt === "number" &&
        entry.env &&
        typeof entry.env === "object",
    );

    return { version: CACHE_VERSION, entries };
  } catch {
    return null;
  }
}

function getCacheFilePath(): string {
  return globalAgentPath("cache", CACHE_FILE_NAME);
}
