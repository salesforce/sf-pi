/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Welcome-screen adapter for the shared Salesforce environment runtime.
 *
 * The shared lib/common/sf-environment/ module owns the detection chain and
 * in-memory cache. sf-welcome reuses that snapshot so startup only runs one
 * set of SF CLI commands even when multiple extensions need environment data.
 */
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
  type SharedExecFn as SfExecFn,
} from "../../../lib/common/sf-environment/shared-runtime.ts";
import type { SfEnvironment as SharedSfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import type { SfEnvironmentInfo } from "./types.ts";

export type { SfExecFn };

export async function detectSfEnvironment(
  exec: SfExecFn,
  cwd: string,
  options?: { force?: boolean },
): Promise<SfEnvironmentInfo> {
  const env = await getSharedSfEnvironment(exec, cwd, options);
  return toSfEnvironmentInfo(env, { source: "live" });
}

export function getCachedSfEnvironmentInfo(cwd: string): SfEnvironmentInfo | null {
  const env = getCachedSfEnvironment(cwd);
  return env ? toSfEnvironmentInfo(env, { source: "cached" }) : null;
}

export function toSfEnvironmentInfo(
  env: SharedSfEnvironment,
  options?: { source?: "cached" | "live"; refreshing?: boolean },
): SfEnvironmentInfo {
  return {
    cliInstalled: env.cli.installed,
    cliVersion: env.cli.version,
    defaultOrg: env.config.targetOrg ?? env.org.alias ?? env.org.username,
    orgType: env.org.detected && env.org.orgType !== "unknown" ? env.org.orgType : undefined,
    connected: env.org.detected ? env.org.connectedStatus === "Connected" : undefined,
    instanceUrl: env.org.instanceUrl,
    apiVersion: env.org.apiVersion,
    configScope: env.config.location,
    detectedAt: env.detectedAt,
    source: options?.source ?? "live",
    refreshing: options?.refreshing ?? false,
    loading: false,
  };
}
