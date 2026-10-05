/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Thin lazy-loading wrapper around the official @sf-agentscript/agentforce SDK.
 *
 * Pi boots all extensions up front. Keep the AgentScript package behind one
 * cached import surface so users who never touch `.agent` files do not pay the
 * load cost, and so callers can render a helpful doctor/setup error if package
 * resolution fails.
 */

// Keep lazy loading for startup cost, but let the official package own its type
// surface so new schema/language capabilities do not require a local shadow
// interface update.
export type AgentforceSDK = typeof import("@sf-agentscript/agentforce");

// -------------------------------------------------------------------------------------------------
// Load + cache
// -------------------------------------------------------------------------------------------------

export const AGENTFORCE_SDK_PACKAGE = "@sf-agentscript/agentforce";

let cachedSdk: AgentforceSDK | null = null;
let loadError: Error | null = null;

/**
 * Load the official SDK once per process. Returns `null` if loading fails —
 * callers render a helpful setup note in that case instead of crashing.
 */
export async function loadAgentforceSDK(): Promise<AgentforceSDK | null> {
  if (cachedSdk) return cachedSdk;
  if (loadError) return null;

  try {
    const mod = (await import(AGENTFORCE_SDK_PACKAGE)) as AgentforceSDK;

    if (typeof mod.parse !== "function" || typeof mod.compileSource !== "function") {
      throw new Error("Official AgentScript SDK is missing parse() or compileSource() exports.");
    }

    cachedSdk = mod;
    return mod;
  } catch (error) {
    loadError = error instanceof Error ? error : new Error(String(error));
    return null;
  }
}

/**
 * Reason the SDK failed to load. Only meaningful after `loadAgentforceSDK()`
 * has been called and returned `null`.
 */
export function getSdkLoadError(): string | undefined {
  return loadError?.message;
}
