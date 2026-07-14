/* SPDX-License-Identifier: Apache-2.0 */
/** Cache-first Hunk readiness for the welcome splash. */
import { createStateStore } from "../../../lib/common/state-store.ts";
import type { HunkStatusInfo } from "./types.ts";

export type HunkExecFn = (
  command: string,
  args: string[],
  options?: { timeout?: number; cwd?: string },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const HUNK_COMMANDS = ["hunk", "hunkdiff"] as const;

interface HunkStatusCacheFile {
  status?: HunkStatusInfo;
  savedAt?: number;
}

const DEFAULT_STATUS: HunkStatusInfo = {
  installed: false,
  loading: true,
};

function getCacheStore() {
  return createStateStore<HunkStatusCacheFile>({
    namespace: "sf-welcome",
    filename: "hunk-status.json",
    schemaVersion: 1,
    defaults: {},
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as HunkStatusCacheFile)
        : null;
    },
  });
}

export function defaultHunkStatus(): HunkStatusInfo {
  return { ...DEFAULT_STATUS };
}

export function readCachedHunkStatus(maxAgeMs: number = CACHE_MAX_AGE_MS): HunkStatusInfo | null {
  try {
    const cache = getCacheStore().read();
    if (typeof cache.savedAt !== "number") return null;
    if (Date.now() - cache.savedAt > maxAgeMs) return null;
    return parseCachedStatus(cache.status);
  } catch {
    return null;
  }
}

export function writeCachedHunkStatus(status: HunkStatusInfo): HunkStatusInfo {
  const displayReady = {
    ...status,
    loading: false,
    checkedAt: status.checkedAt ?? new Date().toISOString(),
  };
  try {
    getCacheStore().write({ status: displayReady, savedAt: Date.now() });
  } catch {
    // Best-effort. The splash falls back to a non-blocking nudge.
  }
  return displayReady;
}

export async function detectHunkStatus(exec: HunkExecFn): Promise<HunkStatusInfo> {
  for (const command of HUNK_COMMANDS) {
    try {
      const result = await exec(command, ["--version"], { timeout: 10_000 });
      if (result.code !== 0) continue;
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      return {
        installed: true,
        command,
        installedVersion: parseHunkVersion(output),
        loading: false,
        checkedAt: new Date().toISOString(),
      };
    } catch {
      // Try the next binary name.
    }
  }

  return {
    installed: false,
    loading: false,
    checkedAt: new Date().toISOString(),
  };
}

export function parseHunkVersion(output: string): string | undefined {
  const match = /v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/.exec(output.trim());
  return match?.[1]?.replace(/^v/, "");
}

function parseCachedStatus(value: unknown): HunkStatusInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<HunkStatusInfo>;
  if (typeof record.installed !== "boolean") return null;
  return {
    installed: record.installed,
    command:
      record.command === "hunk" || record.command === "hunkdiff" ? record.command : undefined,
    installedVersion:
      typeof record.installedVersion === "string" ? record.installedVersion : undefined,
    loading: false,
    checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : undefined,
  };
}
