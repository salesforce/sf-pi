/* SPDX-License-Identifier: Apache-2.0 */
/** Cache-first ApexGuru readiness owned by sf-code-analyzer. */
import { createStateStore } from "../../../lib/common/state-store.ts";
import { validateApexGuru } from "./apexguru.ts";

const APEXGURU_READY_TTL_MS = 24 * 60 * 60 * 1000;

export interface ApexGuruReadinessKey {
  orgId?: string;
  userId?: string;
  instanceUrl?: string;
  apiVersion?: string;
}

export interface ApexGuruReadinessEntry extends ApexGuruReadinessKey {
  checkedAt?: string;
  access: "unknown" | "enabled" | "eligible" | "ineligible" | "not_authed";
  message: string;
  targetOrg?: string;
}

export interface ApexGuruReadinessState {
  latestKey?: string;
  entries: Record<string, ApexGuruReadinessEntry>;
}

const DEFAULT_ENTRY: ApexGuruReadinessEntry = {
  access: "unknown",
  message: "ApexGuru readiness has not been checked.",
};

const DEFAULT_STATE: ApexGuruReadinessState = {
  entries: {},
};

const store = createStateStore<ApexGuruReadinessState>({
  namespace: "sf-code-analyzer",
  filename: "apexguru-readiness.json",
  schemaVersion: 2,
  defaults: DEFAULT_STATE,
  migrate: (raw) => migrateReadiness(raw),
});

export function readApexGuruReadiness(): ApexGuruReadinessEntry {
  const state = store.read();
  return (state.latestKey ? state.entries[state.latestKey] : undefined) ?? DEFAULT_ENTRY;
}

export function readApexGuruReadinessForKey(key: ApexGuruReadinessKey): ApexGuruReadinessEntry {
  return store.read().entries[readinessKey(key)] ?? DEFAULT_ENTRY;
}

export function readApexGuruReadinessState(): ApexGuruReadinessState {
  return store.read();
}

export function isApexGuruReadyForAutoInsight(entry = readApexGuruReadiness()): boolean {
  if (entry.access !== "enabled") return false;
  if (!entry.checkedAt) return false;
  return Date.now() - Date.parse(entry.checkedAt) <= APEXGURU_READY_TTL_MS;
}

export async function refreshApexGuruReadiness(
  targetOrg?: string,
): Promise<ApexGuruReadinessEntry> {
  try {
    const validation = await validateApexGuru(targetOrg);
    const entry: ApexGuruReadinessEntry = {
      checkedAt: new Date().toISOString(),
      access: validation.access as ApexGuruReadinessEntry["access"],
      message: validation.message,
      orgId: validation.orgId,
      userId: validation.userId,
      instanceUrl: validation.instanceUrl,
      apiVersion: validation.apiVersion,
      targetOrg: validation.targetOrg,
    };
    return writeEntry(entry);
  } catch (error) {
    return writeEntry({
      checkedAt: new Date().toISOString(),
      access: "not_authed",
      message: error instanceof Error ? error.message : String(error),
      targetOrg,
    });
  }
}

function writeEntry(entry: ApexGuruReadinessEntry): ApexGuruReadinessEntry {
  const key = readinessKey(entry);
  store.update((state) => ({
    latestKey: key,
    entries: { ...state.entries, [key]: entry },
  }));
  return entry;
}

export function apexGuruReadinessKey(key: ApexGuruReadinessKey): string {
  return readinessKey(key);
}

function readinessKey(key: ApexGuruReadinessKey): string {
  return [key.orgId, key.userId, key.instanceUrl, key.apiVersion]
    .map((part) => part || "unknown")
    .join("|");
}

function migrateReadiness(raw: unknown): ApexGuruReadinessState | null {
  if (!raw || typeof raw !== "object") return null;
  const old = raw as ApexGuruReadinessEntry;
  if (typeof old.access !== "string") return null;
  const key = readinessKey(old);
  return { latestKey: key, entries: { [key]: old } };
}
