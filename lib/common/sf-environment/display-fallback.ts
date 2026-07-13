/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared Salesforce org status fallback selection.
 *
 * Compact status surfaces can show a Last-Known Usable Status with a stale
 * marker when the Current Probe Status failed. The fallback is intentionally
 * identity-scoped: the successful snapshot must be for the same Salesforce
 * project root and configured target org, and it must include an org id.
 * Detailed diagnostics should still surface the raw current probe failure.
 */
import type { SfEnvironment } from "./types.ts";

const SF_ENVIRONMENT_ENTRY_TYPE = "sf-environment";

export interface DisplayOrgSelection {
  env: SfEnvironment | null;
  stale: boolean;
  currentError?: string;
}

export function selectDisplayOrgEnvironment(
  current: SfEnvironment | null,
  branchEnvironments: readonly SfEnvironment[],
  persisted: SfEnvironment | null,
): DisplayOrgSelection {
  if (current?.org?.detected) {
    return { env: current, stale: false };
  }

  const fallback = [...branchEnvironments]
    .reverse()
    .find((candidate) => isReusableOrgFallback(current, candidate));

  if (fallback) {
    return { env: fallback, stale: true, currentError: current?.org?.error };
  }

  if (persisted && isReusableOrgFallback(current, persisted)) {
    return { env: persisted, stale: true, currentError: current?.org?.error };
  }

  return { env: current, stale: false, currentError: current?.org?.error };
}

export function extractSfEnvironmentEntries(entries: readonly unknown[]): SfEnvironment[] {
  const environments: SfEnvironment[] = [];
  for (const entry of entries) {
    if (isSfEnvironmentEntry(entry)) {
      environments.push(entry.data.env);
    }
  }
  return environments;
}

function isReusableOrgFallback(current: SfEnvironment | null, candidate: SfEnvironment): boolean {
  if (!candidate?.org?.detected) return false;
  if (!candidate.org.orgId) return false;

  const currentProjectRoot = current?.project?.projectRoot;
  const currentTargetOrg = current?.config?.targetOrg;
  if (!currentProjectRoot || !currentTargetOrg) return false;

  return (
    candidate.project?.projectRoot === currentProjectRoot &&
    candidate.config?.targetOrg === currentTargetOrg
  );
}

function isSfEnvironmentEntry(
  entry: unknown,
): entry is { type: "custom"; customType: string; data: { env: SfEnvironment } } {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as { type?: unknown; customType?: unknown; data?: { env?: unknown } };
  return (
    candidate.type === "custom" &&
    candidate.customType === SF_ENVIRONMENT_ENTRY_TYPE &&
    !!candidate.data?.env &&
    typeof candidate.data.env === "object"
  );
}
