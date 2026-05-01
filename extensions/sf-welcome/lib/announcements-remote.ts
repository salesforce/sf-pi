/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Optional remote feed fetcher for announcements.
 *
 * Design constraints (in priority order):
 *   1. **Silent failure.** Any error \u2014 timeout, DNS, non-200, malformed
 *      JSON, schema mismatch \u2014 must return `null` and never throw.
 *   2. **Opt-out first.** `SF_PI_ANNOUNCEMENTS_FEED=off` disables the
 *      fetch entirely. Settings-based feed opt-out is resolved by the
 *      parent orchestrator before this fetcher is called; we also honor
 *      the blanket `SF_PI_ANNOUNCEMENTS=off` toggle defensively.
 *   3. **Bounded.** 1.5s hard timeout, ~64 KB response cap, no redirects
 *      to unknown hosts. The feed is a maintainer-owned static JSON
 *      file \u2014 anything bigger or slower is almost certainly an attack
 *      surface, not legitimate content.
 *   4. **Conditional.** ETag-aware via the state cache so repeat launches
 *      don't re-download the same payload.
 *   5. **Offline-tolerant.** If we can't reach the feed but have a cached
 *      payload that is still fresh (24h), return the cache.
 *
 * This module never touches the disk directly for the ETag cache \u2014 it
 * accepts/returns a state object and lets announcements-state.ts own
 * persistence. Keeps it trivially unit-testable with a `fetchImpl` double.
 */
import type { AnnouncementsManifest, AnnouncementItem } from "../../../catalog/types.ts";
import { isValidAnnouncement } from "../../../lib/common/catalog-state/announcements-manifest.ts";
import type { AnnouncementsState } from "../../../lib/common/catalog-state/announcements-state.ts";

/** 1.5 seconds \u2014 generous enough for slow Wi-Fi, short enough for startup. */
const FETCH_TIMEOUT_MS = 1500;

/** 24-hour freshness window for the cached remote payload. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Stop reading after 64KB; anything larger is not a legitimate feed. */
const MAX_BYTES = 64 * 1024;

export interface RemoteFetchResult {
  announcements: AnnouncementItem[];
  /** Next state patch to persist (ETag + cache). Undefined when cache hit. */
  statePatch?: Pick<AnnouncementsState, "lastFetchAt" | "lastFetchEtag" | "cachedRemote">;
}

export interface RemoteFetchOptions {
  feedUrl?: string;
  state: AnnouncementsState;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** Injectable fetch for tests. Must match the global `fetch` signature. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch the remote feed, merging cache + network per the rules above.
 *
 * Returns `null` when the feature is opted out, no feedUrl is configured,
 * or the fetch fails and no fresh cache is available. Never throws.
 */
export async function fetchRemoteAnnouncements(
  options: RemoteFetchOptions,
): Promise<RemoteFetchResult | null> {
  const env = options.env ?? process.env;
  if (isFeedDisabled(env)) return null;
  if (!options.feedUrl) return null;

  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return readCache(options.state, now);

  // Honor an explicit cache-fresh window to avoid a network call every startup.
  const cacheAgeMs = ageMs(options.state.lastFetchAt, now);
  if (
    options.state.cachedRemote &&
    cacheAgeMs !== undefined &&
    cacheAgeMs < 5 * 60 * 1000 // 5 minutes
  ) {
    return readCache(options.state, now);
  }

  let response: Response;
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "sf-pi-announcements/1",
    };
    if (options.state.lastFetchEtag) {
      headers["If-None-Match"] = options.state.lastFetchEtag;
    }
    response = await withTimeout(
      fetchImpl(options.feedUrl, { headers, redirect: "error" }),
      FETCH_TIMEOUT_MS,
    );
  } catch {
    return readCache(options.state, now);
  }

  // 304 Not Modified: reuse the cached payload without re-parsing.
  if (response.status === 304) {
    return readCache(options.state, now, { touch: true });
  }
  if (!response.ok) {
    return readCache(options.state, now);
  }

  // Bounded read \u2014 never trust a remote to give us a reasonably-sized body.
  let body: string;
  try {
    body = await readBounded(response, MAX_BYTES);
  } catch {
    return readCache(options.state, now);
  }

  const parsed = safeParseManifest(body);
  if (!parsed) return readCache(options.state, now);

  return {
    announcements: parsed.announcements,
    statePatch: {
      lastFetchAt: now.toISOString(),
      lastFetchEtag: response.headers.get("etag") ?? undefined,
      cachedRemote: body,
    },
  };
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function isFeedDisabled(env: NodeJS.ProcessEnv): boolean {
  if ((env.SF_PI_ANNOUNCEMENTS ?? "").toLowerCase() === "off") return true;
  if ((env.SF_PI_ANNOUNCEMENTS_FEED ?? "").toLowerCase() === "off") return true;
  return false;
}

function readCache(
  state: AnnouncementsState,
  now: Date,
  opts: { touch?: boolean } = {},
): RemoteFetchResult | null {
  if (!state.cachedRemote) return null;
  const age = ageMs(state.lastFetchAt, now);
  if (age === undefined || age > CACHE_TTL_MS) return null;

  const parsed = safeParseManifest(state.cachedRemote);
  if (!parsed) return null;

  return {
    announcements: parsed.announcements,
    statePatch: opts.touch
      ? {
          lastFetchAt: now.toISOString(),
          lastFetchEtag: state.lastFetchEtag,
          cachedRemote: state.cachedRemote,
        }
      : undefined,
  };
}

function ageMs(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return undefined;
  return Math.max(0, now.getTime() - ts);
}

function safeParseManifest(body: string): AnnouncementsManifest | null {
  try {
    const parsed = JSON.parse(body) as Partial<AnnouncementsManifest> & {
      announcements?: unknown;
    };
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.schemaVersion !== 1) return null;
    const announcements = Array.isArray(parsed.announcements)
      ? parsed.announcements.filter(isValidAnnouncement)
      : [];
    return {
      schemaVersion: 1,
      revision: typeof parsed.revision === "string" ? parsed.revision : "",
      latestVersion: typeof parsed.latestVersion === "string" ? parsed.latestVersion : undefined,
      feedUrl: typeof parsed.feedUrl === "string" ? parsed.feedUrl : undefined,
      announcements,
    };
  } catch {
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  // Prefer the streaming reader when available so we can stop mid-body on
  // oversized responses. Fall back to response.text() for environments
  // where body streams aren't exposed (older Node undici builds).
  const body = response.body;
  if (!body) return await response.text();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      throw new Error("response too large");
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(buffer);
}
