/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Recommended-package install status for the welcome splash.
 *
 * Combines three sources to produce a single render-ready summary:
 *   1. catalog/recommendations.json  — the manifest (what is recommended)
 *   2. global + project settings.json packages[] — what is actually installed
 *   3. state file (recommendations overlay decisions) — remembers "declined"
 *
 * Precedence (per item):
 *   - settings.json match  → "installed"  (authoritative: reflects reality)
 *   - state file declined  → "declined"
 *   - otherwise            → "pending"
 *
 * The splash only needs counts + a short list of pending items, so this
 * helper is deliberately small and side-effect free. It never throws:
 * a malformed settings file or missing manifest degrades to "zero
 * recommendations" instead of breaking the splash.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { globalSettingsPath, projectSettingsPath } from "../../../lib/common/pi-paths.ts";
import { loadRecommendationsManifest } from "../../sf-pi-manager/lib/recommendations-manifest.ts";
import { readRecommendationsState } from "../../sf-pi-manager/lib/recommendations-state.ts";
import type { RecommendedItem } from "../../../catalog/types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Three levels up from extensions/sf-welcome/lib/ → package root.
const PACKAGE_ROOT = path.resolve(__dirname, "../../..");

export type RecommendationDisplayStatus = "installed" | "pending" | "declined";

export interface RecommendationStatusItem {
  id: string;
  name: string;
  status: RecommendationDisplayStatus;
}

export interface RecommendationsStatusSummary {
  total: number;
  installedCount: number;
  pendingCount: number;
  declinedCount: number;
  /** Items sorted: pending first, then installed, then declined. */
  items: RecommendationStatusItem[];
}

/**
 * Build the status summary used by the splash component.
 *
 * All inputs are read defensively. If anything fails the resulting
 * summary has `total === 0` and the splash simply hides the block.
 */
export function collectRecommendationsStatus(cwd: string): RecommendationsStatusSummary {
  const manifest = loadRecommendationsManifest(PACKAGE_ROOT);
  const items = Object.values(manifest.items);
  if (items.length === 0) {
    return { total: 0, installedCount: 0, pendingCount: 0, declinedCount: 0, items: [] };
  }

  const installedSources = collectInstalledPackageSources(cwd);
  const state = readRecommendationsState();

  const displayItems: RecommendationStatusItem[] = items.map((item) => {
    if (isItemInstalled(item, installedSources)) {
      return { id: item.id, name: item.name, status: "installed" };
    }
    if (state.decisions[item.id] === "declined") {
      return { id: item.id, name: item.name, status: "declined" };
    }
    return { id: item.id, name: item.name, status: "pending" };
  });

  displayItems.sort((a, b) => statusOrder(a.status) - statusOrder(b.status));

  const installedCount = displayItems.filter((i) => i.status === "installed").length;
  const pendingCount = displayItems.filter((i) => i.status === "pending").length;
  const declinedCount = displayItems.filter((i) => i.status === "declined").length;

  return {
    total: displayItems.length,
    installedCount,
    pendingCount,
    declinedCount,
    items: displayItems,
  };
}

/** Pending is most actionable, so it sorts first. */
function statusOrder(status: RecommendationDisplayStatus): number {
  switch (status) {
    case "pending":
      return 0;
    case "installed":
      return 1;
    case "declined":
      return 2;
  }
}

/**
 * Decide whether a recommended item is already installed in pi's settings.
 *
 * The manifest source strings look like "npm:pi-web-access" or
 * "git:github.com/user/repo". The settings file stores the *installed*
 * source verbatim, which for npm packages may be suffixed with a
 * version (e.g. "npm:pi-web-access@1.2.0"). Match on the normalized
 * name-part so "npm:pi-web-access" == "npm:pi-web-access@1.2.0".
 */
function isItemInstalled(item: RecommendedItem, installedSources: Set<string>): boolean {
  const normalized = normalizeSource(item.source);
  return installedSources.has(normalized);
}

function normalizeSource(source: string): string {
  const trimmed = source.trim().toLowerCase();
  if (trimmed.startsWith("npm:")) {
    const body = trimmed.slice(4);
    // Scoped names (@scope/name) contain one @ that must stay.
    // A trailing @version lives after the *last* @, so strip from there
    // only when it's not the leading scope character.
    const versionIndex = body.lastIndexOf("@");
    const name = versionIndex > 0 ? body.slice(0, versionIndex) : body;
    return `npm:${name}`;
  }
  // Git and local sources match on the whole string — no normalization.
  return trimmed;
}

/**
 * Return the set of installed package sources across global + project
 * settings, normalized so they can be compared to manifest entries.
 *
 * Shape in settings:
 *   "packages": [
 *     "npm:foo@1.2.0",
 *     { "source": "git:github.com/user/repo", "extensions": [...] }
 *   ]
 */
function collectInstalledPackageSources(cwd: string): Set<string> {
  const sources = new Set<string>();
  const settingsPaths = [globalSettingsPath(), projectSettingsPath(cwd)];

  for (const filePath of settingsPaths) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as {
        packages?: Array<string | { source?: string }>;
      };
      const packages = Array.isArray(parsed.packages) ? parsed.packages : [];
      for (const pkg of packages) {
        const source = typeof pkg === "string" ? pkg : pkg?.source;
        if (typeof source !== "string" || source.length === 0) continue;
        sources.add(normalizeSource(source));
      }
    } catch {
      // Malformed settings.json — skip; splash must never crash here.
    }
  }

  return sources;
}
