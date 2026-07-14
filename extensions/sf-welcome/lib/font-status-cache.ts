/* SPDX-License-Identifier: Apache-2.0 */
/** Cache helpers for the splash font readiness row. */
import { createStateStore } from "../../../lib/common/state-store.ts";
import type { FontRuntimeStatusInfo } from "./types.ts";

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface FontRuntimeStatusCacheFile {
  status?: FontRuntimeStatusInfo;
  savedAt?: number;
}

function getCacheStore() {
  return createStateStore<FontRuntimeStatusCacheFile>({
    namespace: "sf-welcome",
    filename: "font-status.json",
    schemaVersion: 1,
    defaults: {},
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as FontRuntimeStatusCacheFile)
        : null;
    },
  });
}

export function defaultFontRuntimeStatus(): FontRuntimeStatusInfo {
  return {
    kind: "checking",
    fontFamily: "MesloLGM Nerd Font Mono",
    glyphMode: "emoji",
    supportedPlatform: process.platform === "darwin" || process.platform === "linux",
    installed: false,
    loading: true,
  };
}

export function readCachedFontRuntimeStatus(
  maxAgeMs: number = CACHE_MAX_AGE_MS,
): FontRuntimeStatusInfo | null {
  try {
    const cache = getCacheStore().read();
    if (typeof cache.savedAt !== "number") return null;
    if (Date.now() - cache.savedAt > maxAgeMs) return null;
    return parseCachedStatus(cache.status);
  } catch {
    return null;
  }
}

export function writeCachedFontRuntimeStatus(status: FontRuntimeStatusInfo): FontRuntimeStatusInfo {
  const displayReady = {
    ...status,
    loading: false,
    checkedAt: status.checkedAt ?? new Date().toISOString(),
  };
  try {
    getCacheStore().write({ status: displayReady, savedAt: Date.now() });
  } catch {
    // Cache is best-effort; font setup still works through /sf-setup-fonts.
  }
  return displayReady;
}

function parseCachedStatus(value: unknown): FontRuntimeStatusInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<FontRuntimeStatusInfo>;
  if (
    record.kind !== "checking" &&
    record.kind !== "installed" &&
    record.kind !== "missing" &&
    record.kind !== "unsupported" &&
    record.kind !== "unknown"
  ) {
    return null;
  }
  return {
    kind: record.kind,
    fontFamily:
      typeof record.fontFamily === "string" ? record.fontFamily : "MesloLGM Nerd Font Mono",
    glyphMode: record.glyphMode === "ascii" ? "ascii" : "emoji",
    supportedPlatform: record.supportedPlatform === true,
    installed: record.installed === true,
    loading: false,
    checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : undefined,
  };
}
