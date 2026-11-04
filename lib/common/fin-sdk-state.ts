/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Cross-extension Fin SDK enablement state.
 *
 * SF Fin writes the last observed Fin SDK state for its connected workspace.
 * SF Guardrail reads it during pre-execution mediation so it can treat the
 * first Fin SDK call (which enables the SDK by default) as a workspace
 * mutation, while later SDK reads on an already-enabled workspace stay
 * prompt-free. Holds no credentials.
 */
import { createStateStore } from "./state-store.ts";

export type FinSdkObservedState = "enabled" | "not_enabled" | "unknown";

export interface FinSdkStateRecord {
  state: FinSdkObservedState;
  /** Non-secret workspace app id when known. */
  appId?: string;
  checkedAt?: string;
  /** Set when SF Fin itself enabled the SDK. */
  enabledBySfFinAt?: string;
}

function store(pathOverride?: string) {
  return createStateStore<FinSdkStateRecord>({
    namespace: "sf-fin",
    filename: "sdk-state.json",
    schemaVersion: 1,
    defaults: { state: "unknown" },
    mode: 0o600,
    ...(pathOverride ? { pathOverride } : {}),
  });
}

export function readFinSdkState(pathOverride?: string): FinSdkStateRecord {
  return store(pathOverride).read();
}

export function writeFinSdkState(
  record: FinSdkStateRecord,
  pathOverride?: string,
): FinSdkStateRecord {
  store(pathOverride).write(record);
  return record;
}

export function isFinSdkKnownEnabled(pathOverride?: string): boolean {
  return readFinSdkState(pathOverride).state === "enabled";
}
