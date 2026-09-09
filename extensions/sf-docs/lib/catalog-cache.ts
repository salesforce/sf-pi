/* SPDX-License-Identifier: Apache-2.0 */
/** Local non-secret cache for the docs collection catalog only. */
import { createHash } from "node:crypto";
import { createStateStore } from "../../../lib/common/state-store.ts";
import type {
  DocsCollection,
  DocsLandmark,
  DocsLandmarkLocaleDiff,
  DocsLandmarkSlice,
} from "./types.ts";

const TTL_MS = 1000 * 60 * 60 * 24;

interface CatalogCacheState {
  fetchedAt?: number;
  endpointHash?: string;
  collections?: DocsCollection[];
}

const store = createStateStore<CatalogCacheState>({
  namespace: "sf-docs",
  filename: "catalog-cache.json",
  schemaVersion: 1,
  defaults: {},
});

export function readCatalogCache(
  now = Date.now(),
  endpoint?: string,
): {
  hit: boolean;
  stale: boolean;
  fetchedAt?: number;
  collections?: DocsCollection[];
  path: string;
} {
  const state = store.read();
  const fetchedAt = state.fetchedAt;
  if (endpoint && state.endpointHash !== hashEndpoint(endpoint)) {
    return { hit: false, stale: true, path: store.path };
  }
  const collections = Array.isArray(state.collections)
    ? sanitizeCatalogCollections(state.collections)
    : undefined;
  if (!fetchedAt || !collections) return { hit: false, stale: true, path: store.path };
  return {
    hit: true,
    stale: now - fetchedAt > TTL_MS,
    fetchedAt,
    collections,
    path: store.path,
  };
}

export function writeCatalogCache(
  collections: DocsCollection[],
  now = Date.now(),
  endpoint?: string,
): void {
  store.write({
    fetchedAt: now,
    endpointHash: endpoint ? hashEndpoint(endpoint) : undefined,
    collections: sanitizeCatalogCollections(collections),
  });
}

export function clearCatalogCache(): void {
  store.write({});
}

function sanitizeCatalogCollections(collections: unknown[]): DocsCollection[] {
  return collections
    .filter(isRecord)
    .filter((collection) => typeof collection.collection === "string")
    .map((collection) => ({
      collection: collection.collection as string,
      ...optionalString("description", collection.description),
      ...optionalString("status", collection.status),
      ...optionalStringArray("versions", collection.versions),
      ...(isStringRecord(collection.versionLabels)
        ? { versionLabels: { ...collection.versionLabels } }
        : {}),
      ...optionalStringArray("locales", collection.locales),
      ...optionalStringArray("formats", collection.formats),
      ...optionalString("retrievalHints", collection.retrievalHints),
      ...optionalString("fetchHints", collection.fetchHints),
      ...(Array.isArray(collection.landmarks)
        ? { landmarks: collection.landmarks.filter(isRecord).map(sanitizeLandmarkSlice) }
        : {}),
      ...optionalStringArray("extraFields", collection.extraFields),
    }));
}

function sanitizeLandmarkSlice(slice: Record<string, unknown>): DocsLandmarkSlice {
  return {
    ...optionalString("version", slice.version),
    ...(Array.isArray(slice.landmarks)
      ? { landmarks: slice.landmarks.filter(isRecord).map(sanitizeLandmark) }
      : {}),
    ...(Array.isArray(slice.localeDiffs)
      ? { localeDiffs: slice.localeDiffs.filter(isRecord).map(sanitizeLocaleDiff) }
      : {}),
  };
}

function sanitizeLocaleDiff(diff: Record<string, unknown>): DocsLandmarkLocaleDiff {
  return {
    ...optionalStringArray("locales", diff.locales),
    ...(Array.isArray(diff.added)
      ? { added: diff.added.filter(isRecord).map(sanitizeLandmark) }
      : {}),
    ...(Array.isArray(diff.removed)
      ? { removed: diff.removed.filter(isRecord).map(sanitizeLandmark) }
      : {}),
  };
}

function sanitizeLandmark(landmark: Record<string, unknown>): DocsLandmark {
  return {
    ...optionalString("slug", landmark.slug),
    ...optionalString("label", landmark.label),
    ...optionalStringArray("members", landmark.members),
  };
}

function optionalString<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === "string" ? ({ [key]: value } as Record<K, string>) : {};
}

function optionalStringArray<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string[]>> {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? ({ [key]: [...value] } as Record<K, string[]>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string"),
  );
}

function hashEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
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
