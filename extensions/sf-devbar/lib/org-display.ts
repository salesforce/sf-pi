/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Presentation helper for compact org status surfaces.
 *
 * The current probe can fail while an older successful org identity is still
 * useful for orientation. This module keeps that fallback logic out of the
 * bottom-bar renderer so detailed diagnostics can continue to report the raw
 * current probe result.
 */
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";

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
