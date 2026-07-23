/* SPDX-License-Identifier: Apache-2.0 */
/** Explicit, non-copying cleanup for legacy Gateway config credentials. */
import {
  globalGatewayConfigPath,
  projectGatewayConfigPath,
  readGatewaySavedConfig,
  writeGatewaySavedConfig,
} from "./config.ts";

export const LEGACY_TOKEN_MIGRATION_RELEASE = "0.235.0";
export const LEGACY_TOKEN_CUTOFF_EARLIEST = "0.236.0";

export type GatewayConfigScope = "global" | "project";

export type LegacyTokenRemovalResult =
  | { status: "absent"; path: string }
  | { status: "native-verification-required"; path: string }
  | { status: "confirmation-required"; path: string }
  | { status: "removed"; path: string };

function configPath(cwd: string, scope: GatewayConfigScope): string {
  return scope === "project" ? projectGatewayConfigPath(cwd) : globalGatewayConfigPath();
}

export function hasLegacyGatewayToken(cwd: string, scope: GatewayConfigScope): boolean {
  return Boolean(readGatewaySavedConfig(configPath(cwd, scope)).apiKey?.trim());
}

export function removeLegacyGatewayToken(input: {
  cwd: string;
  scope: GatewayConfigScope;
  nativeVerified: boolean;
  confirmed: boolean;
}): LegacyTokenRemovalResult {
  const path = configPath(input.cwd, input.scope);
  const saved = readGatewaySavedConfig(path);
  if (!saved.apiKey?.trim()) return { status: "absent", path };
  if (!input.nativeVerified) return { status: "native-verification-required", path };
  if (!input.confirmed) return { status: "confirmation-required", path };

  delete saved.apiKey;
  writeGatewaySavedConfig(path, saved);
  return { status: "removed", path };
}
