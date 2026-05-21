/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Release freshness rows for the welcome splash.
 *
 * Boot contract:
 * - first paint reads only local files and bounded state-store caches;
 * - live Pi freshness is deferred by index.ts;
 * - sf-pi freshness piggybacks on the existing announcements feed cache,
 *   so this module never performs network I/O for sf-pi.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createStateStore } from "../../../lib/common/state-store.ts";
import {
  findPackageInSettings,
  type PackageEntryMatch,
} from "../../../lib/common/sf-pi-package-state.ts";
import { readAnnouncementsState } from "../../../lib/common/catalog-state/announcements-state.ts";
import {
  loadAnnouncementsManifest,
  resolveDefaultPackageRoot,
} from "../../../lib/common/catalog-state/announcements-manifest.ts";
import { compareVersions } from "../../../lib/common/catalog-state/whats-new.ts";
import { getInstalledPiVersion } from "../../../lib/common/pi-compat.ts";
import type { ReleaseStatusInfo } from "./types.ts";

const PI_LATEST_VERSION_URL = "https://pi.dev/api/latest-version";
const PI_LATEST_TIMEOUT_MS = 5_000;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface PiReleaseStatusCacheFile {
  status?: ReleaseStatusInfo;
  savedAt?: number;
}

function getPiCacheStore() {
  return createStateStore<PiReleaseStatusCacheFile>({
    namespace: "sf-welcome",
    filename: "pi-release-status.json",
    schemaVersion: 1,
    defaults: {},
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as PiReleaseStatusCacheFile)
        : null;
    },
  });
}

function parseCachedStatus(value: unknown, installedVersion?: string): ReleaseStatusInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ReleaseStatusInfo>;
  if (!isFreshness(record.freshness)) return null;

  const latestVersion = typeof record.latestVersion === "string" ? record.latestVersion : undefined;
  const resolvedInstalled = installedVersion ?? record.installedVersion;
  const freshness =
    latestVersion && resolvedInstalled
      ? freshnessFor(resolvedInstalled, latestVersion)
      : record.freshness;

  return {
    installedVersion: typeof resolvedInstalled === "string" ? resolvedInstalled : undefined,
    latestVersion,
    freshness,
    loading: false,
    updateCommand: typeof record.updateCommand === "string" ? record.updateCommand : undefined,
    checkSkipped: record.checkSkipped === true,
    skipReason:
      record.skipReason === "offline" || record.skipReason === "version-check-disabled"
        ? record.skipReason
        : undefined,
  };
}

export function readCachedPiReleaseStatus(
  installedVersion = getInstalledPiVersion(),
  maxAgeMs: number = CACHE_MAX_AGE_MS,
): ReleaseStatusInfo | null {
  try {
    const cache = getPiCacheStore().read();
    if (typeof cache.savedAt !== "number") return null;
    if (Date.now() - cache.savedAt > maxAgeMs) return null;
    return parseCachedStatus(cache.status, installedVersion);
  } catch {
    return null;
  }
}

export function writeCachedPiReleaseStatus(status: ReleaseStatusInfo): void {
  try {
    getPiCacheStore().write({ status: { ...status, loading: false }, savedAt: Date.now() });
  } catch {
    // Cache is best-effort. Never let splash rendering depend on disk writes.
  }
}

export function collectInitialPiReleaseStatus(): ReleaseStatusInfo {
  const installedVersion = getInstalledPiVersion();
  const cached = readCachedPiReleaseStatus(installedVersion);
  if (cached) return cached;
  return {
    installedVersion,
    freshness: "checking",
    loading: true,
    updateCommand: "pi update --self",
  };
}

export type PiLatestFetchFn = (signal?: AbortSignal) => Promise<string | undefined>;

