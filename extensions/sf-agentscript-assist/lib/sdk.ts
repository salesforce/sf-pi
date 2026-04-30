/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Thin wrapper around the vendored @agentscript/agentforce SDK.
 *
 * The SDK is the single-file `browser.js` bundle in `./vendor/agentforce/`.
 * We lazy-import it so an extension load failure doesn't crash pi, and we
 * cache the loaded module for the session.
 *
 * Why lazy + cached:
 *  - Pi boots all extensions up front. We don't want `.agent` users to pay
 *    nothing if they never edit one.
 *  - The bundle is ~800 KB gzipped on disk, a few ms to eval.
 *  - We want to keep the SDK import behind a single surface so tests can
 *    stub it easily.
 *
 * Anything the rest of the extension needs from the SDK lives here.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

// -------------------------------------------------------------------------------------------------
// Shape of the vendored SDK we depend on
// -------------------------------------------------------------------------------------------------

export interface AgentforceSDK {
  parse: (source: string) => {
    hasErrors: boolean;
    diagnostics: readonly unknown[];
  };
  compileSource: (source: string) => {
    output: unknown;
    diagnostics: unknown[];
  };
  resolveDialect: (
    source: string,
    config: { dialects: unknown[]; defaultDialect?: string },
  ) => {
    dialect: { name: string };
    unknownDialect?: {
      name: string;
      availableNames: string[];
    };
  };
  parseDialectAnnotation: (source: string) => {
    name: string;
    version?: string;
  } | null;
  findSuggestion: (name: string, candidates: string[]) => string | undefined;
  agentforceDialect: unknown;
}

// -------------------------------------------------------------------------------------------------
// Load + cache
// -------------------------------------------------------------------------------------------------

let cachedSdk: AgentforceSDK | null = null;
let loadError: Error | null = null;

/**
 * Path to the vendored bundle. Exported so the doctor command can show the
 * same path it actually loaded.
 */
export const VENDORED_SDK_PATH = path.resolve(
  new URL(".", import.meta.url).pathname,
  "vendor",
  "agentforce",
  "browser.js",
);

/**
 * Load the vendored SDK once per process. Returns `null` if loading fails —
 * callers render a helpful setup note in that case instead of crashing.
 */
export async function loadAgentforceSDK(): Promise<AgentforceSDK | null> {
  if (cachedSdk) return cachedSdk;
  if (loadError) return null;

  try {
    const moduleUrl = pathToFileURL(VENDORED_SDK_PATH).href;
    const mod = (await import(moduleUrl)) as AgentforceSDK;

    if (typeof mod.parse !== "function" || typeof mod.compileSource !== "function") {
      throw new Error("Vendored SDK is missing parse() or compileSource() exports.");
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
