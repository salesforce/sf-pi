/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared per-user state-store helper for the Q4 case in the
 * AGENTS.md state-persistence decision tree:
 *
 *   Q1. Session-scoped?     → pi.appendEntry
 *   Q2. Cross-extension?    → lib/common/<topic>/store.ts
 *   Q3. User pi setting?    → lib/common/sf-pi-settings.ts
 *   Q4. Otherwise           → THIS HELPER
 *                              <globalAgentDir>/sf-pi/<namespace>/<filename>.json
 *
 * Why centralize:
 * - Atomic writes (write to *.tmp then rename) so an interrupted write
 *   never leaves a half-written JSON file behind.
 * - Schema versioning + an optional `migrate` hook so per-user state can
 *   evolve without leaving older installs in a corrupted state.
 * - Tolerant reads: missing file, malformed JSON, and wrong-shape JSON
 *   all return the caller's `defaults` instead of throwing.
 * - Optional `mode` (e.g. `0o600`) for sensitive blobs like saved API
 *   keys so each migration can lock down its own file.
 *
 * sf-pi global state files standardize at:
 *   <globalAgentDir>/sf-pi/<namespace>/<filename>
 * Project-scoped state files standardize at:
 *   <cwd>/.pi/<namespace>/<filename>
 * Older state files outside this layout (e.g. `sf-welcome-state.json` in
 * the agent root, `state/sf-pi/recommendations.json`) keep their own
 * paths via the `pathOverride` option for backwards compat. New
 * extensions should NOT pass `pathOverride` and let the helper choose
 * the canonical location.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { globalAgentPath, projectConfigDir } from "./pi-paths.ts";

/**
 * On-disk envelope. Adds `schemaVersion` so future shape changes can run
 * a migration without re-deriving from raw fields. The wrapped state is
 * stored under `state` so callers can keep simple POJOs without worrying
 * about reserved keys.
 */
interface OnDiskEnvelope {
  schemaVersion: number;
  state: unknown;
}

export interface StateStoreOptions<T> {
  /**
   * sf-pi-local namespace. The canonical layout is
   * `<globalAgentDir>/sf-pi/<namespace>/<filename>`. Use the extension id
   * (`sf-welcome`, `sf-pi-recommendations`, etc.) to keep state grouped.
   */
  namespace: string;
  /** Bare filename, e.g. `state.json`. Joined under the namespace folder. */
  filename: string;
  /**
   * Schema version for migrations. Bump and add a `migrate` callback when
   * the shape of `T` changes incompatibly.
   */
  schemaVersion: number;
  /**
   * Returned when the file is missing, unparseable, or the wrong shape.
   * Should be a fresh, owned object — the helper does not deep-clone it.
   */
  defaults: T;
  /**
   * Optional migrator from an older schema version. Receives the raw
   * on-disk envelope's `state` plus the version it was written under,
   * and returns the migrated shape (or `null` to fall back to defaults).
   */
  migrate?: (raw: unknown, fromVersion: number) => T | null;
  /**
   * Optional file-mode applied on every write (e.g. `0o600` for files
   * that hold an API token).
   */
  mode?: number;
  /**
   * State scope. Global state uses `<globalAgentDir>/sf-pi/...`; project
   * state uses `<cwd>/.pi/...`. Defaults to global.
   */
  scope?: "global" | "project";
  /** Required when `scope: "project"` and `pathOverride` is not set. */
  cwd?: string;
  /**
   * Custom absolute path override. Use for legacy state files that
   * predate this helper or that intentionally keep a flat project path.
   * New code should leave this unset so the canonical scoped layout is used.
   */
  pathOverride?: string;
}

export interface StateStore<T> {
  /** Read state. Always returns a value — never throws. */
  read(): T;
  /** Write the full state atomically. */
  write(state: T): void;
  /**
   * Read, apply a pure update fn, and write the result. Returns the
   * post-update state. Concurrent updaters in the same process race; the
   * last writer wins.
   */
  update(fn: (current: T) => T): T;
  /** Resolved absolute file path (post `pathOverride` resolution). */
  readonly path: string;
}

export function createStateStore<T>(options: StateStoreOptions<T>): StateStore<T> {
  const filePath = options.pathOverride ?? statePath(options);
  const { schemaVersion, defaults, migrate, mode } = options;

  function read(): T {
    if (!existsSync(filePath)) return defaults;
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      return defaults;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaults;
    }

    if (!isEnvelope(parsed)) {
      // Pre-envelope file (legacy) — let migrate decide.
      if (migrate) {
        const migrated = safeMigrate(migrate, parsed, 0);
        if (migrated !== null) return migrated;
      }
      return defaults;
    }

    if (parsed.schemaVersion === schemaVersion) {
      return parsed.state as T;
    }

    if (migrate) {
      const migrated = safeMigrate(migrate, parsed.state, parsed.schemaVersion);
      if (migrated !== null) return migrated;
    }
    return defaults;
  }

  function write(state: T): void {
    const envelope: OnDiskEnvelope = { schemaVersion, state };
    const dir = path.dirname(filePath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      return; // best-effort
    }

    // Atomic write: write to <file>.<pid>.tmp, then rename. The rename is
    // atomic on the same filesystem, so a crash mid-write never leaves a
    // half-written JSON file in place.
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    try {
      writeFileSync(tmpPath, `${JSON.stringify(envelope, null, 2)}\n`, {
        encoding: "utf8",
        ...(mode !== undefined ? { mode } : {}),
      });
    } catch {
      return;
    }

    try {
      renameSync(tmpPath, filePath);
    } catch {
      // If rename failed, try to clean up the tmp file so it doesn't accumulate.
      try {
        unlinkSync(tmpPath);
      } catch {
        // ignore — the next write will overwrite the tmp anyway.
      }
    }
  }

  function update(fn: (current: T) => T): T {
    const current = read();
    const next = fn(current);
    write(next);
    return next;
  }

  return {
    read,
    write,
    update,
    path: filePath,
  };
}

/** Public canonical global path so tests and migration code can compare paths. */
export function canonicalStatePath(namespace: string, filename: string): string {
  return globalAgentPath("sf-pi", namespace, filename);
}

/** Public canonical project path for project-scoped state. */
export function canonicalProjectStatePath(
  cwd: string,
  namespace: string,
  filename: string,
): string {
  return path.join(projectConfigDir(cwd), namespace, filename);
}

function statePath<T>(options: StateStoreOptions<T>): string {
  if (options.scope === "project") {
    if (!options.cwd) {
      throw new Error("createStateStore scope='project' requires cwd unless pathOverride is set.");
    }
    return canonicalProjectStatePath(options.cwd, options.namespace, options.filename);
  }
  return canonicalStatePath(options.namespace, options.filename);
}

function isEnvelope(value: unknown): value is OnDiskEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OnDiskEnvelope>;
  return typeof candidate.schemaVersion === "number" && "state" in candidate;
}

function safeMigrate<T>(
  migrate: (raw: unknown, fromVersion: number) => T | null,
  raw: unknown,
  fromVersion: number,
): T | null {
  try {
    return migrate(raw, fromVersion);
  } catch {
    return null;
  }
}
