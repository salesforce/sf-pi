/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Skill-source interop detection and wiring for `/sf-pi skills`.
 *
 * Why this exists
 * ---------------
 * Pi loads skills from several conventional roots (see
 * pi-coding-agent/docs/skills.md). Two of those roots — `~/.pi/agent/skills`
 * and `~/.agents/skills` — are auto-discovered. Everything else
 * (`~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, arbitrary
 * project paths) has to be listed explicitly in `settings.json → skills[]`.
 *
 * Users coming from Claude Code or OpenAI Codex often have a sizeable
 * skill library in those directories and don't realize pi can read them
 * with a one-line settings edit. This helper detects the candidate
 * directories on disk, compares them against what the user has already
 * wired, and is used by the `/sf-pi skills` overlay to persist the
 * delta into `~/.pi/agent/settings.json`.
 *
 * Scope: this module never shells out to `pi install` and never runs
 * network. It is a pure settings-file writer + disk scanner.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { globalSettingsPath } from "../pi-paths.ts";

/**
 * A directory on disk that looks like a usable skill root.
 *
 * "Usable" means: it exists, it's a directory, and it either contains a
 * top-level `.md` skill file or a subdirectory with `SKILL.md`. We
 * deliberately don't validate frontmatter — pi does that at load time,
 * and we want the overlay to surface roots that are a few typos away
 * from loading successfully.
 */
export interface SkillSourceCandidate {
  /** Absolute path, with the user's home dir substituted back to `~` for display. */
  displayPath: string;
  /** Absolute path on disk. */
  absolutePath: string;
  /** The value we'll write to `skills[]` — uses `~/…` when under $HOME so
   *  the settings file stays portable across machines with different
   *  home paths. */
  settingsPath: string;
  /** Short human label shown in the overlay (e.g. "Claude Code"). */
  label: string;
  /** How many immediate skill entries we detected (skills + root `.md` files). */
  skillCount: number;
  /** True when this path already appears (verbatim or resolved) in the
   *  user's `settings.skills[]`. */
  wired: boolean;
}

interface KnownRoot {
  /** Absolute path (already ~-expanded) of the root to probe. */
  absolute: string;
  /** Value we write to settings when the user opts in. */
  settingsValue: string;
  /** Short label shown in the overlay. */
  label: string;
}

/**
 * Build the fixed list of external skill roots we probe for.
 *
 * Pi already auto-discovers `~/.pi/agent/skills` and `~/.agents/skills`,
 * so listing those in `skills[]` would be a no-op. We stick to roots
 * that genuinely require opt-in.
 */
function knownExternalRoots(home: string): KnownRoot[] {
  return [
    {
      absolute: path.join(home, ".claude", "skills"),
      settingsValue: "~/.claude/skills",
      label: "Claude Code",
    },
    {
      absolute: path.join(home, ".codex", "skills"),
      settingsValue: "~/.codex/skills",
      label: "OpenAI Codex",
    },
    {
      absolute: path.join(home, ".cursor", "skills"),
      settingsValue: "~/.cursor/skills",
      label: "Cursor",
    },
  ];
}

export interface SkillSourcesResult {
  /** Global settings file path used for wiring. */
  settingsPath: string;
  /** Every candidate root we detected on disk, wired or not. */
  candidates: SkillSourceCandidate[];
  /** Entries in `settings.skills[]` that point at a non-existent path.
   *  Surfaced so users can prune stale references. */
  staleWired: string[];
}

/**
 * Discover external skill roots on disk and cross-reference them with
 * the user's current `~/.pi/agent/settings.json → skills[]`.
 *
 * The result is safe to render even when the settings file is missing
 * or malformed — in that case every detected root reports `wired: false`
 * and `staleWired` is empty.
 */
export function detectSkillSources(home: string = os.homedir()): SkillSourcesResult {
  const settingsPath = globalSettingsPath();
  const wired = readWiredSkillPaths(settingsPath, home);

  const candidates: SkillSourceCandidate[] = [];
  for (const root of knownExternalRoots(home)) {
    if (!isDirectory(root.absolute)) continue;
    candidates.push({
      displayPath: toDisplayPath(root.absolute, home),
      absolutePath: root.absolute,
      settingsPath: root.settingsValue,
      label: root.label,
      skillCount: countSkillEntries(root.absolute),
      wired: wired.absolute.has(root.absolute) || wired.raw.has(root.settingsValue),
    });
  }

  const staleWired: string[] = [];
  for (const raw of wired.raw) {
    const resolved = resolvePath(raw, home);
    if (!resolved) continue;
    if (!isDirectory(resolved)) staleWired.push(raw);
  }

  return { settingsPath, candidates, staleWired };
}

/**
 * Update the global `~/.pi/agent/settings.json → skills[]` array.
 *
 * - `add`: values to insert (deduped against whatever's already there).
 * - `remove`: values to drop (matched verbatim *or* by resolved absolute path).
 *
 * Returns the updated array so the caller can show a summary. This is
 * the only write path used by `/sf-pi skills` — the overlay always
 * funnels through here so we have a single place that owns the JSON
 * shape and newline convention.
 */
export function updateSkillSources(args: {
  add: string[];
  remove: string[];
  home?: string;
  settingsFile?: string;
}): { settingsPath: string; skills: string[] } {
  const home = args.home ?? os.homedir();
  const settingsPath = args.settingsFile ?? globalSettingsPath();
  const root = readJsonObject(settingsPath);
  const current = Array.isArray(root.skills) ? (root.skills as unknown[]) : [];

  const existing: string[] = current.filter((v): v is string => typeof v === "string");
  const removeAbsolute = new Set(
    args.remove
      .map((value) => resolvePath(value, home))
      .filter((p): p is string => typeof p === "string"),
  );
  const removeRaw = new Set(args.remove);

  const retained = existing.filter((value) => {
    if (removeRaw.has(value)) return false;
    const resolved = resolvePath(value, home);
    if (resolved && removeAbsolute.has(resolved)) return false;
    return true;
  });

  const existingAbsolute = new Set(
    retained
      .map((value) => resolvePath(value, home))
      .filter((p): p is string => typeof p === "string"),
  );
  const existingRaw = new Set(retained);

  for (const value of args.add) {
    if (existingRaw.has(value)) continue;
    const resolved = resolvePath(value, home);
    if (resolved && existingAbsolute.has(resolved)) continue;
    retained.push(value);
    existingRaw.add(value);
    if (resolved) existingAbsolute.add(resolved);
  }

  // Only rewrite the file if something actually changed. This keeps the
  // mtime stable for no-op confirmations.
  const unchanged =
    retained.length === existing.length && retained.every((value, i) => value === existing[i]);
  if (unchanged) {
    return { settingsPath, skills: retained };
  }

  const nextRoot = { ...root, skills: retained };
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(nextRoot, null, 2)}\n`, "utf8");
  return { settingsPath, skills: retained };
}

