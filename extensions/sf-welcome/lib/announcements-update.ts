/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Build the synthetic "sf-pi update available" announcement.
 *
 * Why synthesize instead of shipping a real entry: the update nudge has to
 * compare installed vs latest at runtime. We can't encode "if your version
 * is < X, show this" in the static bundled file without a filter pass
 * anyway, so we generate the item on the fly and funnel it through the
 * same filter/render pipeline as regular notes.
 *
 * Update summary reuses sf-welcome's existing CHANGELOG parser (whats-new.ts)
 * so the body lists the same feature/fix bullets the splash's What's New
 * panel would \u2014 except we read the repo-local CHANGELOG.md instead of
 * pi-coding-agent's.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnnouncementItem } from "../../../catalog/types.ts";
import {
  compareVersions,
  parseChangelog,
  sliceChangelog,
  summarizeChangelog,
} from "./whats-new.ts";

/**
 * Stable id so state dismissals survive across update-nudge rebuilds. The
 * user can dismiss once and never see this nudge again until they update
 * (after which installedVersion >= latestVersion and the nudge is no
 * longer generated at all).
 */
export const UPDATE_NUDGE_ID = "sf-pi-update-available";

export interface UpdateNudgeInput {
  installedVersion?: string;
  latestVersion?: string;
  /** Repo root, for reading CHANGELOG.md. */
  packageRoot?: string;
  /** Max bullet count appended to the body. Keep small \u2014 this renders
   * inside a single announcement entry, not a dedicated panel. */
  maxBullets?: number;
}

/**
 * Returns an AnnouncementItem when an update is available, otherwise undefined.
 *
 * The item deliberately carries `kind: "update"` and `severity: "warn"` so
 * it rises above regular notes in the sort order but doesn't trigger the
 * critical styling reserved for breaking changes.
 */
export function buildUpdateAnnouncement(input: UpdateNudgeInput): AnnouncementItem | undefined {
  const { installedVersion, latestVersion, packageRoot, maxBullets = 3 } = input;
  if (!installedVersion || !latestVersion) return undefined;
  if (compareVersions(latestVersion, installedVersion) <= 0) return undefined;

  const bullets = packageRoot
    ? summarizeRepoChangelog(packageRoot, installedVersion, latestVersion, maxBullets)
    : [];

  const bodyLines = [
    `Run: pi update git:github.com/salesforce/sf-pi`,
    "",
    ...(bullets.length > 0 ? [`Highlights since v${installedVersion}:`, ...bullets] : []),
  ];

  return {
    id: UPDATE_NUDGE_ID,
    kind: "update",
    severity: "warn",
    title: `sf-pi v${latestVersion} available (you're on v${installedVersion})`,
    body: bodyLines.join("\n"),
    link: `https://github.com/salesforce/sf-pi/releases/tag/v${latestVersion}`,
    publishedAt: new Date().toISOString(),
  };
}

/**
 * Pull bullets from CHANGELOG.md for versions strictly greater than
 * `installedVersion` and less-than-or-equal to `latestVersion`.
 */
function summarizeRepoChangelog(
  packageRoot: string,
  installedVersion: string,
  latestVersion: string,
  maxBullets: number,
): string[] {
  const changelogPath = join(packageRoot, "CHANGELOG.md");
  if (!existsSync(changelogPath)) return [];
  let raw: string;
  try {
    raw = readFileSync(changelogPath, "utf8");
  } catch {
    return [];
  }

  const sections = parseChangelog(raw);
  const relevant = sliceChangelog(sections, installedVersion, latestVersion);
  if (relevant.length === 0) return [];

  const summary = summarizeChangelog(relevant);
  return summary.slice(0, maxBullets).map((bullet) => `  \u2022 ${bullet.text}`);
}
