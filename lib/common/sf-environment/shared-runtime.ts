/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared Salesforce environment runtime cache.
 *
 * Provides the in-memory + persisted detection cache that any extension can
 * reuse to avoid running duplicate SF CLI checks during startup.
 *
 * Contract:
 * - cache is keyed by project root/cwd so callers in the same session share results
 * - the last successful snapshot is persisted to disk for the next launch
 * - per-session state is persisted via Pi's appendEntry() when a Pi API handle
 *   is bound, so org state participates in /tree navigation and branching
 * - in-flight detection is shared across concurrent callers
 * - force refresh bypasses cached values but still reuses an existing in-flight run
 */
import { detectEnvironment, type ExecFn } from "./detect.ts";
import {
  getEnvironmentCacheKey,
  readPersistedSfEnvironment,
  writePersistedSfEnvironment,
} from "./persisted-cache.ts";
import { clearSalesforceConnectionCache } from "../sf-conn/index.ts";
import type { SfEnvironment } from "./types.ts";
import type { CustomEntry, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Shape of the `data` payload we persist per-session org state into. */
interface SfEnvironmentEntryData {
  env: SfEnvironment;
}

/**
 * Type guard for `custom` session entries written by this module. The session
 * store returns the union of all entry types; we only care about our own.
 */
function isSfEnvironmentEntry(
  entry: unknown,
): entry is CustomEntry<SfEnvironmentEntryData> & { data: SfEnvironmentEntryData } {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as { type?: string; customType?: string; data?: { env?: unknown } };
  return (
    candidate.type === "custom" && candidate.customType === ENTRY_TYPE && !!candidate.data?.env
  );
}

/** Custom entry type used for per-session org state persistence. */
const ENTRY_TYPE = "sf-environment";

interface CacheEntry {
  value?: SfEnvironment;
  inFlight?: Promise<SfEnvironment>;
  refreshInFlight?: Promise<SfEnvironment>;
  generation?: number;
}

const cache = new Map<string, CacheEntry>();

/** Bound Pi API handle for session-level persistence via appendEntry. */
let boundPi: ExtensionAPI | null = null;

export type SharedExecFn = ExecFn;

/**
 * Bind a Pi extension API handle so the shared runtime can persist
 * detection results into the session via appendEntry().
 *
 * Call this once from your extension's factory function. The binding
 * is global (shared across all callers of getSharedSfEnvironment).
 */
export function bindPiForSessionPersistence(pi: ExtensionAPI): void {
  boundPi = pi;
}

/**
 * Restore per-session org state from session entries on resume/startup.
 *
 * Call from session_start to hydrate the in-memory cache from previously
 * persisted appendEntry data. This lets the cache survive session resume
 * and participates in /tree branching.
 */
export function restoreFromSessionEntries(ctx: ExtensionContext, cwd: string): void {
  const entries = ctx.sessionManager.getBranch();

  // Walk backwards to find the most recent sf-environment entry
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (isSfEnvironmentEntry(entry)) {
      const cacheEntry = getOrCreateEntry(cwd);
      cacheEntry.value = entry.data.env;
      return;
    }
  }
}

export async function getSharedSfEnvironment(
  exec: SharedExecFn,
  cwd: string,
  options?: { force?: boolean },
): Promise<SfEnvironment> {
  const entry = getOrCreateEntry(cwd);

  if (entry.inFlight) {
    return entry.inFlight;
  }

  if (!options?.force) {
    const cached = getCachedSfEnvironment(cwd);
    if (cached) {
      entry.value = cached;
      return cached;
    }
  }

  return startDetection(exec, cwd, entry);
}

/**
 * Perform a user-requested deep refresh.
 *
 * Unlike `{ force: true }`, which only bypasses the environment snapshot for
 * background cache refreshes, this path waits for same-cwd detection to settle
 * and recreates the resolved target Org/Connection. Concurrent explicit
 * refreshes share one replacement run.
 */
export async function refreshSharedSfEnvironment(
  exec: SharedExecFn,
  cwd: string,
): Promise<SfEnvironment> {
  const entry = getOrCreateEntry(cwd);
  if (entry.refreshInFlight) return entry.refreshInFlight;

  const refresh = (async () => {
    const previousDetection = entry.inFlight;
    if (previousDetection) {
      try {
        await previousDetection;
      } catch {
        // A failed prior detection must not prevent the explicit retry.
      }
    }
    return startDetection(exec, cwd, entry, { freshOrgConnection: true });
  })();

  entry.refreshInFlight = refresh;
  try {
    return await refresh;
  } finally {
    if (entry.refreshInFlight === refresh) entry.refreshInFlight = undefined;
  }
}

function startDetection(
  exec: SharedExecFn,
  cwd: string,
  entry: CacheEntry,
  options: { freshOrgConnection?: boolean } = {},
): Promise<SfEnvironment> {
  const generation = (entry.generation ?? 0) + 1;
  entry.generation = generation;

  const inFlight = detectEnvironment(exec, cwd, options)
    .then((env) => {
      if (entry.generation === generation) {
        entry.value = env;

        // Persist to disk for cross-session warm starts.
        try {
          writePersistedSfEnvironment(cwd, env);
        } catch {
          // Cache persistence is best-effort. Keep the fresh in-memory result.
        }

        // Persist to session entries for branching/resume support.
        if (boundPi) boundPi.appendEntry(ENTRY_TYPE, { env });
      }
      if (entry.inFlight === inFlight) entry.inFlight = undefined;
      return env;
    })
    .catch((error) => {
      if (entry.inFlight === inFlight) entry.inFlight = undefined;
      throw error;
    });

  entry.inFlight = inFlight;
  return inFlight;
}

export function getCachedSfEnvironment(cwd: string): SfEnvironment | null {
  const entry = getOrCreateEntry(cwd);
  if (entry.value) {
    return entry.value;
  }

  const persisted = readPersistedSfEnvironment(cwd);
  if (!persisted) {
    return null;
  }

  entry.value = persisted;
  return persisted;
}

export function peekSharedSfEnvironment(cwd: string): SfEnvironment | null {
  return cache.get(getEnvironmentCacheKey(cwd))?.value ?? null;
}

/**
 * Drop the in-memory env snapshot cache.
 *
 * - Called with no args: wipe every cwd. Also drops the global
 *   `@salesforce/core` Org/Connection cache from `lib/common/sf-conn` so
 *   the next detection re-reads auth files. This keeps the two caches
 *   in lock-step on session-wide refreshes.
 * - Called with a `cwd`: scoped delete. Leaves the Connection cache
 *   intact because it's keyed by org alias, not cwd.
 */
export function clearSharedSfEnvironment(cwd?: string): void {
  if (cwd === undefined) {
    cache.clear();
    clearSalesforceConnectionCache();
    return;
  }

  cache.delete(getEnvironmentCacheKey(cwd));
}

function getOrCreateEntry(cwd: string): CacheEntry {
  const key = getEnvironmentCacheKey(cwd);
  let entry = cache.get(key);
  if (!entry) {
    entry = {};
    cache.set(key, entry);
  }
  return entry;
}
