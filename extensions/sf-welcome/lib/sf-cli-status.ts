/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Lightweight SF CLI status for the welcome splash.
 *
 * This intentionally checks only the local CLI install + npm-published latest
 * version. Org/config detection belongs to sf-devbar and the shared Salesforce
 * environment runtime, not to the welcome screen.
 *
 * Phase 4 of the @salesforce/core adoption plan replaced the `npm view
 * @salesforce/cli version` subprocess (1–3 s in practice) with a direct
 * fetch to the npm registry. `sf --version` stays — it's the only honest
 * answer to "is sf on PATH?" and it's already fast.
 */
import { createStateStore } from "../../../lib/common/state-store.ts";
import type { SfCliStatusInfo } from "./types.ts";

export type SfCliExecFn = (
  command: string,
  args: string[],
  options?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

/** Hook for tests to stub the registry call. Returns the latest version or undefined. */
export type SfCliFetchLatestFn = (signal?: AbortSignal) => Promise<string | undefined>;

const NPM_REGISTRY_LATEST_URL = "https://registry.npmjs.org/@salesforce/cli/latest";
const NPM_REGISTRY_TIMEOUT_MS = 5_000;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface SfCliStatusCacheFile {
  status?: SfCliStatusInfo;
  savedAt?: number;
}

const cacheStore = createStateStore<SfCliStatusCacheFile>({
  namespace: "sf-welcome",
  filename: "sf-cli-status.json",
  schemaVersion: 1,
  defaults: {},
  migrate(raw, fromVersion) {
    if (fromVersion !== 0) return null;
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as SfCliStatusCacheFile)
      : null;
  },
});

function parseCachedStatus(value: unknown): SfCliStatusInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SfCliStatusInfo>;
  if (typeof record.installed !== "boolean") return null;
  if (
    record.freshness !== "checking" &&
    record.freshness !== "latest" &&
    record.freshness !== "update-available" &&
    record.freshness !== "unknown"
  ) {
    return null;
  }
  return {
    installed: record.installed,
    installedVersion:
      typeof record.installedVersion === "string" ? record.installedVersion : undefined,
    latestVersion: typeof record.latestVersion === "string" ? record.latestVersion : undefined,
    freshness: record.freshness,
    // Cached values are display-ready; a background refresh may update them.
    loading: false,
    checkSkipped: record.checkSkipped === true,
    skipReason:
      record.skipReason === "offline" || record.skipReason === "version-check-disabled"
        ? record.skipReason
        : undefined,
  };
}

export function readCachedSfCliStatus(maxAgeMs: number = CACHE_MAX_AGE_MS): SfCliStatusInfo | null {
  try {
    const cache = cacheStore.read();
    if (typeof cache.savedAt !== "number") return null;
    if (Date.now() - cache.savedAt > maxAgeMs) return null;
    return parseCachedStatus(cache.status);
  } catch {
    return null;
  }
}

export function writeCachedSfCliStatus(status: SfCliStatusInfo): void {
  try {
    cacheStore.write({ status: { ...status, loading: false }, savedAt: Date.now() });
  } catch {
    // Cache is best-effort. Never let splash rendering depend on disk writes.
  }
}

export function parseSfCliVersion(output: string): string | undefined {
  const firstToken = output.trim().split(/\s+/)[0];
  if (!firstToken) return undefined;

  const normalized = firstToken.replace(/^@salesforce\/cli\//, "").replace(/^v/, "");
  return normalized || undefined;
}

export function isVersionCurrent(installed: string, latest: string): boolean {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => parseInt(part, 10) || 0);

  const installedParts = parse(installed);
  const latestParts = parse(latest);

  for (let index = 0; index < Math.max(installedParts.length, latestParts.length); index++) {
    const installedPart = installedParts[index] ?? 0;
    const latestPart = latestParts[index] ?? 0;
    if (installedPart > latestPart) return true;
    if (installedPart < latestPart) return false;
  }

  return true;
}

/**
 * Default registry fetcher. Hits `/@salesforce/cli/latest` with a short
 * timeout. Returns undefined on any error so the caller can degrade to
 * `freshness: "unknown"` cleanly.
 */
export async function fetchLatestSfCliVersion(signal?: AbortSignal): Promise<string | undefined> {
  try {
    const timeoutSignal = AbortSignal.timeout(NPM_REGISTRY_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(NPM_REGISTRY_LATEST_URL, {
      signal: combined,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { version?: unknown };
    if (typeof payload.version !== "string") return undefined;
    const trimmed = payload.version.trim().replace(/^v/, "");
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

function versionCheckSkipReason(
  env: NodeJS.ProcessEnv = process.env,
): "offline" | "version-check-disabled" | undefined {
  if (env.PI_OFFLINE) return "offline";
  if (env.PI_SKIP_VERSION_CHECK) return "version-check-disabled";
  return undefined;
}

export async function detectSfCliStatus(
  exec: SfCliExecFn,
  fetchLatest: SfCliFetchLatestFn = fetchLatestSfCliVersion,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SfCliStatusInfo> {
  let installedVersion: string | undefined;

  try {
    const versionResult = await exec("sf", ["--version"], { timeout: 10_000 });
    if (versionResult.code !== 0) {
      return { installed: false, freshness: "unknown", loading: false };
    }
    installedVersion = parseSfCliVersion(versionResult.stdout);
  } catch {
    return { installed: false, freshness: "unknown", loading: false };
  }

  const skipReason = versionCheckSkipReason(env);
  if (skipReason) {
    return {
      installed: true,
      installedVersion,
      freshness: "unknown",
      loading: false,
      checkSkipped: true,
      skipReason,
    };
  }

  const latestVersion = await fetchLatest();
  if (!latestVersion || !installedVersion) {
    return { installed: true, installedVersion, freshness: "unknown", loading: false };
  }

  return {
    installed: true,
    installedVersion,
    latestVersion,
    freshness: isVersionCurrent(installedVersion, latestVersion) ? "latest" : "update-available",
    loading: false,
  };
}
