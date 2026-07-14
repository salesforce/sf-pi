/* SPDX-License-Identifier: Apache-2.0 */
/** Cache-first Homebrew readiness for the welcome splash. */
import { createStateStore } from "../../../lib/common/state-store.ts";
import type { HomebrewStatusInfo } from "./types.ts";

export type HomebrewExecFn = (
  command: string,
  args: string[],
  options?: { timeout?: number; cwd?: string },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface HomebrewStatusCacheFile {
  status?: HomebrewStatusInfo;
  savedAt?: number;
}

const DEFAULT_STATUS: HomebrewStatusInfo = {
  kind: "checking",
  loading: true,
  platform: process.platform,
};

function getCacheStore() {
  return createStateStore<HomebrewStatusCacheFile>({
    namespace: "sf-welcome",
    filename: "homebrew-status.json",
    schemaVersion: 1,
    defaults: {},
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as HomebrewStatusCacheFile)
        : null;
    },
  });
}

export function defaultHomebrewStatus(): HomebrewStatusInfo {
  return { ...DEFAULT_STATUS, platform: process.platform };
}

export function readCachedHomebrewStatus(
  maxAgeMs: number = CACHE_MAX_AGE_MS,
): HomebrewStatusInfo | null {
  try {
    const cache = getCacheStore().read();
    if (typeof cache.savedAt !== "number") return null;
    if (Date.now() - cache.savedAt > maxAgeMs) return null;
    return parseCachedStatus(cache.status);
  } catch {
    return null;
  }
}

export function writeCachedHomebrewStatus(status: HomebrewStatusInfo): HomebrewStatusInfo {
  const displayReady = {
    ...status,
    loading: false,
    checkedAt: status.checkedAt ?? new Date().toISOString(),
  };
  try {
    getCacheStore().write({ status: displayReady, savedAt: Date.now() });
  } catch {
    // Best-effort. Homebrew is advisory setup context, never a correctness boundary.
  }
  return displayReady;
}

export async function detectHomebrewStatus(
  exec: HomebrewExecFn,
  platform: NodeJS.Platform = process.platform,
): Promise<HomebrewStatusInfo> {
  try {
    const versionResult = await exec("brew", ["--version"], { timeout: 10_000 });
    if (versionResult.code !== 0) return missingStatus(platform);

    const version = parseHomebrewVersion(versionResult.stdout || versionResult.stderr);
    let prefix: string | undefined;
    try {
      const prefixResult = await exec("brew", ["--prefix"], { timeout: 5_000 });
      if (prefixResult.code === 0) prefix = prefixResult.stdout.trim() || undefined;
    } catch {
      // Prefix is nice-to-have only.
    }

    return {
      kind: "installed",
      version,
      prefix,
      loading: false,
      checkedAt: new Date().toISOString(),
      platform,
    };
  } catch {
    return missingStatus(platform);
  }
}

export function parseHomebrewVersion(output: string): string | undefined {
  const match = /Homebrew\s+(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i.exec(output.trim());
  return match?.[1];
}

function missingStatus(platform: NodeJS.Platform): HomebrewStatusInfo {
  return {
    kind: "missing",
    loading: false,
    checkedAt: new Date().toISOString(),
    platform,
  };
}

function parseCachedStatus(value: unknown): HomebrewStatusInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<HomebrewStatusInfo>;
  if (
    record.kind !== "checking" &&
    record.kind !== "installed" &&
    record.kind !== "missing" &&
    record.kind !== "unknown"
  ) {
    return null;
  }
  return {
    kind: record.kind,
    version: typeof record.version === "string" ? record.version : undefined,
    prefix: typeof record.prefix === "string" ? record.prefix : undefined,
    loading: false,
    checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : undefined,
    platform: typeof record.platform === "string" ? record.platform : process.platform,
  };
}
