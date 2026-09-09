/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared SF Docs status store.
 *
 * sf-docs owns local token + endpoint resolution, while sf-welcome only needs a
 * small render-safe snapshot. This store keeps those consumers decoupled and
 * mirrors the Slack/tldraw globalThis-backed singleton pattern so producer and
 * consumer module copies share one state under Pi's jiti loader.
 */

export type DocsStatusKind = "hidden" | "not-configured" | "setup" | "ready";

export interface DocsStatusSnapshot {
  kind: DocsStatusKind;
  updatedAt?: string;
}

export type DocsStatusListener = (snapshot: DocsStatusSnapshot) => void;

const EMPTY_SNAPSHOT: DocsStatusSnapshot = { kind: "hidden" };
const GLOBAL_SLOT = "__sfPiDocsStatusStore" as const;

interface StoreBackingState {
  snapshot: DocsStatusSnapshot;
  listeners: Set<DocsStatusListener>;
}

function getBackingState(): StoreBackingState {
  const globalObj = globalThis as unknown as Record<string, StoreBackingState | undefined>;
  let state = globalObj[GLOBAL_SLOT];
  if (!state) {
    state = { snapshot: EMPTY_SNAPSHOT, listeners: new Set<DocsStatusListener>() };
    globalObj[GLOBAL_SLOT] = state;
  }
  return state;
}

export function getDocsStatus(): DocsStatusSnapshot {
  return getBackingState().snapshot;
}

export function setDocsStatus(next: DocsStatusSnapshot): void {
  const state = getBackingState();
  state.snapshot = { ...next, updatedAt: next.updatedAt ?? new Date().toISOString() };
  notifyListeners();
}

export function clearDocsStatus(): void {
  const state = getBackingState();
  state.snapshot = EMPTY_SNAPSHOT;
  notifyListeners();
}

export function subscribeDocsStatus(listener: DocsStatusListener): () => void {
  const state = getBackingState();
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

function notifyListeners(): void {
  const state = getBackingState();
  for (const listener of state.listeners) {
    try {
      listener(state.snapshot);
    } catch {
      // One bad UI consumer must not break Docs status publication.
    }
  }
}

export function __resetDocsStatusStoreForTests(): void {
  const state = getBackingState();
  state.snapshot = EMPTY_SNAPSHOT;
  state.listeners.clear();
}
