/* SPDX-License-Identifier: Apache-2.0 */
/** Cache helpers for the startup-safe Node CA status row. */
import { createStateStore } from "../../../lib/common/state-store.ts";
import type { NodeCertStatusInfo, NodeCertStatusSource } from "./types.ts";

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface NodeCertStatusCacheFile {
  status?: NodeCertStatusInfo;
  savedAt?: number;
}

function getCacheStore() {
  return createStateStore<NodeCertStatusCacheFile>({
    namespace: "sf-welcome",
    filename: "node-cert-status.json",
    schemaVersion: 1,
    defaults: {},
    mode: 0o600,
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as NodeCertStatusCacheFile)
        : null;
    },
  });
}

function parseSource(value: unknown): NodeCertStatusSource | undefined {
  if (
    value === "env" ||
    value === "launch-agent" ||
    value === "shell" ||
    value === "fixer" ||
    value === "candidate" ||
    value === "probe"
  ) {
    return value;
  }
  return undefined;
}

function parseCachedStatus(value: unknown): NodeCertStatusInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<NodeCertStatusInfo>;
  if (
    record.kind !== "checking" &&
    record.kind !== "verified" &&
    record.kind !== "installed" &&
    record.kind !== "found" &&
    record.kind !== "not-configured" &&
    record.kind !== "invalid" &&
    record.kind !== "unknown"
  ) {
    return null;
  }
  return {
    kind: record.kind,
    source: parseSource(record.source),
    path: typeof record.path === "string" ? record.path : undefined,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    loading: false,
  };
}

export function readCachedNodeCertStatus(
  maxAgeMs: number = CACHE_MAX_AGE_MS,
): NodeCertStatusInfo | null {
  try {
    const cache = getCacheStore().read();
    if (typeof cache.savedAt !== "number") return null;
    if (Date.now() - cache.savedAt > maxAgeMs) return null;
    return parseCachedStatus(cache.status);
  } catch {
    return null;
  }
}

export function writeCachedNodeCertStatus(status: NodeCertStatusInfo): void {
  try {
    getCacheStore().write({ status: { ...status, loading: false }, savedAt: Date.now() });
  } catch {
    // Cache is best-effort. The splash falls back to "Checking" / "Unknown".
  }
}
