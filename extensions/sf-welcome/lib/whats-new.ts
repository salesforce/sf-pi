/* SPDX-License-Identifier: Apache-2.0 */
/**
 * What's New discovery for sf-welcome.
 *
 * Reads the CHANGELOG.md that ships with the installed pi-coding-agent
 * package, slices out the range between the user's last seen version and
 * the currently installed version, and distills it into a short list of
 * bullets for the splash screen's right column.
 *
 * Design goals:
 * - Zero network traffic: the changelog is always the local file.
 * - Failure is silent: if anything fails to resolve, the panel is omitted.
 * - Deterministic: same version pair always yields the same bullets.
 * - Capped length: never more than WHATSNEW_MAX_BULLETS lines on the splash.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readWelcomeState } from "./state-store.ts";

/** Upper bound on bullets rendered on the splash. */
export const WHATSNEW_MAX_BULLETS = 8;

/** Max bullets per section inside the final summary when both sections exist. */
const MAX_FIXED_BULLETS = 3;

/** Stem hints we prefer when filtering Fixed bullets. Users mostly care about
 * changes that could affect their extensions, providers, or tool flow. */
const FIXED_BULLET_PRIORITY_HINTS = ["provider", "extension", "tool", "beta", "stream"];

export interface WhatsNewBullet {
  /** Short text ready to render (no markdown links, no PR attribution). */
  text: string;
  /** Which section the bullet came from, used for visual grouping. */
  section: "feature" | "fix";
}

export interface WhatsNewPayload {
  /** Version the user had acknowledged before this launch, if any. */
  fromVersion?: string;
  /** Version currently installed. */
  toVersion: string;
  /** Distilled bullet list for the splash panel. */
  bullets: WhatsNewBullet[];
}

export interface ChangelogSection {
  version: string;
  date?: string;
  sections: Record<string, string[]>;
}

// -------------------------------------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------------------------------------

/**
 * Resolve the current pi version and the last-seen version, then build the
 * splash payload. Returns `null` when there is nothing new to show (same
 * version, downgrade, missing changelog, or first-ever launch).
 */
export function buildWhatsNewPayload(
  options: {
    statePath?: string;
    piPackagePath?: string;
  } = {},
): WhatsNewPayload | null {
  const current = readCurrentPiVersion(options.piPackagePath);
  if (!current) return null;

  const state = readWelcomeState(options.statePath);
  const lastSeen = state.lastSeenPiVersion;

  // First-ever launch — no previous version to compare against.
  // Returning null lets the caller persist the current version without
  // showing a panel the first time.
  if (!lastSeen) return null;

  if (!isVersionGreater(current, lastSeen)) return null;

  const changelogPath = resolveChangelogPath(options.piPackagePath);
  if (!changelogPath || !existsSync(changelogPath)) return null;

  let raw: string;
  try {
    raw = readFileSync(changelogPath, "utf-8");
  } catch {
    return null;
  }

  const sections = parseChangelog(raw);
  const relevant = sliceChangelog(sections, lastSeen, current);
  if (relevant.length === 0) return null;

  const bullets = summarizeChangelog(relevant);
  if (bullets.length === 0) return null;

  return {
    fromVersion: lastSeen,
    toVersion: current,
    bullets,
  };
}

// -------------------------------------------------------------------------------------------------
// Package/version resolution
// -------------------------------------------------------------------------------------------------

/**
 * Read the installed pi-coding-agent version.
 *
 * We resolve the package.json via Node's module resolver rather than globbing
 * node_modules so we always get the copy pi was actually loaded from.
 */
export function readCurrentPiVersion(piPackagePath?: string): string | undefined {
  const pkgPath = piPackagePath
    ? join(piPackagePath, "package.json")
    : resolvePackageJsonFromRequire();
  if (!pkgPath || !existsSync(pkgPath)) return undefined;
  try {
    const raw = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version.trim() ? pkg.version.trim() : undefined;
  } catch {
    return undefined;
  }
}

function resolvePackageJsonFromRequire(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve("@mariozechner/pi-coding-agent/package.json");
  } catch {
    return undefined;
  }
}

/** Locate the CHANGELOG.md that ships with the installed pi package. */
export function resolveChangelogPath(piPackagePath?: string): string | undefined {
  if (piPackagePath) return join(piPackagePath, "CHANGELOG.md");
  const pkgJson = resolvePackageJsonFromRequire();
  if (!pkgJson) return undefined;
  return join(dirname(pkgJson), "CHANGELOG.md");
}

// -------------------------------------------------------------------------------------------------
// Changelog parsing
// -------------------------------------------------------------------------------------------------

const VERSION_HEADER = /^##\s*\[(\d+\.\d+\.\d+[\w.-]*)\](?:\s*-\s*([\d-]+))?\s*$/;
const SECTION_HEADER = /^###\s+(.+?)\s*$/;
const BULLET_LINE = /^-\s+(.*)$/;

/**
 * Parse the pi CHANGELOG.md into structured sections.
 *
 * The CHANGELOG is hand-edited but very regular: `## [x.y.z] - date`
 * headers, followed by `### Section` subheaders, followed by `- bullet`
 * lines. We stream through line-by-line to stay resilient against the
 * occasional blank line or block quote.
 */
