/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared target-org resolution for Salesforce REST callers.
 *
 * REST tools need the same three things to build a safe request: target org,
 * the API version for that org, and org type for safety/display. Explicit
 * targets can differ from the active SF Pi environment, so we re-detect their
 * API version and org type instead of blindly reusing the default org values.
 */

import { detectOrg } from "../sf-environment/detect.ts";
import type { OrgInfo, OrgType, SfEnvironment } from "../sf-environment/types.ts";

export interface TargetOrgContext {
  /** Resolved alias/username, or undefined when no target is configured. */
  targetOrg?: string;
  /** API version used to build /services/data/vNN.N paths. */
  apiVersion: string;
  /** Org type for safety classification. "unknown" when detection failed. */
  orgType: OrgType | "unknown";
  /** OrgInfo for an explicit non-default target org, when detection succeeded. */
  targetOrgInfo?: OrgInfo;
}

/** Pick a target org name from explicit input, env config, or env org defaults. */
export function normalizeTargetOrg(
  targetOrg: string | undefined,
  env: SfEnvironment,
): string | undefined {
  const explicit = targetOrg?.trim();
  if (explicit) return explicit;
  return env.config.targetOrg ?? env.org.alias ?? env.org.username;
}

/** True iff the given target alias/username matches the active env's resolved org. */
export function targetMatchesEnvironment(targetOrg: string, env: SfEnvironment): boolean {
  return (
    targetOrg === env.config.targetOrg ||
    targetOrg === env.org.alias ||
    targetOrg === env.org.username
  );
}

/**
 * Detect the explicit target org via `@salesforce/core`. Returns undefined
 * when the requested org matches the active env (the cached values are already
 * authoritative) or when detection fails. Failed detection falls back to the
 * env values; callers remain responsible for fail-closed safety.
 */
export async function resolveExplicitTargetOrg(
  targetOrg: string | undefined,
  env: SfEnvironment,
): Promise<OrgInfo | undefined> {
  if (!targetOrg || targetMatchesEnvironment(targetOrg, env)) return undefined;
  const org = await detectOrg(targetOrg);
  return org.detected ? org : undefined;
}

/** Pick the org type to use for safety, preferring explicit target detection. */
export function resolveOrgType(
  targetOrg: string | undefined,
  env: SfEnvironment,
  targetOrgInfo?: OrgInfo,
): OrgType | "unknown" {
  if (!targetOrg) return "unknown";
  if (targetMatchesEnvironment(targetOrg, env)) return env.org.orgType;
  return targetOrgInfo?.orgType ?? "unknown";
}

/**
 * Pick the API version. Prefers the explicit target org's detected version,
 * then the active env, then the project sourceApiVersion. Throws if nothing
 * usable is available.
 */
export function resolveApiVersion(env: SfEnvironment, targetOrgInfo?: OrgInfo): string {
  return (
    targetOrgInfo?.apiVersion ??
    env.org.apiVersion ??
    env.project.sourceApiVersion ??
    throwMissingApiVersion()
  );
}

function throwMissingApiVersion(): never {
  throw new Error(
    "No Salesforce API version available. The target org could not be detected and no project sourceApiVersion is configured.",
  );
}

/** One-shot resolution for tool handlers: target org + api version + org type. */
export async function resolveTargetOrgContext(
  targetOrg: string | undefined,
  env: SfEnvironment,
): Promise<TargetOrgContext> {
  const resolvedTargetOrg = normalizeTargetOrg(targetOrg, env);
  const targetOrgInfo = await resolveExplicitTargetOrg(resolvedTargetOrg, env);
  const apiVersion = resolveApiVersion(env, targetOrgInfo);
  const orgType = resolveOrgType(resolvedTargetOrg, env, targetOrgInfo);
  return { targetOrg: resolvedTargetOrg, apiVersion, orgType, targetOrgInfo };
}
