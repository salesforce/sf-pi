/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SF Pi package release freshness for the welcome splash.
 *
 * Pi owns Pi Runtime installation, release checks, and update guidance. SF Pi
 * freshness piggybacks on the announcements cache and performs no network I/O.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
import type { ReleaseStatusInfo } from "./types.ts";

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
