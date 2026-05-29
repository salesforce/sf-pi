/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Catalog gatherer — the single impure bridge that feeds the pure
 * `buildSkillCatalog`. This is the ONLY module in the funnel that touches
 * disk, settings, the Pi loader, or `pi.getCommands()`.
 *
 * Boot contract: `gatherCatalogInput` is called only from the `/sf-skills`
 * command handler (explicit user intent), never from `session_start` or any
 * recurring hook. `loadSkills` + per-root disk scans are not cheap enough for
 * first paint, so they stay off the hot path. See the boot-path guard test.
 *
 * Dependencies are injected so the assembly logic is unit-testable without a
 * live Pi runtime or the real agent dir.
 */
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadSkills as realLoadSkills,
  loadSkillsFromDir as realLoadSkillsFromDir,
  type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import {
  globalAgentDir,
  globalSettingsPath,
  projectSettingsPath,
} from "../../../lib/common/pi-paths.ts";
import { detectSkillSources } from "../../../lib/common/skill-sources/skill-sources.ts";
import {
  readSourceRegistry,
  type RegisteredSource,
} from "../../../lib/common/skill-sources/source-registry.ts";
import { loadUsageMap } from "./usage-store.ts";
import type {
  CatalogSourceInput,
  ResolvedSettingsEntry,
  ScannedSkill,
  SkillCatalogInput,
  SkillUsage,
} from "./catalog.ts";
import { readFileSync } from "node:fs";

// -------------------------------------------------------------------------------------------------
// Injectable deps
// -------------------------------------------------------------------------------------------------

export interface GatherDeps {
  loadSkills: typeof realLoadSkills;
  loadSkillsFromDir: typeof realLoadSkillsFromDir;
  getCommands: () => SlashCommandInfo[];
  /** Override $HOME (tests). */
  home?: string;
  /** Override the global agent dir (tests). */
  agentDir?: string;
  /** Usage map loader — defaults to the persistent store. */
  loadUsage?: (cwd: string) => Map<string, SkillUsage>;
}

