/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read-side data prep for the /sf-skills datatable.
 *
 * Two pure builders, no I/O of their own (the caller does the reads):
 *
 *   buildActiveRows  -- cross-references pi.getCommands() with the live
 *                       settings files so each row carries a clear
 *                       "wired in global", "wired in project", "auto"
 *                       label and a Salesforce / external classification.
 *
 *   buildDiscoverRows -- combines the active set with on-disk candidates
 *                       that are NOT yet wired (afv-library available
 *                       but not in settings, Claude/Codex/Cursor roots
 *                       sitting on disk, etc.) so the user sees what
 *                       they could enable.
 *
 * Both builders are deterministic — same input, same output — which
 * keeps the overlay re-renderable without surprise state.
 */
import os from "node:os";
import path from "node:path";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { globalSettingsPath, projectSettingsPath } from "../../../lib/common/pi-paths.ts";
import { readJsonFile } from "../../../lib/common/sf-pi-settings.ts";
import {
  detectSkillSources,
  type SkillSourceCandidate,
} from "../../../lib/common/skill-sources/skill-sources.ts";
import {
  isSalesforceSkill,
  readWiredAbsolutePaths,
  sourceCategory,
  type SourceCategory,
} from "./classify.ts";

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export type SkillClass = "salesforce" | "external";
export type WiredScope = "global" | "project" | "both" | "none";

export interface ActiveRow {
  /** Skill name (sf-apex, brave-search, etc.). */
  name: string;
  /** Resolved skill file or directory path. */
  skillPath: string;
  /** SF vs external. */
  klass: SkillClass;
  /** Where the file came from. */
  source: SourceCategory;
  /** Display label for the source (e.g. "afv-library", "ext: sf-data360"). */
  sourceLabel: string;
  /** Wiring status. "none" means auto-discovered or bundled. */
  wired: WiredScope;
  /** True when the skill cannot be toggled via settings (auto/bundled). */
  readOnly: boolean;
  /** Optional usage info for the Stats tab + sort. Filled in by callers
   *  that have a usage store; defaults to 0/null. */
  usageCount: number;
  lastUsedAt: string | null;
}

export type DiscoverRow =
  | (ActiveRow & { discover: "active" })
  | {
      discover: "candidate";
      /** Settings-add value (e.g. "~/.claude/skills"). */
      settingsValue: string;
      label: string;
      absolutePath: string;
      scope: "global" | "project";
      skillCount: number;
    };

export interface TableInput {
  commands: SlashCommandInfo[];
  cwd: string;
  /** Optional usage map keyed by skill name. */
  usage?: Map<string, { count: number; lastUsedAt: string | null }>;
}

// -------------------------------------------------------------------------------------------------
// Active tab
// -------------------------------------------------------------------------------------------------

