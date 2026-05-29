/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Skill Catalog — the single resolved model of the whole skill world.
 *
 * `buildSkillCatalog` is a PURE function: same inputs, same catalog. It
 * performs no I/O — `loadSkills`, `pi.getCommands()`, settings reads, disk
 * scans, registry reads, and usage reads all happen in the gatherer
 * (`gather.ts`) and arrive here as plain, already-resolved inputs. That is
 * what keeps this module trivially fixture-testable and keeps every
 * expensive call off the boot hot path.
 *
 * Every SF Skills surface (Funnel view, HUD, conflicts, prune) reads from
 * the catalog instead of recomputing "seen / enabled / effective /
 * conflict". The catalog emits per-skill funnel TAGS; folding those tags
 * into the funnel's display stages is a trivial job left to the surfaces.
 *
 * The catalog is a model, not a loader and not a mutator. Turning a tag
 * into a change is the Resolution Policy's job (`resolution.ts`), which
 * compiles to native `settings.skills[]` per Compiled Skill Resolution.
 */
import path from "node:path";

// -------------------------------------------------------------------------------------------------
// Inputs (all pre-resolved by the gatherer)
// -------------------------------------------------------------------------------------------------

/** A `settings.skills[]` entry, resolved to an absolute path + kind. */
export interface ResolvedSettingsEntry {
  /** Verbatim value as it appears in settings (`~/.claude/skills`, `./x`, …). */
  raw: string;
  /** Absolute, normalized path the value resolves to. */
  absPath: string;
  /** Whether the resolved path is a directory (covers many files) or one file. */
  isDir: boolean;
}

/** One skill copy discovered on disk under a source root. */
export interface ScannedSkill {
  name: string;
  /** Absolute, normalized path to the SKILL.md (or root `.md`). */
  filePath: string;
  description?: string;
}

/** A skill root the gatherer knows about, with its gate + scanned skills. */
export interface CatalogSourceInput {
  /** Stable id — the settings-style value or root path. */
  id: string;
  /** Absolute, normalized root path. */
  rootPath: string;
  kind: "harness" | "custom" | "managed" | "auto-default";
  label: string;
  /** Source Gate: whether this root may contribute candidates at all. */
  gate: "seen" | "off";
  /** True for `~/.pi/agent/skills`, `.pi/skills`, `.agents/skills` roots. */
  autoDefault: boolean;
  skills: ScannedSkill[];
}

export interface SkillUsage {
  count: number;
  lastUsedAt?: string;
}

export interface SkillCatalogInput {
  cwd: string;
  sources: CatalogSourceInput[];
  /** Absolute, normalized paths Pi actually loaded (from pi.getCommands()). */
  loadedPaths: string[];
  /** loadSkills winners — fallback "loaded" signal when loadedPaths is empty. */
  winners: Array<{ name: string; filePath: string }>;
  /** loadSkills collision diagnostics (loser paths that may not be scanned). */
  collisions: Array<{ name: string; winnerPath: string; loserPath: string }>;
  settingsGlobal: ResolvedSettingsEntry[];
  settingsProject: ResolvedSettingsEntry[];
  usage?: Map<string, SkillUsage> | Record<string, SkillUsage>;
}

// -------------------------------------------------------------------------------------------------
// Outputs
// -------------------------------------------------------------------------------------------------

export type EffectiveState = "loaded" | "shadowed" | "gated-out";
export type ConflictRole = "none" | "winner" | "loser" | "report-only-loser";
export type ConflictKind = "resolvable" | "report-only";

export interface CatalogSkill {
  name: string;
  filePath: string;
  description?: string;
  sourceId: string;
  sourceLabel: string;
  sourceKind: CatalogSourceInput["kind"];
  autoDefault: boolean;
  /** Source Gate. */
  seen: boolean;
  /** Skill Gate @ global / project scope. */
  enabledGlobal: boolean;
  enabledProject: boolean;
  effective: EffectiveState;
  conflictRole: ConflictRole;
  /** True when this exact copy is the one Pi loaded. */
  loadedByPi: boolean;
  usage?: SkillUsage;
}

export interface CatalogConflict {
  name: string;
  kind: ConflictKind;
  winner?: CatalogSkill;
  losers: CatalogSkill[];
  copies: CatalogSkill[];
}

export interface CatalogSource {
  id: string;
  label: string;
  rootPath: string;
  kind: CatalogSourceInput["kind"];
  gate: "seen" | "off";
  autoDefault: boolean;
  counts: {
    total: number;
    loaded: number;
    shadowed: number;
    gatedOut: number;
    conflictWinners: number;
    conflictLosers: number;
  };
}