export async function fetchLatestPiVersion(signal?: AbortSignal): Promise<string | undefined> {
  try {
    const timeoutSignal = AbortSignal.timeout(PI_LATEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(PI_LATEST_VERSION_URL, {
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

export async function detectPiReleaseStatus(
  fetchLatest: PiLatestFetchFn = fetchLatestPiVersion,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReleaseStatusInfo> {
  const installedVersion = getInstalledPiVersion();
  const updateCommand = "pi update --self";

  if (env.PI_OFFLINE) {
    return {
      installedVersion,
      freshness: "unknown",
      loading: false,
      updateCommand,
      checkSkipped: true,
      skipReason: "offline",
    };
  }
  if (env.PI_SKIP_VERSION_CHECK) {
    return {
      installedVersion,
      freshness: "unknown",
      loading: false,
      updateCommand,
      checkSkipped: true,
      skipReason: "version-check-disabled",
    };
  }

  const latestVersion = await fetchLatest();
  if (!installedVersion || !latestVersion) {
    return { installedVersion, latestVersion, freshness: "unknown", loading: false, updateCommand };
  }

  return {
    installedVersion,
    latestVersion,
    freshness: freshnessFor(installedVersion, latestVersion),
    loading: false,
    updateCommand,
  };
}

export function detectSfPiReleaseStatus(cwd?: string): ReleaseStatusInfo {
  const packageRoot = resolveDefaultPackageRoot();
  const installedVersion = readSfPiInstalledVersion(packageRoot);
  const bundledLatest = readBundledLatestVersion(packageRoot);
  const cachedRemoteLatest = readFreshCachedRemoteLatestVersion();
  const latestVersion = latestKnownVersion([bundledLatest, cachedRemoteLatest]);
  const match = cwd ? findEffectivePackageMatch(cwd) : null;
  const updateCommand = buildSfPiUpdateCommand(match);

  if (!installedVersion || !latestVersion) {
    return { installedVersion, latestVersion, freshness: "unknown", loading: false, updateCommand };
  }

  return {
    installedVersion,
    latestVersion,
    freshness: freshnessFor(installedVersion, latestVersion),
    loading: false,
    updateCommand,
  };
}

function readSfPiInstalledVersion(packageRoot: string | undefined): string | undefined {
  if (!packageRoot) return undefined;
  const pkgPath = join(packageRoot, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version.trim()
      ? pkg.version.trim().replace(/^v/, "")
      : undefined;
  } catch {
    return undefined;
  }
}

function readBundledLatestVersion(packageRoot: string | undefined): string | undefined {
  if (!packageRoot) return undefined;
  const manifest = loadAnnouncementsManifest(packageRoot);
  return manifest.latestVersion?.replace(/^v/, "");
}

function readFreshCachedRemoteLatestVersion(
  nowMs: number = Date.now(),
  maxAgeMs: number = CACHE_MAX_AGE_MS,
): string | undefined {
  const state = readAnnouncementsState();
  if (!state.cachedRemote || !state.lastFetchAt) return undefined;
  const fetchedAt = Date.parse(state.lastFetchAt);
  if (!Number.isFinite(fetchedAt) || nowMs - fetchedAt > maxAgeMs) return undefined;

  try {
    const parsed = JSON.parse(state.cachedRemote) as { latestVersion?: unknown };
    return typeof parsed.latestVersion === "string" && parsed.latestVersion.trim()
      ? parsed.latestVersion.trim().replace(/^v/, "")
      : undefined;
  } catch {
    return undefined;
  }
}

function latestKnownVersion(versions: Array<string | undefined>): string | undefined {
  return versions
    .filter((version): version is string => typeof version === "string" && version.length > 0)
    .sort((a, b) => compareVersions(b, a))[0];
}

function freshnessFor(
  installedVersion: string,
  latestVersion: string,
): ReleaseStatusInfo["freshness"] {
  return compareVersions(latestVersion, installedVersion) > 0 ? "update-available" : "latest";
}

function findEffectivePackageMatch(cwd: string): PackageEntryMatch | null {
  return findPackageInSettings(cwd, "project") ?? findPackageInSettings(cwd, "global");
}

function buildSfPiUpdateCommand(match: PackageEntryMatch | null): string | undefined {
  if (!match) return "pi update --extensions";
  if (isLocalPackageSource(match.source)) return undefined;
  return `pi update ${match.source}`;
}

function isLocalPackageSource(source: string): boolean {
  return (
    source.startsWith("/") ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith("~")
  );
}

function isFreshness(value: unknown): value is ReleaseStatusInfo["freshness"] {
  return (
    value === "checking" ||
    value === "latest" ||
    value === "update-available" ||
    value === "unknown"
  );
}
