/* SPDX-License-Identifier: Apache-2.0 */
/** Local non-secret cache for the docs collection catalog only. */
import { createStateStore } from "../../../lib/common/state-store.ts";
import type { DocsCollection } from "./types.ts";

const TTL_MS = 1000 * 60 * 60 * 24;

interface CatalogCacheState {
  fetchedAt?: number;
  collections?: DocsCollection[];
}

const store = createStateStore<CatalogCacheState>({
  namespace: "sf-docs",
  filename: "catalog-cache.json",
  schemaVersion: 1,
  defaults: {},
});

export function readCatalogCache(now = Date.now()): {
  hit: boolean;
  stale: boolean;
  fetchedAt?: number;
  collections?: DocsCollection[];
  path: string;
} {
  const state = store.read();
  const fetchedAt = state.fetchedAt;
  const collections = Array.isArray(state.collections) ? state.collections : undefined;
  if (!fetchedAt || !collections) return { hit: false, stale: true, path: store.path };
  return {
    hit: true,
    stale: now - fetchedAt > TTL_MS,
    fetchedAt,
    collections,
    path: store.path,
  };
}

export function writeCatalogCache(collections: DocsCollection[], now = Date.now()): void {
  store.write({ fetchedAt: now, collections: stripCollectionBodies(collections) });
}

export function clearCatalogCache(): void {
  store.write({});
}

function stripCollectionBodies(collections: DocsCollection[]): DocsCollection[] {
  return collections.map((collection) => ({ ...collection }));
}

export function formatCacheAge(fetchedAt?: number, now = Date.now()): string {
  if (!fetchedAt) return "none";
  const ageMs = Math.max(0, now - fetchedAt);
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
