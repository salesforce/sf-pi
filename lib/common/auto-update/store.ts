/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared Native Auto Update settings and status.
 *
 * Settings live in global Pi settings because updates mutate the local machine,
 * not a project. Status is cached so SF Welcome can render without running
 * update commands on the startup path.
 */
import { createStateStore } from "../state-store.ts";
import { globalSettingsPath, readJsonFile, writeJsonFile } from "../sf-pi-settings.ts";

export const AUTO_UPDATE_CADENCE_MS = 24 * 60 * 60 * 1000;
export const AUTO_UPDATE_STALE_RUNNING_MS = 30 * 60 * 1000;

export type AutoUpdateResult = "success" | "failed" | "skipped";
export type AutoUpdateTarget = "pi" | "sf-cli";

export interface AutoUpdateStatus {
  running?: boolean;
  currentTarget?: AutoUpdateTarget;
  startedAt?: string;
  lastRunAt?: string;
  lastResult?: AutoUpdateResult;
  message?: string;
  restartRecommended?: boolean;
}

interface AutoUpdateStatusFile {
  status?: AutoUpdateStatus;
}

const DEFAULT_STATUS: AutoUpdateStatusFile = {};

function getStatusStore() {
  return createStateStore<AutoUpdateStatusFile>({
    namespace: "auto-update",
    filename: "status.json",
    schemaVersion: 1,
    defaults: DEFAULT_STATUS,
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as AutoUpdateStatusFile)
        : null;
    },
  });
}

export function readAutoUpdateEnabled(): boolean {
  const root = readJsonFile(globalSettingsPath());
  const sfPi = readObject(root.sfPi);
  return sfPi.autoUpdate === true;
}

export function writeAutoUpdateEnabled(enabled: boolean): void {
  const root = readJsonFile(globalSettingsPath());
  const nextRoot = { ...root };
  const sfPi = { ...readObject(nextRoot.sfPi), autoUpdate: enabled };
  nextRoot.sfPi = sfPi;
  writeJsonFile(globalSettingsPath(), nextRoot);
}

export function readAutoUpdateStatus(): AutoUpdateStatus {
  return normalizeStatus(getStatusStore().read().status);
}

export function writeAutoUpdateStatus(status: AutoUpdateStatus): AutoUpdateStatus {
  const normalized = normalizeStatus(status);
  getStatusStore().write({ status: normalized });
  return normalized;
}

export function markAutoUpdateRunning(target: AutoUpdateTarget): AutoUpdateStatus {
  return writeAutoUpdateStatus({
    ...readAutoUpdateStatus(),
    running: true,
    currentTarget: target,
    startedAt: new Date().toISOString(),
    message: target === "pi" ? "Updating Pi and packages" : "Updating Salesforce CLI",
  });
}

export function markAutoUpdateResult(input: {
  result: AutoUpdateResult;
  message: string;
  restartRecommended?: boolean;
}): AutoUpdateStatus {
  return writeAutoUpdateStatus({
    running: false,
    currentTarget: undefined,
    startedAt: undefined,
    lastRunAt: new Date().toISOString(),
    lastResult: input.result,
    message: input.message,
    restartRecommended: input.restartRecommended === true,
  });
}

export function shouldRunAutoUpdate(now: number = Date.now()): boolean {
  if (!readAutoUpdateEnabled()) return false;
  const status = readAutoUpdateStatus();
  if (isAutoUpdateRunningFresh(status, now)) return false;
  if (!status.lastRunAt) return true;
  const lastRunAt = Date.parse(status.lastRunAt);
  if (!Number.isFinite(lastRunAt)) return true;
  return now - lastRunAt >= AUTO_UPDATE_CADENCE_MS;
}

export function isAutoUpdateRunningFresh(
  status: AutoUpdateStatus = readAutoUpdateStatus(),
  now: number = Date.now(),
): boolean {
  if (!status.running) return false;
  const startedAt = status.startedAt ? Date.parse(status.startedAt) : NaN;
  if (!Number.isFinite(startedAt)) return false;
  return now - startedAt < AUTO_UPDATE_STALE_RUNNING_MS;
}

export function autoUpdateStatusPath(): string {
  return getStatusStore().path;
}

function normalizeStatus(value: unknown): AutoUpdateStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Partial<AutoUpdateStatus>;
  return {
    running: record.running === true,
    currentTarget:
      record.currentTarget === "pi" || record.currentTarget === "sf-cli"
        ? record.currentTarget
        : undefined,
    startedAt: typeof record.startedAt === "string" ? record.startedAt : undefined,
    lastRunAt: typeof record.lastRunAt === "string" ? record.lastRunAt : undefined,
    lastResult:
      record.lastResult === "success" ||
      record.lastResult === "failed" ||
      record.lastResult === "skipped"
        ? record.lastResult
        : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
    restartRecommended: record.restartRecommended === true,
  };
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