export interface SkillCatalog {
  skills: CatalogSkill[];
  conflicts: CatalogConflict[];
  sources: CatalogSource[];
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

/**
 * Build the resolved Skill Catalog from pre-gathered inputs.
 *
 * Invariants:
 * - One `CatalogSkill` row per physical copy (deduped by normalized path).
 * - `skills` is sorted by name asc, then effective rank (loaded, shadowed,
 *   gated-out), then file path — deterministic for snapshot-style tests.
 * - `seen` is Source Gate only; `enabledGlobal/Project` are Skill Gate only.
 *   An auto-default copy can be `seen && !enabledGlobal && effective:'loaded'`
 *   because defaults load without settings wiring.
 * - A conflict (>1 copy of a name) is `report-only` when any copy is under an
 *   auto-default root, else `resolvable`.
 */
export function buildSkillCatalog(input: SkillCatalogInput): SkillCatalog {
  const usage = toUsageMap(input.usage);
  const loaded = new Set(input.loadedPaths.map(norm));
  const winnerByName = new Map<string, string>();
  for (const w of input.winners) winnerByName.set(w.name, norm(w.filePath));

  // 1. Enumerate every physical copy: scanned skills + any collision/winner
  //    paths not already covered by a scan (attached to their owning source).
  const sourceByRoot = [...input.sources].sort((a, b) => b.rootPath.length - a.rootPath.length);
  const copies = new Map<string, RawCopy>(); // key: normalized path

  const addCopy = (raw: RawCopy) => {
    const key = norm(raw.filePath);
    if (!copies.has(key)) copies.set(key, { ...raw, filePath: key });
  };

  for (const src of input.sources) {
    // Gated-off roots still appear in the catalog (the funnel's "entire
    // catalog" stage) — their copies are tagged seen:false / gated-out and
    // never participate in conflicts.
    for (const skill of src.skills) {
      addCopy({
        name: skill.name,
        filePath: skill.filePath,
        description: skill.description,
        source: src,
      });
    }
  }
  // Collision losers + winners that weren't scanned (e.g. a root we didn't
  // walk) still belong in the catalog so conflicts are never lost.
  for (const c of input.collisions) {
    ensureCopy(norm(c.loserPath), c.name, sourceByRoot, addCopy);
    ensureCopy(norm(c.winnerPath), c.name, sourceByRoot, addCopy);
  }
  for (const w of input.winners) {
    ensureCopy(norm(w.filePath), w.name, sourceByRoot, addCopy);
  }

  const isSeen = (copy: RawCopy): boolean => (copy.source ? copy.source.gate === "seen" : true);

  // loadSkills collisions are the authoritative record of what Pi actually
  // found competing at startup — more authoritative than our gate guesses.
  // A copy whose path appears in a collision is a real conflict participant
  // even if its source landed gate-off in our model.
  const collisionPaths = new Set<string>();
  for (const c of input.collisions) {
    collisionPaths.add(norm(c.winnerPath));
    collisionPaths.add(norm(c.loserPath));
  }
  const collisionLoserPaths = new Set(input.collisions.map((c) => norm(c.loserPath)));

  const isParticipant = (copy: RawCopy): boolean =>
    isSeen(copy) || collisionPaths.has(copy.filePath);

  // 2. Which names have at least one loaded/winning copy (for shadow detection)?
  const loadedNames = new Set<string>();
  for (const copy of copies.values()) {
    if (loaded.has(copy.filePath) || winnerByName.get(copy.name) === copy.filePath) {
      loadedNames.add(copy.name);
    }
  }

  // 3. Group conflict PARTICIPANTS by name. A participant is any seen copy or
  //    any copy Pi reported in a collision. Purely gated-off copies that Pi
  //    never considered stay catalog-only and don't compete for a name.
  const byName = new Map<string, RawCopy[]>();
  for (const copy of copies.values()) {
    if (!isParticipant(copy)) continue;
    const list = byName.get(copy.name) ?? [];
    list.push(copy);
    byName.set(copy.name, list);
  }

  // 4. Build CatalogSkill rows.
  const skills: CatalogSkill[] = [];
  const skillByPath = new Map<string, CatalogSkill>();
  for (const copy of copies.values()) {
    const seen = isSeen(copy);
    const group = byName.get(copy.name) ?? [];
    const isConflict = isParticipant(copy) && group.length > 1;
    const reportOnly = isConflict && group.some((c) => c.source?.autoDefault);
    const thisLoaded = loaded.has(copy.filePath) || winnerByName.get(copy.name) === copy.filePath;

    let effective: EffectiveState;
    if (thisLoaded) effective = "loaded";
    else if (collisionLoserPaths.has(copy.filePath)) effective = "shadowed";
    else if (!seen) effective = "gated-out";
    else if (loadedNames.has(copy.name)) effective = "shadowed";
    else effective = "gated-out";

    let conflictRole: ConflictRole = "none";
    if (isConflict) {
      if (thisLoaded) conflictRole = "winner";
      else conflictRole = reportOnly ? "report-only-loser" : "loser";
    }

    const fallbackLabel = fallbackSourceLabel(copy.filePath);
    const row: CatalogSkill = {
      name: copy.name,
      filePath: copy.filePath,
      description: copy.description,
      sourceId: copy.source?.id ?? fallbackLabel,
      sourceLabel: copy.source?.label ?? fallbackLabel,
      sourceKind: copy.source?.kind ?? "custom",
      autoDefault: copy.source?.autoDefault ?? false,
      seen: copy.source ? copy.source.gate === "seen" : true,
      enabledGlobal: coveredBy(copy.filePath, input.settingsGlobal),
      enabledProject: coveredBy(copy.filePath, input.settingsProject),
      effective,
      conflictRole,
      loadedByPi: loaded.has(copy.filePath),
      usage: usage.get(copy.name),
    };
    skills.push(row);
    skillByPath.set(copy.filePath, row);
  }

  skills.sort(compareSkills);

  // 5. Conflicts.
  const conflicts: CatalogConflict[] = [];
  for (const [name, group] of byName) {
    if (group.length <= 1) continue;
    const rows = group
      .map((c) => skillByPath.get(c.filePath))
      .filter((r): r is CatalogSkill => !!r);
    const kind: ConflictKind = group.some((c) => c.source?.autoDefault)
      ? "report-only"
      : "resolvable";
    conflicts.push({
      name,
      kind,
      winner: rows.find((r) => r.conflictRole === "winner"),
      losers: rows.filter((r) => r.conflictRole !== "winner"),
      copies: rows.sort(compareSkills),
    });
  }
  conflicts.sort((a, b) => a.name.localeCompare(b.name));

  // 6. Source rollups.
  const sources: CatalogSource[] = input.sources.map((src) => {
    const rows = skills.filter((s) => s.sourceId === src.id);
    return {
      id: src.id,
      label: src.label,
      rootPath: src.rootPath,
      kind: src.kind,
      gate: src.gate,
      autoDefault: src.autoDefault,
      counts: {
        total: rows.length,
        loaded: rows.filter((r) => r.effective === "loaded").length,
        shadowed: rows.filter((r) => r.effective === "shadowed").length,
        gatedOut: rows.filter((r) => r.effective === "gated-out").length,
        conflictWinners: rows.filter((r) => r.conflictRole === "winner").length,
        conflictLosers: rows.filter(
          (r) => r.conflictRole === "loser" || r.conflictRole === "report-only-loser",
        ).length,
      },
    };
  });

  return { skills, conflicts, sources };
}

// -------------------------------------------------------------------------------------------------
// Internal
// -------------------------------------------------------------------------------------------------

interface RawCopy {
  name: string;
  filePath: string;
  description?: string;
  source?: CatalogSourceInput;
}

const EFFECTIVE_RANK: Record<EffectiveState, number> = {
  loaded: 0,
  shadowed: 1,
  "gated-out": 2,
};

function compareSkills(a: CatalogSkill, b: CatalogSkill): number {
  if (a.name !== b.name) return a.name.localeCompare(b.name);
  if (EFFECTIVE_RANK[a.effective] !== EFFECTIVE_RANK[b.effective]) {
    return EFFECTIVE_RANK[a.effective] - EFFECTIVE_RANK[b.effective];
  }
  return a.filePath.localeCompare(b.filePath);
}

/** Attach a path to its owning source (deepest matching root) when not yet present. */
function ensureCopy(
  filePath: string,
  name: string,
  sourcesByRootDesc: CatalogSourceInput[],
  addCopy: (raw: RawCopy) => void,
): void {
  const source = sourcesByRootDesc.find(
    (s) => filePath === s.rootPath || filePath.startsWith(`${s.rootPath}${path.sep}`),
  );
  addCopy({ name, filePath, source });
}

/**
 * Best-effort label for a copy with no matched source — never the bare
 * "Unknown source". Recognizes the afv-library managed clone in the path and
 * otherwise names the skill's containing root directory.
 */
function fallbackSourceLabel(filePath: string): string {
  const norm = filePath.replace(/\\/g, "/");
  if (norm.includes("/afv-library/")) return "afv-library";
  // …/<root>/<skill>/SKILL.md → name the <root> directory; for a loose
  // …/<root>/<name>.md → name the <root> directory too.
  const parts = norm.split("/").filter(Boolean);
  const base = parts[parts.length - 1] ?? "";
  const rootIdx = base.toLowerCase() === "skill.md" ? parts.length - 3 : parts.length - 2;
  const root = rootIdx >= 0 ? parts[rootIdx] : undefined;
  return root ? `${root} (wired)` : "wired path";
}

function coveredBy(filePath: string, entries: ResolvedSettingsEntry[]): boolean {
  for (const entry of entries) {
    if (entry.absPath === filePath) return true;
    if (entry.isDir && filePath.startsWith(`${entry.absPath}${path.sep}`)) return true;
  }
  return false;
}

function toUsageMap(usage: SkillCatalogInput["usage"]): Map<string, SkillUsage> {
  if (!usage) return new Map();
  if (usage instanceof Map) return usage;
  return new Map(Object.entries(usage));
}

function norm(p: string): string {
  const resolved = path.normalize(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
