/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Source Registry — the persisted record of which skill roots SF Skills
 * knows about and each one's Source Gate state, kept per scope.
 *
 * Why this exists
 * ---------------
 * The Skill Funnel narrows the on-disk catalog through a Source Gate
 * (which roots Pi may see) before the per-skill Skill Gate. Most funnel
 * state is reconstructable by reading `settings.skills[]` back — but one
 * thing is not: a source that is *seen* yet currently has zero enabled
 * skills leaves no `settings.skills[]` trace and would be forgotten on
 * reload. That bites custom paths hardest. The Source Registry is the
 * small durable memory that fixes exactly that gap.
 *
 * Scope boundary (per ADR-0006 / AGENTS.md state decision tree, Q4):
 *   global  → <globalAgentDir>/sf-pi/sf-skills/sources.json
 *   project → <cwd>/.pi/sf-skills/sources.json
 *
 * This module is pure persistence + a tiny CRUD surface. It never reads
 * `settings.skills[]`, never scans disk for skills, and never compiles
 * anything to native settings — that is the job of the catalog,
 * resolution, and settings-skills modules. Keeping it dumb keeps it off
 * the boot hot path: a single tolerant JSON read.
 */
import path from "node:path";
import { createStateStore, type StateStore } from "../state-store.ts";

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export type SourceScope = "global" | "project";

/**
 * What kind of root this is. Drives labels and which mutations are safe:
 *   harness — a known external harness root (Claude/Codex/Cursor); we only
 *             ever remember a non-default gate override for these.
 *   custom  — a user-added path. The registry is the *only* place this is
 *             remembered when no skills from it are enabled yet.
 *   managed — a tree SF Skills cloned itself (afv-library), sentinel-marked.
 */
export type SourceKind = "harness" | "custom" | "managed";

/** Source Gate state: whether this root may contribute candidates at all. */
export type SourceGate = "seen" | "off";

export interface RegisteredSource {
  /** Stable id — the normalized settings-style value (e.g. `~/.claude/skills`). */
  id: string;
  /** Settings-style value as it should appear in `settings.skills[]`. */
  value: string;
  kind: SourceKind;
  gate: SourceGate;
  /** Optional human label shown in the Funnel view. */
  label?: string;
}

interface RegistryState {
  sources: RegisteredSource[];
}

const SCHEMA_VERSION = 1;
const NAMESPACE = "sf-skills";
const FILENAME = "sources.json";

// -------------------------------------------------------------------------------------------------
// Store
// -------------------------------------------------------------------------------------------------

/**
 * Build the per-scope store. Global lands at the canonical
 * `<globalAgentDir>/sf-pi/sf-skills/sources.json`; project at
 * `<cwd>/.pi/sf-skills/sources.json`. No `pathOverride` — this is new
 * state, so it uses the canonical scoped layout.
 */
export function sourceRegistryStore(scope: SourceScope, cwd?: string): StateStore<RegistryState> {
  if (scope === "project") {
    if (!cwd) {
      throw new Error("sourceRegistryStore(scope='project') requires cwd.");
    }
    return createStateStore<RegistryState>({
      namespace: NAMESPACE,
      filename: FILENAME,
      schemaVersion: SCHEMA_VERSION,
      defaults: { sources: [] },
      scope: "project",
      cwd,
    });
  }
  return createStateStore<RegistryState>({
    namespace: NAMESPACE,
    filename: FILENAME,
    schemaVersion: SCHEMA_VERSION,
    defaults: { sources: [] },
  });
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

/** Normalize a settings-style value into a stable id. Tolerates `~`, `./`, trailing slashes. */
export function sourceId(value: string): string {
  const trimmed = value.trim().replace(/[/\\]+$/, "");
  return trimmed.length > 0 ? trimmed : value.trim();
}

/** Read every registered source for a scope. Never throws. */
export function readSourceRegistry(scope: SourceScope, cwd?: string): RegisteredSource[] {
  try {
    const state = sourceRegistryStore(scope, cwd).read();
    return Array.isArray(state.sources) ? state.sources.filter(isValidSource) : [];
  } catch {
    return [];
  }
}

/**
 * Insert or update a source by id. Merges into any existing entry so a
 * caller can flip just the gate without re-supplying the label. Returns
 * the persisted list.
 */
export function upsertSource(
  scope: SourceScope,
  source: PartialSource,
  cwd?: string,
): RegisteredSource[] {
  const id = sourceId(source.value ?? source.id ?? "");
  if (!id) return readSourceRegistry(scope, cwd);

  return mutate(scope, cwd, (sources) => {
    const next = [...sources];
    const idx = next.findIndex((s) => s.id === id);
    const base: RegisteredSource = next[idx] ?? {
      id,
      value: source.value ?? id,
      kind: source.kind ?? "custom",
      gate: source.gate ?? "seen",
    };
    const merged: RegisteredSource = {
      id,
      value: source.value ?? base.value,
      kind: source.kind ?? base.kind,
      gate: source.gate ?? base.gate,
      label: source.label ?? base.label,
    };
    if (idx >= 0) next[idx] = merged;
    else next.push(merged);
    return next;
  });
}

/** Remove a source by id (or settings value). Returns the persisted list. */
export function removeSource(
  scope: SourceScope,
  idOrValue: string,
  cwd?: string,
): RegisteredSource[] {
  const id = sourceId(idOrValue);
  return mutate(scope, cwd, (sources) => sources.filter((s) => s.id !== id));
}

/** Flip just the Source Gate for one source. No-op if the source is unknown. */
export function setSourceGate(
  scope: SourceScope,
  idOrValue: string,
  gate: SourceGate,
  cwd?: string,
): RegisteredSource[] {
  const id = sourceId(idOrValue);
  return mutate(scope, cwd, (sources) => {
    const idx = sources.findIndex((s) => s.id === id);
    if (idx < 0) return sources;
    const next = [...sources];
    next[idx] = { ...next[idx], gate };
    return next;
  });
}

/** Look up one source by id or settings value. */
export function findSource(
  scope: SourceScope,
  idOrValue: string,
  cwd?: string,
): RegisteredSource | undefined {
  const id = sourceId(idOrValue);
  return readSourceRegistry(scope, cwd).find((s) => s.id === id);
}

// -------------------------------------------------------------------------------------------------
// Internal
// -------------------------------------------------------------------------------------------------

/** Fields a caller may supply to upsertSource — value (or id) is required. */
export interface PartialSource {
  id?: string;
  value?: string;
  kind?: SourceKind;
  gate?: SourceGate;
  label?: string;
}

function mutate(
  scope: SourceScope,
  cwd: string | undefined,
  fn: (sources: RegisteredSource[]) => RegisteredSource[],
): RegisteredSource[] {
  try {
    const store = sourceRegistryStore(scope, cwd);
    const next = store.update((current) => ({
      sources: fn(Array.isArray(current.sources) ? current.sources.filter(isValidSource) : []),
    }));
    return next.sources;
  } catch {
    return readSourceRegistry(scope, cwd);
  }
}

function isValidSource(value: unknown): value is RegisteredSource {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<RegisteredSource>;
  return (
    typeof s.id === "string" &&
    typeof s.value === "string" &&
    (s.kind === "harness" || s.kind === "custom" || s.kind === "managed") &&
    (s.gate === "seen" || s.gate === "off")
  );
}

/** Re-exported for symmetry with other path-aware modules / tests. */
export function projectRegistryRelativePath(): string {
  return path.join(".pi", "sf-skills", FILENAME);
}
