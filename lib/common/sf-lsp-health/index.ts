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
 * The registry is a tiny process-scoped singleton, mirroring how
 * `lib/common/sf-environment/shared-runtime.ts` shares org data between
 * sf-devbar and sf-welcome. No Pi API, no persistence — extensions each
 * import this module and coordinate via its mutate/subscribe API.
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

function makeEntry(language: SupportedLspLanguage): SfLspLanguageEntry {
  return { language, availability: "unknown", activity: "idle" };
}

const state: SfLspHealthSnapshot = {
  byLanguage: {
    apex: makeEntry("apex"),
    lwc: makeEntry("lwc"),
    agentscript: makeEntry("agentscript"),
  },
  revision: 0,
};

const listeners = new Set<Listener>();

function snapshot(): SfLspHealthSnapshot {
  return {
    byLanguage: {
      apex: { ...state.byLanguage.apex },
      lwc: { ...state.byLanguage.lwc },
      agentscript: { ...state.byLanguage.agentscript },
    },
    revision: state.revision,
  };
}

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
  const current = state.byLanguage[language];
  if (current.availability === availability && current.unavailableDetail === unavailableDetail) {
    return;
  }
  state.byLanguage[language] = {
    ...current,
    availability,
    unavailableDetail: availability === "unavailable" ? unavailableDetail : undefined,
  };
  state.revision += 1;
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
  let changed = false;
  for (const status of statuses) {
    const current = state.byLanguage[status.language];
    const nextAvailability: SfLspAvailability = status.available ? "available" : "unavailable";
    const nextDetail = status.available ? undefined : status.detail;
    if (current.availability !== nextAvailability || current.unavailableDetail !== nextDetail) {
      state.byLanguage[status.language] = {
        ...current,
        availability: nextAvailability,
        unavailableDetail: nextDetail,
      };
      changed = true;
    }
  }
  if (changed) {
    state.revision += 1;
    fire();
  }
}

/**
 * Update one language's activity status. Used by sf-lsp around each
 * diagnostic check:
 *   - `checking` at the start of a check
 *   - `clean` or `error` when the check finishes
 *
 * `lastErrorCount` and `lastFileName` round out the tooltip text.
 */
export function setSfLspActivity(
  language: SupportedLspLanguage,
  activity: SfLspActivity,
  options: { fileName?: string; errorCount?: number } = {},
): void {
  const current = state.byLanguage[language];
  state.byLanguage[language] = {
    ...current,
    activity,
    lastFileName: options.fileName ?? current.lastFileName,
    lastErrorCount: activity === "error" ? (options.errorCount ?? 0) : undefined,
    lastUpdatedAt: Date.now(),
  };
  state.revision += 1;
  fire();
}

/** Reset all languages to the zero state. Used on session_shutdown. */
export function resetSfLspHealth(): void {
  let changed = false;
  for (const language of SUPPORTED) {
    const current = state.byLanguage[language];
    if (
      current.availability !== "unknown" ||
      current.activity !== "idle" ||
      current.unavailableDetail !== undefined ||
      current.lastErrorCount !== undefined ||
      current.lastFileName !== undefined ||
      current.lastUpdatedAt !== undefined
    ) {
      state.byLanguage[language] = makeEntry(language);
      changed = true;
    }
  }
  if (changed) {
    state.revision += 1;
    fire();
  }
}

/**
 * Subscribe to health changes. Listener is called synchronously after each
 * mutation. Returns an unsubscribe function.
 */
export function onSfLspHealthChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function fire(): void {
  const snap = snapshot();
  for (const listener of listeners) {
    try {
      listener(snap);
    } catch {
      // Listener errors must not corrupt downstream listeners.
    }
  }
}
