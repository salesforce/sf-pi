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
import { globalSettingsPath, projectSettingsPath } from "../pi-paths.ts";

/** Where a candidate writes when the user opts it in. */
export type SkillSourceScope = "global" | "project";

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
   *  candidate's target settings file. */
  wired: boolean;
  /** Which settings file this candidate writes to when wired in. */
  scope: SkillSourceScope;
}

interface KnownRoot {
  /** Absolute path (already ~-expanded) of the root to probe. */
  absolute: string;
  /** Value we write to settings when the user opts in. */
  settingsValue: string;
  /** Short label shown in the overlay. */
  label: string;
  /** Which settings file the value belongs in. */
  scope: SkillSourceScope;
}

/**
 * Build the fixed list of external skill roots we probe for at *global*
 * scope. Pi already auto-discovers `~/.pi/agent/skills` and
 * `~/.agents/skills`, so listing those in `skills[]` would be a no-op.
 * We stick to roots that genuinely require opt-in.
 */
function knownGlobalRoots(home: string): KnownRoot[] {
  return [
    {
      absolute: path.join(home, ".claude", "skills"),
      settingsValue: "~/.claude/skills",
      label: "Claude Code",
      scope: "global",
    },
    {
      absolute: path.join(home, ".codex", "skills"),
      settingsValue: "~/.codex/skills",
      label: "OpenAI Codex",
      scope: "global",
    },
    {
      absolute: path.join(home, ".cursor", "skills"),
      settingsValue: "~/.cursor/skills",
      label: "Cursor",
      scope: "global",
    },
  ];
}

/**
 * Build the fixed list of external skill roots we probe for at *project*
 * scope. These mirror the global roots but live inside the current
 * working tree (e.g. a repo that ships its own `.claude/skills`). They
 * write to `<cwd>/.pi/settings.json` so the wiring is per-project.
 *
 * `.pi/skills` and `.agents/skills` are intentionally excluded — pi
 * auto-discovers those, so wiring them up is a no-op.
 */
function knownProjectRoots(cwd: string): KnownRoot[] {
  return [
    {
      absolute: path.join(cwd, ".claude", "skills"),
      settingsValue: "./.claude/skills",
      label: "Claude Code (project)",
      scope: "project",
    },
    {
      absolute: path.join(cwd, ".codex", "skills"),
      settingsValue: "./.codex/skills",
      label: "OpenAI Codex (project)",
      scope: "project",
    },
    {
      absolute: path.join(cwd, ".cursor", "skills"),
      settingsValue: "./.cursor/skills",
      label: "Cursor (project)",
      scope: "project",
    },
  ];
}

export interface SkillSourcesResult {
  /** Global settings file path — always returned for backwards compatibility. */
  settingsPath: string;
  /** Project settings file path when trusted project scope was supplied, else undefined. */
  projectSettingsPath?: string;
  /** True when project-local roots/settings were included in this detection pass. */
  projectIncluded: boolean;
  /** Every candidate root we detected on disk, wired or not. */
  candidates: SkillSourceCandidate[];
  /** Entries in included settings.skills[] files that point at a non-existent path.
   *  Surfaced so users can prune stale references. */
  staleWired: string[];
}

/**
 * Discover external skill roots on disk and cross-reference them with
 * the user's current settings.json `skills[]` arrays.
 *
 * Pass `cwd` to also probe project-scope candidates and read the
 * matching `<cwd>/.pi/settings.json`. Without `cwd`, only global roots
 * are detected.
 *
 * The result is safe to render even when settings are missing or malformed.
 */
