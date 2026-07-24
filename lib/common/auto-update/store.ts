/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared Native Auto Update settings and status.
 *
 * Settings live in global Pi settings because updates mutate the local machine,
 * not a project. Status is cached so SF Welcome can render without running
 * update commands on the startup path.
 */
import os from "node:os";
import { createStateStore } from "../state-store.ts";
import { redactDisplayText } from "../redaction.ts";
import { globalSettingsPath, readJsonFile, writeJsonFile } from "../sf-pi-settings.ts";

export const AUTO_UPDATE_CADENCE_MS = 24 * 60 * 60 * 1000;
export const AUTO_UPDATE_STALE_RUNNING_MS = 30 * 60 * 1000;

export type AutoUpdateResult = "success" | "failed" | "skipped";
export type AutoUpdateTarget = "pi-runtime" | "pi-packages" | "sf-cli";

export interface AutoUpdateTargetResult {
  target: AutoUpdateTarget;
  result: AutoUpdateResult;
  message: string;
}

export interface AutoUpdateStatus {
  pending?: boolean;
  pendingSince?: string;
  running?: boolean;
  currentTarget?: AutoUpdateTarget;
  startedAt?: string;
  lastRunAt?: string;
  lastResult?: AutoUpdateResult;
  message?: string;
  targets?: AutoUpdateTargetResult[];
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
  if (!enabled && readAutoUpdateStatus().pending) {
    clearAutoUpdatePending("Auto Update disabled before execution.");
  }
}

export function readAutoUpdateStatus(): AutoUpdateStatus {
  const status = normalizeStatus(getStatusStore().read().status);
  if (!shouldClearRestartRecommended(status)) return status;

  const cleared = { ...status, restartRecommended: false };
  getStatusStore().write({ status: cleared });
  return cleared;
}

export function writeAutoUpdateStatus(status: AutoUpdateStatus): AutoUpdateStatus {
  const normalized = normalizeStatus(status);
  getStatusStore().write({ status: normalized });
  return normalized;
}

export function markAutoUpdatePending(): AutoUpdateStatus {
  const current = readAutoUpdateStatus();
  return writeAutoUpdateStatus({
    ...current,
    pending: true,
    pendingSince: current.pendingSince ?? new Date().toISOString(),
    running: false,
    currentTarget: undefined,
    startedAt: undefined,
    message: "Auto Update is due and waiting for the agent to settle.",
  });
}

export function clearAutoUpdatePending(message?: string): AutoUpdateStatus {
  return writeAutoUpdateStatus({
    ...readAutoUpdateStatus(),
    pending: false,
    pendingSince: undefined,
    ...(message ? { message } : {}),
  });
}

export function markAutoUpdateRunning(target: AutoUpdateTarget): AutoUpdateStatus {
  return writeAutoUpdateStatus({
    ...readAutoUpdateStatus(),
    pending: false,
    pendingSince: undefined,
    running: true,
    currentTarget: target,
    startedAt: new Date().toISOString(),
    targets: undefined,
    message:
      target === "pi-runtime"
        ? "Checking the Pi runtime"
        : target === "pi-packages"
          ? "Updating Pi packages"
          : "Updating Salesforce CLI",
  });
}

export function markAutoUpdateResult(input: {
  result: AutoUpdateResult;
  message: string;
  targets?: AutoUpdateTargetResult[];
  restartRecommended?: boolean;
}): AutoUpdateStatus {
  return writeAutoUpdateStatus({
    pending: false,
    pendingSince: undefined,
    running: false,
    currentTarget: undefined,
    startedAt: undefined,
    lastRunAt: new Date().toISOString(),
    lastResult: input.result,
    message: input.message,
    targets: input.targets,
    restartRecommended: input.restartRecommended === true,
  });
}

export function shouldRunAutoUpdate(now: number = Date.now()): boolean {
  if (!readAutoUpdateEnabled()) return false;
  const status = readAutoUpdateStatus();
  if (isAutoUpdateRunningFresh(status, now)) return false;
  if (status.pending) return true;
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

export function shouldClearRestartRecommended(
  status: AutoUpdateStatus,
  processStartedAtMs: number = Date.now() - process.uptime() * 1000,
): boolean {
  if (!status.restartRecommended || !status.lastRunAt) return false;
  const lastRunAt = Date.parse(status.lastRunAt);
  if (!Number.isFinite(lastRunAt)) return false;
  return lastRunAt < processStartedAtMs;
}

function normalizeStatus(value: unknown): AutoUpdateStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    pending: record.pending === true,
    pendingSince: typeof record.pendingSince === "string" ? record.pendingSince : undefined,
    running: record.running === true,
    currentTarget: normalizeTarget(record.currentTarget),
    startedAt: typeof record.startedAt === "string" ? record.startedAt : undefined,
    lastRunAt: typeof record.lastRunAt === "string" ? record.lastRunAt : undefined,
    lastResult: normalizeResult(record.lastResult),
    message: typeof record.message === "string" ? sanitizePersistedText(record.message) : undefined,
    targets: normalizeTargetResults(record.targets),
    restartRecommended: record.restartRecommended === true,
  };
}

function normalizeTarget(value: unknown): AutoUpdateTarget | undefined {
  if (value === "pi-runtime" || value === "pi-packages" || value === "sf-cli") return value;
  if (value === "pi") return "pi-runtime";
  return undefined;
}

function normalizeResult(value: unknown): AutoUpdateResult | undefined {
  return value === "success" || value === "failed" || value === "skipped" ? value : undefined;
}

function normalizeTargetResults(value: unknown): AutoUpdateTargetResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const results = value
    .slice(0, 3)
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const record = item as Record<string, unknown>;
      const target = normalizeTarget(record.target);
      const result = normalizeResult(record.result);
      if (!target || !result || typeof record.message !== "string") return undefined;
      return { target, result, message: sanitizePersistedText(record.message) };
    })
    .filter((item): item is AutoUpdateTargetResult => item !== undefined);
  return results.length > 0 ? results : undefined;
}

function sanitizePersistedText(value: string): string {
  let safe = redactDisplayText(value);
  const home = os.homedir();
  if (home) safe = safe.split(home).join("<home>");
  safe = safe.replace(/\bhttps?:\/\/[^\s]+/gi, "<url-redacted>");
  return safe.slice(0, 500);
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