export interface GatherOptions {
  cwd: string;
  deps: GatherDeps;
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

/**
 * Assemble a `SkillCatalogInput` from the live environment. Pure logic lives
 * in `buildSkillCatalog`; this just collects the six inputs.
 */
export function gatherCatalogInput(opts: GatherOptions): SkillCatalogInput {
  const { cwd, deps } = opts;
  const home = deps.home ?? os.homedir();
  const agentDir = deps.agentDir ?? globalAgentDir();

  const settingsGlobal = readSettingsEntries(globalSettingsPath(), home, cwd);
  const settingsProject = readSettingsEntries(projectSettingsPath(cwd), home, cwd);

  const registryGlobal = readSourceRegistry("global");
  const registryProject = readSourceRegistry("project", cwd);

  // Roots we ask the Pi loader to consider beyond the auto-defaults: every
  // wired settings entry plus any registered source the user has marked seen.
  const skillPaths = uniq([
    ...settingsGlobal.map((e) => e.raw),
    ...settingsProject.map((e) => e.raw),
    ...[...registryGlobal, ...registryProject].filter((s) => s.gate === "seen").map((s) => s.value),
  ]);

  const load = deps.loadSkills({ cwd, agentDir, skillPaths, includeDefaults: true });
  const winners = load.skills.map((s) => ({ name: s.name, filePath: s.filePath }));
  const collisions = load.diagnostics.flatMap((d) =>
    d.type === "collision" && d.collision
      ? [
          {
            name: d.collision.name,
            winnerPath: d.collision.winnerPath,
            loserPath: d.collision.loserPath,
          },
        ]
      : [],
  );

  const loadedPaths = deps
    .getCommands()
    .filter((c) => c.source === "skill" && typeof c.sourceInfo?.path === "string")
    .map((c) => c.sourceInfo.path);

  const sources = buildSources({
    cwd,
    home,
    agentDir,
    settingsGlobal,
    settingsProject,
    registry: [...registryGlobal, ...registryProject],
    loadSkillsFromDir: deps.loadSkillsFromDir,
  });

  const usage = deps.loadUsage ? deps.loadUsage(cwd) : loadUsageMap("all", cwd);

  return {
    cwd,
    sources,
    loadedPaths,
    winners,
    collisions,
    settingsGlobal,
    settingsProject,
    usage,
  };
}

// -------------------------------------------------------------------------------------------------
// Source assembly
// -------------------------------------------------------------------------------------------------

interface BuildSourcesArgs {
  cwd: string;
  home: string;
  agentDir: string;
  settingsGlobal: ResolvedSettingsEntry[];
  settingsProject: ResolvedSettingsEntry[];
  registry: RegisteredSource[];
  loadSkillsFromDir: typeof realLoadSkillsFromDir;
}

function buildSources(args: BuildSourcesArgs): CatalogSourceInput[] {
  const wiredAbs = new Set(
    [...args.settingsGlobal, ...args.settingsProject].filter((e) => e.isDir).map((e) => e.absPath),
  );

  // Collect candidate roots keyed by normalized absolute path so we never
  // scan the same dir twice or emit duplicate source rows.
  const byRoot = new Map<string, RootSpec>();
  const add = (spec: RootSpec) => {
    const key = norm(spec.rootPath);
    if (!byRoot.has(key)) byRoot.set(key, { ...spec, rootPath: key });
  };

  // 1. Auto-discovered defaults (always seen, never settings-wired).
  add(defaultRoot(path.join(args.agentDir, "skills"), "Pi user skills"));
  add(defaultRoot(path.join(args.cwd, ".pi", "skills"), "Pi project skills"));
  add(defaultRoot(path.join(args.home, ".agents", "skills"), ".agents (global)"));
  add(defaultRoot(path.join(args.cwd, ".agents", "skills"), ".agents (project)"));

  // 2. Detected harness roots (Claude/Codex/Cursor), global + project.
  for (const cand of detectSkillSources({ cwd: args.cwd }).candidates) {
    add({
      id: cand.settingsPath,
      rootPath: cand.absolutePath,
      kind: "harness",
      label: cand.label,
      gate: cand.wired ? "seen" : "off",
      autoDefault: false,
    });
  }

  // 3. Registered sources (custom paths + managed clones) carry an explicit gate.
  for (const src of args.registry) {
    add({
      id: src.id,
      rootPath: resolveValue(src.value, args.home, args.cwd),
      kind: src.kind,
      label: src.label ?? src.value,
      gate: src.gate,
      autoDefault: false,
    });
  }

  // 4. Any wired settings dir not already a known root → an implicit custom source.
  for (const entry of [...args.settingsGlobal, ...args.settingsProject]) {
    if (!entry.isDir) continue;
    if (byRoot.has(norm(entry.absPath))) continue;
    add({
      id: entry.raw,
      rootPath: entry.absPath,
      kind: "custom",
      label: entry.raw,
      gate: "seen",
      autoDefault: false,
    });
  }

  // Scan each existing root once and build the CatalogSourceInput.
  const out: CatalogSourceInput[] = [];
  for (const spec of byRoot.values()) {
    if (!isDirectory(spec.rootPath)) continue;
    // A wired auto-default override or settings dir is seen regardless of a
    // stale registry "off" — wiring is the stronger signal.
    const gate = spec.autoDefault || wiredAbs.has(spec.rootPath) ? "seen" : spec.gate;
    const skills = scanRoot(spec, args.loadSkillsFromDir);
    out.push({
      id: spec.id,
      rootPath: spec.rootPath,
      kind: spec.kind,
      label: spec.label,
      gate,
      autoDefault: spec.autoDefault,
      skills,
    });
  }
  return out;
}

interface RootSpec {
  id: string;
  rootPath: string;
  kind: CatalogSourceInput["kind"];
  label: string;
  gate: "seen" | "off";
  autoDefault: boolean;
}

function defaultRoot(rootPath: string, label: string): RootSpec {
  return { id: rootPath, rootPath, kind: "auto-default", label, gate: "seen", autoDefault: true };
}

function scanRoot(spec: RootSpec, loadSkillsFromDir: typeof realLoadSkillsFromDir): ScannedSkill[] {
  try {
    const result = loadSkillsFromDir({ dir: spec.rootPath, source: spec.kind });
    return result.skills.map((s) => ({
      name: s.name,
      filePath: norm(s.filePath),
      description: s.description,
    }));
  } catch {
    return [];
  }
}

// -------------------------------------------------------------------------------------------------
// Settings reading
// -------------------------------------------------------------------------------------------------

function readSettingsEntries(
  settingsPath: string,
  home: string,
  cwd: string,
): ResolvedSettingsEntry[] {
  let raw: unknown;
  try {
    if (!existsSync(settingsPath)) return [];
    raw = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return [];
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const skills = (raw as Record<string, unknown>).skills;
  if (!Array.isArray(skills)) return [];

  const out: ResolvedSettingsEntry[] = [];
  const isProject = settingsPath.includes(`${path.sep}.pi${path.sep}settings.json`);
  for (const value of skills) {
    if (typeof value !== "string") continue;
    const absPath = norm(resolveValue(value, home, isProject ? cwd : home));
    out.push({ raw: value, absPath, isDir: isDirectory(absPath) });
  }
  return out;
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function resolveValue(value: string, home: string, base: string): string {
  if (!value) return value;
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  if (value === "~") return home;
  if (path.isAbsolute(value)) return value;
  return path.resolve(base, value);
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter((v) => typeof v === "string" && v.length > 0))];
}

function norm(p: string): string {
  const resolved = path.normalize(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
