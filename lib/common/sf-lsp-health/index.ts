/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared in-process LSP health registry.
 *
 * Two pieces of state per Salesforce LSP language:
 *
 *   1. `availability` — can we even run diagnostics?
 *        unknown      — not probed yet (session just started)
 *        available    — jar / server / binary is discoverable
 *        unavailable  — missing; `/sf-lsp doctor` can tell you why
 *
 *   2. `activity` — what did the most recent check do?
 *        idle         — no check has run yet this session
 *        checking     — a check is in flight right now
 *        clean        — the last check found no errors
 *        error        — the last check found errors
 *
 * The renderer in `sf-devbar` combines both signals into a single glyph +
 * color so the top bar reflects availability AND recent work at a glance.
 *
 * Why this lives on `globalThis`:
 *   Pi's extension loader (jiti) can give each extension its own module
 *   graph. That means plain module-level state in this file would create
 *   *two* separate registries — one in sf-lsp and one in sf-devbar — and
 *   writes in one would never reach the other. We intentionally pin the
 *   state on `globalThis.__sfLspHealthRegistry__` (a symbol in the
 *   process global) so every caller, regardless of which module graph
 *   loaded this file, sees the same object. This matches the pattern
 *   used for Pi's own shared TUI singleton.
 */
import type { SupportedLspLanguage } from "./types.ts";

export type { SupportedLspLanguage } from "./types.ts";

export type SfLspAvailability = "available" | "unavailable" | "unknown";
export type SfLspActivity = "idle" | "checking" | "clean" | "error";

export interface SfLspLanguageEntry {
  language: SupportedLspLanguage;
  availability: SfLspAvailability;
  activity: SfLspActivity;
  /** Reason string when `unavailable` — used for tooltips/debugging. */
  unavailableDetail?: string;
  /** Count of diagnostics from the last check (error status only). */
  lastErrorCount?: number;
  /** Last file checked, basename only. Used for tooltips/transcript. */
  lastFileName?: string;
  /** Monotonic timestamp (Date.now()) of the last update. */
  lastUpdatedAt?: number;
}

export interface SfLspHealthSnapshot {
  byLanguage: Record<SupportedLspLanguage, SfLspLanguageEntry>;
  /** Monotonically increasing counter, bumped on every mutation. */
  revision: number;
}

type Listener = (snapshot: SfLspHealthSnapshot) => void;

const SUPPORTED: readonly SupportedLspLanguage[] = ["apex", "lwc", "agentscript"];

interface SharedRegistry {
  state: SfLspHealthSnapshot;
  listeners: Set<Listener>;
}

// -------------------------------------------------------------------------------------------------
// Shared instance on globalThis
// -------------------------------------------------------------------------------------------------

/**
 * Symbol-keyed slot on globalThis. Using a Symbol.for() name keeps us from
 * colliding with any other library's global state, while still allowing
 * repeated imports across isolated module graphs to resolve to the same
 * object.
 */
const REGISTRY_KEY = Symbol.for("sf-pi.sf-lsp-health.registry.v2");

type GlobalWithRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: SharedRegistry;
};

function makeEntry(language: SupportedLspLanguage): SfLspLanguageEntry {
  return { language, availability: "unknown", activity: "idle" };
}

function createRegistry(): SharedRegistry {
  return {
    state: {
      byLanguage: {
        apex: makeEntry("apex"),
        lwc: makeEntry("lwc"),
        agentscript: makeEntry("agentscript"),
      },
      revision: 0,
    },
    listeners: new Set<Listener>(),
  };
}

function getRegistry(): SharedRegistry {
  const globals = globalThis as GlobalWithRegistry;
  let registry = globals[REGISTRY_KEY];
  if (!registry) {
    registry = createRegistry();
    globals[REGISTRY_KEY] = registry;
  }
  return registry;
}

function snapshot(): SfLspHealthSnapshot {
  const { state } = getRegistry();
  return {
    byLanguage: {
      apex: { ...state.byLanguage.apex },
      lwc: { ...state.byLanguage.lwc },
      agentscript: { ...state.byLanguage.agentscript },
    },
    revision: state.revision,
  };
}

