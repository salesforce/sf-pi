/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Persisted cache for gateway monthly-usage/status rows.
 *
 * Startup consumers should paint from this cache and let the gateway extension
 * refresh in the background. The payload contains usage totals and status only;
 * API keys and raw gateway responses are never stored here.
 */
import { createStateStore } from "../state-store.ts";
import type {
  GatewayConnectionKind,
  GatewayConnectionStatus,
  GatewayHealth,
  GatewayKeyInfo,
  GatewayMonthlyUsage,
  KeyConflictWarning,
  MonthlyUsageSnapshot,
} from "./store.ts";

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface MonthlyUsageCacheFile {
  snapshot?: MonthlyUsageSnapshot;
  savedAt?: number;
}

function getCacheStore() {
  return createStateStore<MonthlyUsageCacheFile>({
    namespace: "monthly-usage",
    filename: "gateway-status.json",
    schemaVersion: 1,
    defaults: {},
    mode: 0o600,
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as MonthlyUsageCacheFile)
        : null;
    },
  });
}

function parseNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseConnectionKind(value: unknown): GatewayConnectionKind | undefined {
  return value === "checking" ||
    value === "connected" ||
    value === "not-configured" ||
    value === "auth-failed" ||
    value === "url-invalid" ||
    value === "unreachable" ||
    value === "degraded" ||
    value === "unknown"
    ? value
    : undefined;
}

function parseConnectionStatus(value: unknown): GatewayConnectionStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<GatewayConnectionStatus>;
  const kind = parseConnectionKind(record.kind);
  if (!kind || kind === "checking") return null;
  return {
    kind,
    detail: parseString(record.detail),
    checkedAt: parseString(record.checkedAt),
    source:
      record.source === "user-info" ||
      record.source === "key-info" ||
      record.source === "models" ||
      record.source === "health" ||
      record.source === "config" ||
      record.source === "daily-activity" ||
      record.source === "key-list"
        ? record.source
        : undefined,
    timedOut: record.timedOut === true,
    retried: record.retried === true,
  };
}

function parseMonthlyUsage(value: unknown): GatewayMonthlyUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<GatewayMonthlyUsage>;
  const maxBudget = parseNumber(record.maxBudget);
  const spend = parseNumber(record.spend);
  const remaining = parseNumber(record.remaining);
  const budgetResetAt = parseString(record.budgetResetAt);
  const budgetDuration = parseString(record.budgetDuration);
  const fetchedAt = parseString(record.fetchedAt);
  if (
    maxBudget === undefined ||
    spend === undefined ||
    remaining === undefined ||
    !budgetResetAt ||
    !budgetDuration ||
    !fetchedAt
  ) {
    return null;
  }
  return {
    maxBudget,
    spend,
    remaining,
    budgetResetAt,
    budgetDuration,
    fetchedAt,
    error: parseString(record.error),
  };
}

function parseKeyInfo(value: unknown): GatewayKeyInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<GatewayKeyInfo>;
  const spend = parseNumber(record.spend);
  const fetchedAt = parseString(record.fetchedAt);
  if (spend === undefined || !fetchedAt) return null;
  return {
    spend,
    rpmLimit: parseNumber(record.rpmLimit),
    tpmLimit: parseNumber(record.tpmLimit),
    keyName: parseString(record.keyName),
    fetchedAt,
  };
}

function parseHealth(value: unknown): GatewayHealth | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<GatewayHealth>;
  const status = parseString(record.status);
  const fetchedAt = parseString(record.fetchedAt);
  if (!status || !fetchedAt) return null;
  return {
    status,
    litellmVersion: parseString(record.litellmVersion),
    lastUpdated: parseString(record.lastUpdated),
    fetchedAt,
  };
}

function parseKeyConflict(value: unknown): KeyConflictWarning | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<KeyConflictWarning>;
  const envKeyHash = parseString(record.envKeyHash);
  const savedKeyHash = parseString(record.savedKeyHash);
  const message = parseString(record.message);
  if (!envKeyHash || !savedKeyHash || !message) return null;
  return {
    envKeyHash,
    savedKeyHash,
    active: record.active === "env" ? "env" : "saved",
    message,
  };
}

function parseSnapshot(value: unknown): MonthlyUsageSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<MonthlyUsageSnapshot>;
  const connectionStatus = parseConnectionStatus(record.connectionStatus);
  const monthlyUsage = parseMonthlyUsage(record.monthlyUsage);
  if (!connectionStatus && !monthlyUsage) return null;

  return {
    monthlyUsage,
    monthlyUsageError: parseString(record.monthlyUsageError) ?? null,
    keyInfo: parseKeyInfo(record.keyInfo),
    keyInfoError: parseString(record.keyInfoError) ?? null,
    health: parseHealth(record.health),
    healthError: parseString(record.healthError) ?? null,
    connectionStatus,
    dailyActivity: null,
    dailyActivityError: null,
    keyList: null,
    keyListError: null,
    keyConflict: parseKeyConflict(record.keyConflict),
    lastProbeTrace: null,
  };
}

export function readCachedMonthlyUsageSnapshot(
  maxAgeMs: number = CACHE_MAX_AGE_MS,
): MonthlyUsageSnapshot | null {
  try {
    const cache = getCacheStore().read();
    if (typeof cache.savedAt !== "number") return null;
    if (Date.now() - cache.savedAt > maxAgeMs) return null;
    return parseSnapshot(cache.snapshot);
  } catch {
    return null;
  }
}

export function writeCachedMonthlyUsageSnapshot(snapshot: MonthlyUsageSnapshot): void {
  try {
    if (!snapshot.connectionStatus && !snapshot.monthlyUsage) return;
    if (snapshot.connectionStatus?.kind === "checking") return;
    getCacheStore().write({ snapshot, savedAt: Date.now() });
  } catch {
    // Cache writes are best-effort and must never affect chat startup.
  }
}

export function __resetMonthlyUsageCacheForTests(): void {
  try {
    getCacheStore().write({});
  } catch {
    // ignored in tests
  }
}
