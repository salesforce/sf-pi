/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pure filtering + merging logic for announcement items.
 *
 * Split out of the orchestrator so these rules can be unit-tested without
 * touching the filesystem, the network, or the splash component.
 *
 * Filter order matters:
 *   1. Dedupe by id (remote > bundled; remote acts as "patch" layer)
 *   2. Drop dismissed ids
 *   3. Drop expired items
 *   4. Drop items outside minVersion..maxVersion
 *   5. Sort by severity, then publishedAt desc, then title
 *   6. Cap to max visible count
 */
import type { AnnouncementItem, AnnouncementSeverity } from "../../../catalog/types.ts";
import { compareVersions } from "./whats-new.ts";

/** Maximum announcements rendered on the splash panel. */
export const MAX_VISIBLE_ANNOUNCEMENTS = 3;

const SEVERITY_RANK: Record<AnnouncementSeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

export interface FilterContext {
  /** Installed sf-pi version (from package.json). */
  installedVersion?: string;
  /** Current time. Injectable for tests. */
  now?: Date;
  /** Ids the user has dismissed \u2014 keyed by announcement id. */
  dismissed: Record<string, string>;
  /** Upper bound on visible items. */
  maxVisible?: number;
}

/**
 * Merge bundled + remote announcements, preferring remote entries when the
 * same id exists in both (so maintainers can "patch" a bundled note by
 * publishing a fresher remote entry with the same id).
 */
export function mergeAnnouncements(
  bundled: readonly AnnouncementItem[],
  remote: readonly AnnouncementItem[],
): AnnouncementItem[] {
  const byId = new Map<string, AnnouncementItem>();
  for (const item of bundled) byId.set(item.id, item);
  for (const item of remote) byId.set(item.id, item);
  return Array.from(byId.values());
}

/**
 * Apply every filter rule and return the ordered, capped list to render.
 */
export function filterAnnouncements(
  items: readonly AnnouncementItem[],
  context: FilterContext,
): AnnouncementItem[] {
  const now = context.now ?? new Date();
  const dismissed = context.dismissed;
  const max = context.maxVisible ?? MAX_VISIBLE_ANNOUNCEMENTS;

  const active = items.filter((item) => {
    if (dismissed[item.id]) return false;
    if (isExpired(item, now)) return false;
    if (!matchesVersionRange(item, context.installedVersion)) return false;
    return true;
  });

  active.sort(compareAnnouncements);
  return active.slice(0, max);
}

export function isExpired(item: AnnouncementItem, now: Date): boolean {
  if (!item.expiresAt) return false;
  const expires = Date.parse(item.expiresAt);
  if (!Number.isFinite(expires)) return false;
  return expires < now.getTime();
}

export function matchesVersionRange(
  item: AnnouncementItem,
  installedVersion: string | undefined,
): boolean {
  if (!installedVersion) return true;
  if (item.minVersion && compareVersions(installedVersion, item.minVersion) < 0) {
    return false;
  }
  if (item.maxVersion && compareVersions(installedVersion, item.maxVersion) > 0) {
    return false;
  }
  return true;
}

/**
 * Ordering: critical > warn > info, then newest publishedAt first, then
 * title as a stable tiebreaker.
 */
export function compareAnnouncements(a: AnnouncementItem, b: AnnouncementItem): number {
  const severityDelta = severityRank(a) - severityRank(b);
  if (severityDelta !== 0) return severityDelta;

  const tsDelta = publishedAtMs(b) - publishedAtMs(a);
  if (tsDelta !== 0) return tsDelta;

  return a.title.localeCompare(b.title);
}

function severityRank(item: AnnouncementItem): number {
  return SEVERITY_RANK[item.severity ?? "info"];
}

function publishedAtMs(item: AnnouncementItem): number {
  if (!item.publishedAt) return 0;
  const parsed = Date.parse(item.publishedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}