// -------------------------------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------------------------------

interface WiredPaths {
  /** Raw strings as they appear in settings (e.g. "~/.claude/skills"). */
  raw: Set<string>;
  /** Fully-resolved absolute paths, used for cross-form comparison. */
  absolute: Set<string>;
}

function readWiredSkillPaths(settingsPath: string, home: string): WiredPaths {
  const result: WiredPaths = { raw: new Set(), absolute: new Set() };
  const root = readJsonObject(settingsPath);
  const skills = Array.isArray(root.skills) ? (root.skills as unknown[]) : [];
  for (const value of skills) {
    if (typeof value !== "string") continue;
    result.raw.add(value);
    const resolved = resolvePath(value, home);
    if (resolved) result.absolute.add(resolved);
  }
  return result;
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function resolvePath(value: string, home: string): string | null {
  if (!value) return null;
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  if (value === "~") return home;
  if (path.isAbsolute(value)) return value;
  // Relative paths are resolved against the user's home — settings are
  // global, so CWD is not a meaningful base here.
  return path.resolve(home, value);
}

function toDisplayPath(absolute: string, home: string): string {
  return absolute.startsWith(`${home}${path.sep}`)
    ? `~/${path.relative(home, absolute)}`
    : absolute;
}

function isDirectory(absolute: string): boolean {
  try {
    return statSync(absolute).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Count the discoverable skill entries under a root.
 *
 * We mirror pi's two discovery conventions without loading any files:
 *   - a subdirectory containing `SKILL.md` counts as one skill
 *   - a `.md` file at the root counts as one skill (only in roots that
 *     allow loose `.md`; safe-upper-bound elsewhere since pi ignores
 *     the rest)
 *
 * This is a cheap heuristic for the overlay label — it never throws.
 */
function countSkillEntries(root: string): number {
  let count = 0;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(root, entry);
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        if (existsSync(path.join(full, "SKILL.md"))) count += 1;
      } else if (st.isFile() && entry.toLowerCase().endsWith(".md")) {
        count += 1;
      }
    } catch {
      // Skip unreadable entries.
    }
  }
  return count;
}

/**
 * Summary string used by the splash nudge and `/sf-pi skills status`.
 *
 * Returns `null` when nothing needs attention (zero detected roots, or
 * every detected root already wired) so callers can hide the nudge.
 */
export function summarizeAvailableSkillSources(home: string = os.homedir()): {
  availableCount: number;
  totalSkillCount: number;
} | null {
  const result = detectSkillSources(home);
  const available = result.candidates.filter((c) => !c.wired);
  if (available.length === 0) return null;
  const totalSkillCount = available.reduce((sum, c) => sum + c.skillCount, 0);
  return { availableCount: available.length, totalSkillCount };
}