export function detectSkillSources(
  opts: { home?: string; cwd?: string; includeProject?: boolean } | string = {},
): SkillSourcesResult {
  // Backwards-compat: legacy callers passed `home` positionally.
  const args = typeof opts === "string" ? { home: opts } : opts;
  const home = args.home ?? os.homedir();
  const cwd = args.cwd;
  const includeProject = !!cwd && args.includeProject !== false;

  const globalPath = globalSettingsPath();
  const projectPath = includeProject ? projectSettingsPath(cwd) : undefined;
  const globalWired = readWiredSkillPaths(globalPath, home, cwd);
  const projectWired = projectPath ? readWiredSkillPaths(projectPath, home, cwd) : null;

  const candidates: SkillSourceCandidate[] = [];
  const roots: KnownRoot[] = [...knownGlobalRoots(home)];
  if (includeProject) roots.push(...knownProjectRoots(cwd));

  for (const root of roots) {
    if (!isDirectory(root.absolute)) continue;
    const wiredSet = root.scope === "project" ? projectWired : globalWired;
    const wired = !!(
      wiredSet &&
      (wiredSet.absolute.has(root.absolute) || wiredSet.raw.has(root.settingsValue))
    );
    candidates.push({
      displayPath: toDisplayPath(root.absolute, home),
      absolutePath: root.absolute,
      settingsPath: root.settingsValue,
      label: root.label,
      skillCount: countSkillEntries(root.absolute),
      wired,
      scope: root.scope,
    });
  }

  const staleWired: string[] = [];
  const seenStale = new Set<string>();
  for (const wired of [globalWired, projectWired]) {
    if (!wired) continue;
    for (const raw of wired.raw) {
      const resolved = resolvePath(raw, home, cwd);
      if (!resolved) continue;
      if (isDirectory(resolved)) continue;
      if (seenStale.has(raw)) continue;
      seenStale.add(raw);
      staleWired.push(raw);
    }
  }

  return {
    settingsPath: globalPath,
    projectSettingsPath: projectPath,
    projectIncluded: includeProject,
    candidates,
    staleWired,
  };
}

/**
 * Update a settings.json `skills[]` array.
 *
 * - `add`: values to insert (deduped against whatever's already there).
 * - `remove`: values to drop (matched verbatim *or* by resolved absolute path).
 * - `scope`: which settings file to write to. Defaults to "global".
 *           When "project", `cwd` is required so we can resolve
 *           `<cwd>/.pi/settings.json`.
 *
 * Returns the updated array so the caller can show a summary. This is
 * the only write path used by `/sf-pi skills` and `/sf-skills sources` —
 * the overlay always funnels through here so we have a single place
 * that owns the JSON shape and newline convention.
 */
export function updateSkillSources(args: {
  add: string[];
  remove: string[];
  scope?: SkillSourceScope;
  cwd?: string;
  home?: string;
  settingsFile?: string;
}): { settingsPath: string; skills: string[] } {
  const home = args.home ?? os.homedir();
  const scope: SkillSourceScope = args.scope ?? "global";
  const settingsPath =
    args.settingsFile ??
    (scope === "project" ? requireProjectSettingsPath(args.cwd) : globalSettingsPath());
  const root = readJsonObject(settingsPath);
  const current = Array.isArray(root.skills) ? (root.skills as unknown[]) : [];

  const existing: string[] = current.filter((v): v is string => typeof v === "string");
  const removeAbsolute = new Set(
    args.remove
      .map((value) => resolvePath(value, home, args.cwd))
      .filter((p): p is string => typeof p === "string"),
  );
  const removeRaw = new Set(args.remove);

  const retained = existing.filter((value) => {
    if (removeRaw.has(value)) return false;
    const resolved = resolvePath(value, home, args.cwd);
    if (resolved && removeAbsolute.has(resolved)) return false;
    return true;
  });

  const existingAbsolute = new Set(
    retained
      .map((value) => resolvePath(value, home, args.cwd))
      .filter((p): p is string => typeof p === "string"),
  );
  const existingRaw = new Set(retained);

  for (const value of args.add) {
    if (existingRaw.has(value)) continue;
    const resolved = resolvePath(value, home, args.cwd);
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

function readWiredSkillPaths(settingsPath: string, home: string, cwd?: string): WiredPaths {
  const result: WiredPaths = { raw: new Set(), absolute: new Set() };
  const root = readJsonObject(settingsPath);
  const skills = Array.isArray(root.skills) ? (root.skills as unknown[]) : [];
  for (const value of skills) {
    if (typeof value !== "string") continue;
    result.raw.add(value);
    const resolved = resolvePath(value, home, cwd);
    if (resolved) result.absolute.add(resolved);
  }
  return result;
}

function requireProjectSettingsPath(cwd: string | undefined): string {
  if (!cwd) {
    throw new Error(
      "updateSkillSources({ scope: 'project' }) requires `cwd` so the project settings file can be resolved.",
    );
  }
  return projectSettingsPath(cwd);
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

function resolvePath(value: string, home: string, cwd?: string): string | null {
  if (!value) return null;
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  if (value === "~") return home;
  if (path.isAbsolute(value)) return value;
  // Relative paths in project settings resolve against `cwd`; in global
  // settings they resolve against `$HOME`. Pi follows the same rule when
  // loading `skills[]`.
  return path.resolve(cwd ?? home, value);
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
