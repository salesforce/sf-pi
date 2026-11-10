/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared dotted-version comparison for SF Pi freshness and announcement filters.
 *
 * Pi owns package update notices and post-update changelogs, so SF Pi keeps no
 * changelog parser or release-note summarizer here.
 */

// -------------------------------------------------------------------------------------------------
// Version comparison
// -------------------------------------------------------------------------------------------------

/** Compare two dotted version strings. Returns true when `a` is strictly greater than `b`. */
export function isVersionGreater(a: string, b: string): boolean {
  return compareVersions(a, b) > 0;
}

/** Numeric-aware dotted-version comparison. Supports pre-release suffixes like "1.2.3-beta.1". */
export function compareVersions(a: string, b: string): number {
  const [aMain, aPre] = splitPrerelease(a);
  const [bMain, bPre] = splitPrerelease(b);

  const aParts = aMain.split(".").map((part) => toNumber(part));
  const bParts = bMain.split(".").map((part) => toNumber(part));
  const length = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < length; i++) {
    const x = aParts[i] ?? 0;
    const y = bParts[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }

  // Per semver, a version without a pre-release is greater than one with.
  if (!aPre && bPre) return 1;
  if (aPre && !bPre) return -1;
  if (!aPre && !bPre) return 0;
  return aPre.localeCompare(bPre);
}

function splitPrerelease(version: string): [string, string] {
  const trimmed = version.trim();
  const idx = trimmed.indexOf("-");
  if (idx < 0) return [trimmed, ""];
  return [trimmed.slice(0, idx), trimmed.slice(idx + 1)];
}

function toNumber(part: string): number {
  const n = Number(part);
  return Number.isFinite(n) ? n : 0;
}
