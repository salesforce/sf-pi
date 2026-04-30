/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Loader for catalog/announcements.json.
 *
 * The manifest is hand-maintained and validated at `npm run generate-catalog`
 * time (see scripts/generate-catalog.mjs). At runtime we re-parse it but stay
 * tolerant: if the file is missing or malformed we return an empty manifest
 * so the splash never crashes a pi session over an announcements bug.
 *
 * Mirrors the recommendations-manifest.ts pattern intentionally \u2014 every
 * "hand-edited JSON feeds a splash panel" module in sf-pi should look the
 * same shape.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnnouncementItem, AnnouncementsManifest } from "../../../catalog/types.ts";

const EMPTY_MANIFEST: AnnouncementsManifest = {
  schemaVersion: 1,
  revision: "",
  announcements: [],
};

/** Absolute path to catalog/announcements.json relative to a package root. */
export function announcementsManifestPath(packageRoot: string): string {
  return join(packageRoot, "catalog", "announcements.json");
}

/**
 * Resolve the sf-pi package root at runtime.
 *
 * Used when callers do not pass an explicit root \u2014 e.g. the splash data
 * orchestrator, which doesn't otherwise know where the bundled manifest
 * lives. The splash extension ships inside the sf-pi package, so we walk
 * up from this file to the nearest `package.json`.
 */
export function resolveDefaultPackageRoot(): string | undefined {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    let current = here;
    // Walk up looking for the repo root (package.json + catalog/ sibling).
    // The sibling check prevents us stopping at a nested package.json inside
    // node_modules when sf-pi is installed as a linked dep.
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(current, "package.json")) && existsSync(join(current, "catalog"))) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read + parse the manifest. Returns an empty manifest (schemaVersion 1,
 * blank revision, empty announcements) when the file is missing or invalid.
 */
export function loadAnnouncementsManifest(packageRoot: string): AnnouncementsManifest {
  const filePath = announcementsManifestPath(packageRoot);
  if (!existsSync(filePath)) return EMPTY_MANIFEST;

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<AnnouncementsManifest> & {
      announcements?: unknown;
    };
    if (!parsed || typeof parsed !== "object") return EMPTY_MANIFEST;
    if (parsed.schemaVersion !== 1) return EMPTY_MANIFEST;

    const announcements = Array.isArray(parsed.announcements)
      ? parsed.announcements.filter(isValidAnnouncement)
      : [];

    return {
      schemaVersion: 1,
      revision: typeof parsed.revision === "string" ? parsed.revision : "",
      latestVersion:
        typeof parsed.latestVersion === "string" && parsed.latestVersion.trim()
          ? parsed.latestVersion.trim()
          : undefined,
      feedUrl:
        typeof parsed.feedUrl === "string" && parsed.feedUrl.trim()
          ? parsed.feedUrl.trim()
          : undefined,
      announcements,
    };
  } catch {
    return EMPTY_MANIFEST;
  }
}

/**
 * Shape guard used both at load time and when merging a remote feed. Any
 * field that is not a string is stripped so a malformed remote entry can
 * never crash the filter pipeline.
 */
export function isValidAnnouncement(value: unknown): value is AnnouncementItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id.trim()) return false;
  if (typeof v.title !== "string" || !v.title.trim()) return false;
  if (
    v.kind !== "note" &&
    v.kind !== "update" &&
    v.kind !== "breaking" &&
    v.kind !== "deprecation"
  ) {
    return false;
  }
  if (v.severity !== undefined && !["info", "warn", "critical"].includes(v.severity as string)) {
    return false;
  }
  return true;
}
