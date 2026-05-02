/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared in-process LSP health registry.
 *
 * Why this exists:
 *   - sf-lsp knows per-language doctor availability ("is Apex jorje
 *     discoverable? Is the Agent Script SDK installed? Is
 *     lwc-language-server on PATH?").
 *   - sf-devbar wants to render that as a permanent top-bar segment on
 *     the right hand side.
 *
 * We keep a tiny process-scoped singleton, mirroring how
 * `lib/common/sf-environment/shared-runtime.ts` shares org data between
 * sf-devbar and sf-welcome. No Pi API, no persistence — extensions each
 * import this module and coordinate via its tiny mutate/subscribe API.
 *
 * Source-of-truth: sf-lsp's `session_start` probe writes here; sf-devbar
 * reads here and repaints on change. If sf-lsp is disabled, the registry
 * stays `"unknown"` and sf-devbar renders neutral grey dots.
 */
import type { SupportedLspLanguage } from "./types.ts";

export type { SupportedLspLanguage } from "./types.ts";

/**
 * Availability status for one LSP language. Kept intentionally tiny — the
 * top-bar doesn't need error counts or last-file info (that stays inside
 * sf-lsp via the transcript row + `/sf-lsp` panel).
 */
export type SfLspLanguageHealth = "available" | "unavailable" | "unknown";

export interface SfLspLanguageEntry {
  language: SupportedLspLanguage;
  health: SfLspLanguageHealth;
  /** Reason string when `unavailable` — used for tooltips/debugging. */
  detail?: string;
}

export interface SfLspHealthSnapshot {
  byLanguage: Record<SupportedLspLanguage, SfLspLanguageEntry>;
  /** Monotonically increasing counter, bumped on every mutation. */
  revision: number;
}

type Listener = (snapshot: SfLspHealthSnapshot) => void;

const SUPPORTED: readonly SupportedLspLanguage[] = ["apex", "lwc", "agentscript"];

const state: SfLspHealthSnapshot = {
  byLanguage: {
    apex: { language: "apex", health: "unknown" },
    lwc: { language: "lwc", health: "unknown" },
    agentscript: { language: "agentscript", health: "unknown" },
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

/** Current snapshot (read-only). */
export function getSfLspHealth(): SfLspHealthSnapshot {
  return snapshot();
}

/** Update one language's health. No-op if nothing changed. */
export function setSfLspLanguageHealth(
  language: SupportedLspLanguage,
  health: SfLspLanguageHealth,
  detail?: string,
): void {
  const current = state.byLanguage[language];
  if (current.health === health && current.detail === detail) return;
  state.byLanguage[language] = { language, health, detail };
  state.revision += 1;
  fire();
}

/** Bulk-update from a doctor probe. */
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
    const nextHealth: SfLspLanguageHealth = status.available ? "available" : "unavailable";
    const nextDetail = status.available ? undefined : status.detail;
    if (current.health !== nextHealth || current.detail !== nextDetail) {
      state.byLanguage[status.language] = {
        language: status.language,
        health: nextHealth,
        detail: nextDetail,
      };
      changed = true;
    }
  }
  if (changed) {
    state.revision += 1;
    fire();
  }
}

/** Reset all languages to `unknown`. Used on session_shutdown. */
export function resetSfLspHealth(): void {
  let changed = false;
  for (const language of SUPPORTED) {
    const current = state.byLanguage[language];
    if (current.health !== "unknown" || current.detail !== undefined) {
      state.byLanguage[language] = { language, health: "unknown" };
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
