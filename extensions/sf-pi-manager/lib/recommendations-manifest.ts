/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Loader for catalog/recommendations.json.
 *
 * The manifest is hand-maintained and validated at `npm run generate-catalog`
 * time (see scripts/generate-catalog.mjs). At runtime we re-parse it but stay
 * tolerant: if the file is missing or malformed we return an empty manifest so
 * the manager extension never crashes a pi session over a recommendations bug.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RecommendationsManifest, RecommendedItem } from "../../../catalog/types.ts";

const EMPTY_MANIFEST: RecommendationsManifest = {
  schemaVersion: 1,
  revision: "",
  bundles: [],
  items: {},
};

/** Absolute path to catalog/recommendations.json relative to the package root. */
export function recommendationsManifestPath(packageRoot: string): string {
  return path.join(packageRoot, "catalog", "recommendations.json");
}

/**
 * Read + parse the manifest. Returns an empty manifest (schemaVersion 1,
 * blank revision, no items/bundles) when the file is missing or invalid.
 */
export function loadRecommendationsManifest(packageRoot: string): RecommendationsManifest {
  const filePath = recommendationsManifestPath(packageRoot);
  if (!existsSync(filePath)) {
    return EMPTY_MANIFEST;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return EMPTY_MANIFEST;
    if (parsed.schemaVersion !== 1) return EMPTY_MANIFEST;

    return {
      schemaVersion: 1,
      revision: typeof parsed.revision === "string" ? parsed.revision : "",
      bundles: Array.isArray(parsed.bundles) ? parsed.bundles : [],
      items: parsed.items && typeof parsed.items === "object" ? parsed.items : {},
    };
  } catch {
    return EMPTY_MANIFEST;
  }
}

/** Resolve a list of bundle ids into the set of items they include. */
export function resolveBundleItems(
  manifest: RecommendationsManifest,
  bundleIds: readonly string[],
): RecommendedItem[] {
  const seen = new Set<string>();
  const result: RecommendedItem[] = [];

  for (const bundleId of bundleIds) {
    const bundle = manifest.bundles.find((b) => b.id === bundleId);
    if (!bundle) continue;
    for (const itemId of bundle.items) {
      if (seen.has(itemId)) continue;
      const item = manifest.items[itemId];
      if (!item) continue;
      seen.add(itemId);
      result.push(item);
    }
  }

  return result;
}

/** All bundle ids marked `defaultOnFirstRun: true`. */
export function defaultFirstRunBundleIds(manifest: RecommendationsManifest): string[] {
  return manifest.bundles.filter((b) => b.defaultOnFirstRun).map((b) => b.id);
}
