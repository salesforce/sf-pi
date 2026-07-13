/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Status-only Pi auth-store inspection.
 *
 * Execution paths should use `ctx.modelRegistry.getApiKeyForProvider()` so Pi
 * owns credential retrieval. This helper exists for config/status surfaces that
 * do not receive an ExtensionContext. It intentionally reports only whether a
 * provider appears configured; it never returns token values.
 */
import { existsSync, readFileSync } from "node:fs";
import { globalAgentPath } from "./pi-paths.ts";

export type PiAuthProviderStatusSource = "pi-auth-store" | "missing" | "unavailable";

export interface PiAuthProviderStatus {
  provider: string;
  configured: boolean;
  source: PiAuthProviderStatusSource;
}

export function getPiAuthStorePath(): string {
  return globalAgentPath("auth.json");
}

export function readPiAuthProviderStatus(
  provider: string,
  authPath: string = getPiAuthStorePath(),
): PiAuthProviderStatus {
  if (!existsSync(authPath)) return { provider, configured: false, source: "missing" };

  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf8")) as Record<
      string,
      { access?: unknown; token?: unknown }
    >;
    const entry = parsed?.[provider];
    const configured = [entry?.access, entry?.token].some(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
    return { provider, configured, source: "pi-auth-store" };
  } catch {
    return { provider, configured: false, source: "unavailable" };
  }
}
