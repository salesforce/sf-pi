/* SPDX-License-Identifier: Apache-2.0 */
/** Cache-first ApexGuru readiness owned by sf-code-analyzer. */
import { createStateStore } from "../../../lib/common/state-store.ts";
import { validateApexGuru } from "./apexguru.ts";

const APEXGURU_READY_TTL_MS = 24 * 60 * 60 * 1000;

export interface ApexGuruReadinessState {
  checkedAt?: string;
  access: "unknown" | "enabled" | "eligible" | "ineligible" | "not_authed";
  message: string;
  orgId?: string;
  instanceUrl?: string;
}

const DEFAULT_STATE: ApexGuruReadinessState = {
  access: "unknown",
  message: "ApexGuru readiness has not been checked.",
};

const store = createStateStore<ApexGuruReadinessState>({
  namespace: "sf-code-analyzer",
  filename: "apexguru-readiness.json",
  schemaVersion: 1,
  defaults: DEFAULT_STATE,
});

export function readApexGuruReadiness(): ApexGuruReadinessState {
  return store.read();
}

export function isApexGuruReadyForAutoInsight(state = readApexGuruReadiness()): boolean {
  if (state.access !== "enabled") return false;
  if (!state.checkedAt) return false;
  return Date.now() - Date.parse(state.checkedAt) <= APEXGURU_READY_TTL_MS;
}

export async function refreshApexGuruReadiness(
  targetOrg?: string,
): Promise<ApexGuruReadinessState> {
  try {
    const validation = await validateApexGuru(targetOrg);
    const state: ApexGuruReadinessState = {
      checkedAt: new Date().toISOString(),
      access: validation.access as ApexGuruReadinessState["access"],
      message: validation.message,
      orgId: validation.orgId,
      instanceUrl: validation.instanceUrl,
    };
    store.write(state);
    return state;
  } catch (error) {
    const state: ApexGuruReadinessState = {
      checkedAt: new Date().toISOString(),
      access: "not_authed",
      message: error instanceof Error ? error.message : String(error),
    };
    store.write(state);
    return state;
  }
}