function fire(): void {
  const { listeners } = getRegistry();
  const snap = snapshot();
  for (const listener of listeners) {
    try {
      listener(snap);
    } catch {
      // Listener errors must not corrupt downstream listeners.
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

/** Current snapshot (read-only copy). */
export function getSfLspHealth(): SfLspHealthSnapshot {
  return snapshot();
}

/**
 * Update one language's availability. No-op if the value is unchanged.
 * Does not touch the `activity` field — per-file check progress is owned
 * by `setSfLspActivity`.
 */
export function setSfLspAvailability(
  language: SupportedLspLanguage,
  availability: SfLspAvailability,
  unavailableDetail?: string,
): void {
  const registry = getRegistry();
  const current = registry.state.byLanguage[language];
  if (current.availability === availability && current.unavailableDetail === unavailableDetail) {
    return;
  }
  registry.state.byLanguage[language] = {
    ...current,
    availability,
    unavailableDetail: availability === "unavailable" ? unavailableDetail : undefined,
  };
  registry.state.revision += 1;
  fire();
}

/** Bulk-update availability from a doctor probe. */
export function setSfLspHealthFromDoctor(
  statuses: ReadonlyArray<{
    language: SupportedLspLanguage;
    available: boolean;
    detail: string;
  }>,
): void {
  const registry = getRegistry();
  let changed = false;
  for (const status of statuses) {
    const current = registry.state.byLanguage[status.language];
    const nextAvailability: SfLspAvailability = status.available ? "available" : "unavailable";
    const nextDetail = status.available ? undefined : status.detail;
    if (current.availability !== nextAvailability || current.unavailableDetail !== nextDetail) {
      registry.state.byLanguage[status.language] = {
        ...current,
        availability: nextAvailability,
        unavailableDetail: nextDetail,
      };
      changed = true;
    }
  }
  if (changed) {
    registry.state.revision += 1;
    fire();
  }
}

/**
 * Update one language's activity status. Used by sf-lsp around each
 * diagnostic check.
 */
export function setSfLspActivity(
  language: SupportedLspLanguage,
  activity: SfLspActivity,
  options: { fileName?: string; errorCount?: number } = {},
): void {
  const registry = getRegistry();
  const current = registry.state.byLanguage[language];
  registry.state.byLanguage[language] = {
    ...current,
    activity,
    lastFileName: options.fileName ?? current.lastFileName,
    lastErrorCount: activity === "error" ? (options.errorCount ?? 0) : undefined,
    lastUpdatedAt: Date.now(),
  };
  registry.state.revision += 1;
  fire();
}

/** Reset all languages to the zero state. Used on session_shutdown. */
export function resetSfLspHealth(): void {
  const registry = getRegistry();
  let changed = false;
  for (const language of SUPPORTED) {
    const current = registry.state.byLanguage[language];
    if (
      current.availability !== "unknown" ||
      current.activity !== "idle" ||
      current.unavailableDetail !== undefined ||
      current.lastErrorCount !== undefined ||
      current.lastFileName !== undefined ||
      current.lastUpdatedAt !== undefined
    ) {
      registry.state.byLanguage[language] = makeEntry(language);
      changed = true;
    }
  }
  if (changed) {
    registry.state.revision += 1;
    fire();
  }
}

/**
 * Subscribe to health changes. Listener is called synchronously after each
 * mutation. Returns an unsubscribe function.
 */
export function onSfLspHealthChange(listener: Listener): () => void {
  const registry = getRegistry();
  registry.listeners.add(listener);
  return () => registry.listeners.delete(listener);
}

/**
 * Testing-only: drop the shared registry from globalThis so each test
 * gets a fresh one. Never call from production code.
 */
export function __resetSfLspHealthRegistryForTests(): void {
  const globals = globalThis as GlobalWithRegistry;
  delete globals[REGISTRY_KEY];
}
