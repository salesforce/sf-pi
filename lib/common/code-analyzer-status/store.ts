/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared cache for SF Code Analyzer readiness.
 *
 * SF Code Analyzer writes this cache after deferred or explicit readiness
 * probes. SF Welcome reads it on the startup hot path so it can show a compact
 * onboarding row without spawning `sf` or blocking first paint.
 */
import { createStateStore } from "../state-store.ts";

export const CODE_ANALYZER_READY_TTL_MS = 24 * 60 * 60 * 1000;

export interface CodeAnalyzerReadinessState {
  checkedAt?: string;
  status: "unknown" | "ready" | "not_installed" | "partial";
  summary: string;
  pluginVersion?: string;
  sfOk?: boolean;
  pluginOk?: boolean;
  javaOk?: boolean;
  pythonOk?: boolean;
}

const DEFAULT_STATE: CodeAnalyzerReadinessState = {
  status: "unknown",
  summary: "Code Analyzer readiness has not been checked.",
};

const store = createStateStore<CodeAnalyzerReadinessState>({
  namespace: "sf-code-analyzer",
  filename: "readiness.json",
  schemaVersion: 1,
  defaults: DEFAULT_STATE,
});

export function readCodeAnalyzerReadiness(): CodeAnalyzerReadinessState {
  return store.read();
}

export function writeCodeAnalyzerReadiness(
  state: CodeAnalyzerReadinessState,
): CodeAnalyzerReadinessState {
  store.write(state);
  return state;
}

export function isCodeAnalyzerReadyForAutoScan(state = readCodeAnalyzerReadiness()): boolean {
  if (state.status !== "ready") return false;
  if (!state.checkedAt) return false;
  return Date.now() - Date.parse(state.checkedAt) <= CODE_ANALYZER_READY_TTL_MS;
}

export function formatCodeAnalyzerReadinessLine(state = readCodeAnalyzerReadiness()): string {
  const age = state.checkedAt
    ? ageLabel(Date.now() - Date.parse(state.checkedAt))
    : "never checked";
  const version = state.pluginVersion ? ` · ${state.pluginVersion}` : "";
  return `${state.status.replace(/_/g, " ")}${version} · ${age}`;
}

function ageLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown age";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just checked";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
