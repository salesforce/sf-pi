/* SPDX-License-Identifier: Apache-2.0 */
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;

type CacheEntry<T> = {
  value: T;
  loadedAt: number;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();

export function cacheKey(parts: Array<string | number | undefined>): string {
  return parts.map((p) => String(p ?? "")).join("|");
}

export function getCached<T>(
  key: string,
  force = false,
): { value: T; loadedAt: number } | undefined {
  if (force) return undefined;
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return { value: entry.value, loadedAt: entry.loadedAt };
}

export function setCached<T>(
  key: string,
  value: T,
  ttlMs = DEFAULT_CACHE_TTL_MS,
): { value: T; loadedAt: number } {
  const loadedAt = Date.now();
  cache.set(key, { value, loadedAt, expiresAt: loadedAt + ttlMs });
  return { value, loadedAt };
}

export function clearExplorerCache(): void {
  cache.clear();
}

function formatAge(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s` : `${min}m`;
}

export function cacheStatus(kind: string, cached: boolean, loadedAt: number): string {
  return cached
    ? `Serving ${kind} from cache (age ${formatAge(Date.now() - loadedAt)}, TTL 15m). Use refresh to force reload.`
    : `Refreshed ${kind} cache at ${new Date(loadedAt).toLocaleTimeString()} (TTL 15m).`;
}
