/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared dedicated-compaction status store.
 *
 * sf-llm-gateway owns settings and cached-model classification. SF Welcome only
 * consumes this render-safe snapshot. globalThis keeps producer and consumer
 * module copies connected under Pi's jiti loader.
 */

export type CompactionStatusKind =
  "hidden" | "checking" | "dedicated" | "default" | "disabled" | "unavailable";

export interface CompactionStatusSnapshot {
  kind: CompactionStatusKind;
  model?: string;
  modelLabel?: string;
  contextWindow?: number;
  source?: "global" | "project" | "default";
  updatedAt?: string;
}

export type CompactionStatusListener = (snapshot: CompactionStatusSnapshot) => void;

const EMPTY_SNAPSHOT: CompactionStatusSnapshot = { kind: "hidden" };
const GLOBAL_SLOT = "__sfPiCompactionStatusStore" as const;

interface StoreBackingState {
  snapshot: CompactionStatusSnapshot;
  listeners: Set<CompactionStatusListener>;
}

function getBackingState(): StoreBackingState {
  const globalObj = globalThis as unknown as Record<string, StoreBackingState | undefined>;
  let state = globalObj[GLOBAL_SLOT];
  if (!state) {
    state = { snapshot: EMPTY_SNAPSHOT, listeners: new Set<CompactionStatusListener>() };
    globalObj[GLOBAL_SLOT] = state;
  }
  return state;
}

export function getCompactionStatus(): CompactionStatusSnapshot {
  return getBackingState().snapshot;
}

export function setCompactionStatus(next: CompactionStatusSnapshot): void {
  const state = getBackingState();
  state.snapshot = { ...next, updatedAt: next.updatedAt ?? new Date().toISOString() };
  for (const listener of state.listeners) {
    try {
      listener(state.snapshot);
    } catch {
      // One UI consumer must not break status publication.
    }
  }
}

export function clearCompactionStatus(): void {
  setCompactionStatus(EMPTY_SNAPSHOT);
}

export function subscribeCompactionStatus(listener: CompactionStatusListener): () => void {
  const state = getBackingState();
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function __resetCompactionStatusStoreForTests(): void {
  const state = getBackingState();
  state.snapshot = EMPTY_SNAPSHOT;
  state.listeners.clear();
}
