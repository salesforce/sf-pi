/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Persisted runtime diagnostics cache for startup-safe doctor summaries.
 *
 * Runtime diagnostics are intentionally expensive: they may shell out to `pi`,
 * `npm`, and `which`, and can include a bounded npm registry lookup. Startup
 * surfaces should read this cache and refresh it later; explicit doctor
 * commands remain the live source of truth.
 */
import { createStateStore } from "../state-store.ts";
import type { RuntimeDiagnostics } from "./types.ts";

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface RuntimeDiagnosticsCacheFile {
  runtime?: RuntimeDiagnostics;
  savedAt?: number;
}

function getCacheStore() {
  return createStateStore<RuntimeDiagnosticsCacheFile>({
    namespace: "doctor",
    filename: "runtime.json",
    schemaVersion: 1,
    defaults: {},
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as RuntimeDiagnosticsCacheFile)
        : null;
    },
  });
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseRuntimeDiagnostics(value: unknown): RuntimeDiagnostics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<RuntimeDiagnostics>;
  const nodeVersion = parseString(record.nodeVersion);
  const requiredPiVersion = parseString(record.requiredPiVersion);
  if (!nodeVersion || !requiredPiVersion) return null;

  return {
    piVersion: parseString(record.piVersion),
    requiredPiVersion,
    nodeVersion,
    nodePath: parseString(record.nodePath),
    npmPath: parseString(record.npmPath),
    piPath: parseString(record.piPath),
    allPiPaths: parseStringArray(record.allPiPaths),
    npmGlobalRoot: parseString(record.npmGlobalRoot),
    npmBefore: parseString(record.npmBefore),
    npmMinReleaseAge: parseString(record.npmMinReleaseAge),
    npmMinimumReleaseAge: parseString(record.npmMinimumReleaseAge),
    installedPiPackageVersion: parseString(record.installedPiPackageVersion),
    latestPiPackageVersion: parseString(record.latestPiPackageVersion),
    updateAdvice: parseStringArray(record.updateAdvice),
  };
}

export function readCachedRuntimeDiagnostics(
  maxAgeMs: number = CACHE_MAX_AGE_MS,
): RuntimeDiagnostics | null {
  try {
    const cache = getCacheStore().read();
    if (typeof cache.savedAt !== "number") return null;
    if (Date.now() - cache.savedAt > maxAgeMs) return null;
    return parseRuntimeDiagnostics(cache.runtime);
  } catch {
    return null;
  }
}

export function writeCachedRuntimeDiagnostics(runtime: RuntimeDiagnostics): void {
  try {
    getCacheStore().write({ runtime, savedAt: Date.now() });
  } catch {
    // Cache writes are best-effort; doctor output must never depend on disk.
  }
}