export function buildActiveRows(input: TableInput): ActiveRow[] {
  const homeDir = os.homedir();
  const globalPath = globalSettingsPath();
  const projectPath = projectSettingsPath(input.cwd);
  const globalSettings = readJsonFile(globalPath);
  const projectSettings = readJsonFile(projectPath);

  // Set of every absolute path currently mentioned in either skills[] array.
  // Used by sourceCategory() to label "wired" rows correctly.
  const wiredAbs = readWiredAbsolutePaths({
    globalSettings,
    projectSettings,
    homeDir,
    cwd: input.cwd,
  });

  // Per-scope wired sets so we can compute G / P / G+P / none per row.
  const globalWired = readScopeWired(globalSettings, homeDir, homeDir);
  const projectWired = readScopeWired(projectSettings, input.cwd, homeDir);

  const rows: ActiveRow[] = [];
  for (const command of input.commands) {
    if (command.source !== "skill") continue;
    const name = stripSkillPrefix(command.name);
    const skillPath = command.sourceInfo.path;
    const source = sourceCategory({
      skillPath,
      name,
      cwd: input.cwd,
      wiredAbsolutePaths: wiredAbs,
    });
    const sourceLabel = formatSourceLabel(source, skillPath, homeDir, input.cwd);
    const wired = scopeForPath(skillPath, globalWired, projectWired);
    const readOnly = source === "auto" || source === "bundled";
    const usage = input.usage?.get(name);
    rows.push({
      name,
      skillPath,
      klass: isSalesforceSkill({ name, skillPath, cwd: input.cwd }) ? "salesforce" : "external",
      source,
      sourceLabel,
      wired,
      readOnly,
      usageCount: usage?.count ?? 0,
      lastUsedAt: usage?.lastUsedAt ?? null,
    });
  }
  // Stable sort: SF first, then by name. Discoverable + scannable order.
  rows.sort((a, b) => {
    if (a.klass !== b.klass) return a.klass === "salesforce" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

// -------------------------------------------------------------------------------------------------
// Discover tab
// -------------------------------------------------------------------------------------------------

export function buildDiscoverRows(input: TableInput): DiscoverRow[] {
  const active = buildActiveRows(input).map((row): DiscoverRow => ({ ...row, discover: "active" }));
  const detection = detectSkillSources({ cwd: input.cwd });
  const candidates: DiscoverRow[] = detection.candidates
    .filter((c) => !c.wired)
    .map((c): DiscoverRow => buildCandidateRow(c));
  return [...active, ...candidates];
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function buildCandidateRow(
  candidate: SkillSourceCandidate,
): Extract<DiscoverRow, { discover: "candidate" }> {
  return {
    discover: "candidate",
    settingsValue: candidate.settingsPath,
    label: candidate.label,
    absolutePath: candidate.absolutePath,
    scope: candidate.scope,
    skillCount: candidate.skillCount,
  };
}

function stripSkillPrefix(name: string): string {
  return name.startsWith("skill:") ? name.slice("skill:".length) : name;
}

function readScopeWired(
  settings: Record<string, unknown>,
  baseDir: string,
  homeDir: string,
): Set<string> {
  const set = new Set<string>();
  const skills = Array.isArray(settings.skills) ? settings.skills : [];
  for (const value of skills) {
    if (typeof value !== "string") continue;
    const expanded = expand(value, baseDir, homeDir);
    if (!expanded) continue;
    set.add(path.normalize(expanded));
  }
  return set;
}

function expand(value: string, baseDir: string, homeDir: string): string | null {
  if (!value) return null;
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  if (value === "~") return homeDir;
  if (path.isAbsolute(value)) return value;
  return path.resolve(baseDir, value);
}

function scopeForPath(
  skillPath: string,
  globalWired: Set<string>,
  projectWired: Set<string>,
): WiredScope {
  const normalized = path.normalize(skillPath);
  const inGlobal = isUnderAny(normalized, globalWired);
  const inProject = isUnderAny(normalized, projectWired);
  if (inGlobal && inProject) return "both";
  if (inGlobal) return "global";
  if (inProject) return "project";
  return "none";
}

function isUnderAny(normalized: string, paths: Set<string>): boolean {
  for (const p of paths) {
    const resolved = path.normalize(p);
    if (normalized === resolved) return true;
    if (normalized.startsWith(`${resolved}${path.sep}`)) return true;
  }
  return false;
}

function formatSourceLabel(
  source: SourceCategory,
  skillPath: string,
  homeDir: string,
  cwd: string,
): string {
  if (source === "afv-library") return "afv-library";
  if (source === "bundled") {
    const match = /[\\/]extensions[\\/](sf-[^\\/]+)[\\/]skills[\\/]/.exec(skillPath);
    return match ? `ext: ${match[1]}` : "ext: sf-pi";
  }
  if (source === "wired") {
    if (skillPath.startsWith(homeDir)) {
      return `~/${path.relative(homeDir, path.dirname(skillPath))}`;
    }
    if (skillPath.startsWith(cwd)) {
      return `./${path.relative(cwd, path.dirname(skillPath))}`;
    }
    return path.dirname(skillPath);
  }
  // auto-discovered
  if (skillPath.startsWith(homeDir)) {
    return `~/${path.relative(homeDir, path.dirname(skillPath))}`;
  }
  if (skillPath.startsWith(cwd)) {
    return `./${path.relative(cwd, path.dirname(skillPath))}`;
  }
  return path.dirname(skillPath);
}