export function parseChangelog(raw: string): ChangelogSection[] {
  const lines = raw.split(/\r?\n/);
  const result: ChangelogSection[] = [];

  let currentVersion: ChangelogSection | null = null;
  let currentSection: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const versionMatch = line.match(VERSION_HEADER);
    if (versionMatch) {
      currentVersion = {
        version: versionMatch[1],
        date: versionMatch[2] || undefined,
        sections: {},
      };
      currentSection = null;
      result.push(currentVersion);
      continue;
    }

    if (!currentVersion) continue;

    const sectionMatch = line.match(SECTION_HEADER);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!currentVersion.sections[currentSection]) {
        currentVersion.sections[currentSection] = [];
      }
      continue;
    }

    if (!currentSection) continue;
    const bulletMatch = line.match(BULLET_LINE);
    if (bulletMatch) {
      const text = bulletMatch[1].trim();
      if (text) {
        currentVersion.sections[currentSection].push(text);
      }
    }
  }

  return result;
}

/**
 * Keep only the versions strictly newer than `from` and less-than-or-equal
 * to `to`. Input sections are assumed to be listed newest-first (as the
 * CHANGELOG is written). Result preserves that order so the summary starts
 * with the most recent changes first.
 */
export function sliceChangelog(
  sections: ChangelogSection[],
  from: string,
  to: string,
): ChangelogSection[] {
  return sections.filter(
    (section) => isVersionGreater(section.version, from) && !isVersionGreater(section.version, to),
  );
}

// -------------------------------------------------------------------------------------------------
// Summarization
// -------------------------------------------------------------------------------------------------

/**
 * Flatten the filtered sections into a capped bullet list.
 *
 * Priority order:
 *   1. All "New Features" / "Added" / "Changed" bullets, newest version first
 *   2. Up to MAX_FIXED_BULLETS "Fixed" bullets per version, prioritizing
 *      stems that hint at extension/provider/tool impact
 *   3. Hard-cap at WHATSNEW_MAX_BULLETS to keep the splash compact
 */
export function summarizeChangelog(sections: ChangelogSection[]): WhatsNewBullet[] {
  const out: WhatsNewBullet[] = [];

  // Pass 1: features (always kept)
  for (const section of sections) {
    const featureBullets = collectFeatureBullets(section);
    for (const text of featureBullets) {
      if (out.length >= WHATSNEW_MAX_BULLETS) return out;
      out.push({ text, section: "feature" });
    }
  }

  // Pass 2: fixes (capped per version + reordered by priority hint)
  for (const section of sections) {
    if (out.length >= WHATSNEW_MAX_BULLETS) return out;
    const fixBullets = collectFixBullets(section);
    for (const text of fixBullets) {
      if (out.length >= WHATSNEW_MAX_BULLETS) return out;
      out.push({ text, section: "fix" });
    }
  }

  return out;
}

function collectFeatureBullets(section: ChangelogSection): string[] {
  const names = Object.keys(section.sections);
  const featureSections = names.filter((name) => isFeatureSection(name));
  const raw = featureSections.flatMap((name) => section.sections[name] ?? []);
  const cleaned = raw.map(cleanBullet).filter((line) => line.length > 0);
  return dedupeKeepOrder(cleaned);
}

function collectFixBullets(section: ChangelogSection): string[] {
  const fixed = section.sections["Fixed"] ?? [];
  const cleaned = fixed.map(cleanBullet).filter((line) => line.length > 0);
  const prioritized = cleaned.slice().sort((a, b) => {
    const ra = priorityRank(a);
    const rb = priorityRank(b);
    if (ra !== rb) return ra - rb;
    return 0; // stable on ties
  });
  return dedupeKeepOrder(prioritized).slice(0, MAX_FIXED_BULLETS);
}

function isFeatureSection(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "new features" || lower === "added" || lower === "changed";
}

function priorityRank(text: string): number {
  const lower = text.toLowerCase();
  for (let i = 0; i < FIXED_BULLET_PRIORITY_HINTS.length; i++) {
    if (lower.includes(FIXED_BULLET_PRIORITY_HINTS[i])) return i;
  }
  return FIXED_BULLET_PRIORITY_HINTS.length;
}

/**
 * Strip GitHub issue/PR references and author attribution from the tail of a
 * changelog bullet. The panel is a marketing-grade summary, not a bug
 * tracker — reviewers can still open the CHANGELOG for the raw list.
 */
export function cleanBullet(raw: string): string {
  let text = raw.trim();
  // Drop author attribution fragments like "by [@handle](...)" first so
  // the subsequent issue-ref strip doesn't leave a dangling "by" word.
  text = text.replace(/\s*by\s*\[@[^\]]+\]\([^)]+\)/g, "").trim();
  // Drop inline PR/issue markdown links like [#1234](url) anywhere.
  text = text.replace(/\[#\d+\]\([^)]+\)/g, "").trim();
  // Drop trailing parentheses whose entire content was just refs + commas.
  text = text.replace(/\s*\(\s*[,\s]*\)\s*$/g, "").trim();
  // Collapse excess whitespace.
  text = text.replace(/\s{2,}/g, " ");
  // Trim trailing punctuation artifacts left over from the strip pass.
  text = text.replace(/\s*[,]\s*$/g, "").trim();
  return text;
}

function dedupeKeepOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

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
