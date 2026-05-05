/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared Slack status store.
 *
 * sf-slack owns live auth + scope probing, while sf-welcome and sf-devbar only
 * need a small render-safe snapshot. This store keeps those consumers decoupled
 * from sf-slack internals and mirrors the monthly-usage store's globalThis-backed
 * singleton pattern so producer/consumer module copies share one state under Pi's
 * jiti loader.
 */

export type SlackStatusKind =
  | "hidden"
  | "loading"
  | "ready"
  | "not-configured"
  | "auth-error"
  | "scope-drift"
  | "scopes-unknown";

export interface SlackStatusSnapshot {
  kind: SlackStatusKind;
  userName?: string;
  tokenType?: "user" | "bot" | "app" | "unknown";
  grantedScopes?: number;
  requestedScopes?: number;
  missingScopes?: number;
  updatedAt?: string;
}

export type SlackStatusListener = (snapshot: SlackStatusSnapshot) => void;

const EMPTY_SNAPSHOT: SlackStatusSnapshot = { kind: "hidden" };
const GLOBAL_SLOT = "__sfPiSlackStatusStore" as const;

interface StoreBackingState {
  snapshot: SlackStatusSnapshot;
  listeners: Set<SlackStatusListener>;
}

function getBackingState(): StoreBackingState {
  const globalObj = globalThis as unknown as Record<string, StoreBackingState | undefined>;
  let state = globalObj[GLOBAL_SLOT];
  if (!state) {
    state = { snapshot: EMPTY_SNAPSHOT, listeners: new Set<SlackStatusListener>() };
    globalObj[GLOBAL_SLOT] = state;
  }
  return state;
}

export function getSlackStatus(): SlackStatusSnapshot {
  return getBackingState().snapshot;
}

export function setSlackStatus(next: SlackStatusSnapshot): void {
  const state = getBackingState();
  state.snapshot = { ...next, updatedAt: next.updatedAt ?? new Date().toISOString() };
  notifyListeners();
}

export function clearSlackStatus(): void {
  const state = getBackingState();
  state.snapshot = EMPTY_SNAPSHOT;
  notifyListeners();
}

export function subscribeSlackStatus(listener: SlackStatusListener): () => void {
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
      // One bad UI consumer must not break Slack status publication.
    }
  }
}

export function __resetSlackStatusStoreForTests(): void {
  const state = getBackingState();
  state.snapshot = EMPTY_SNAPSHOT;
  state.listeners.clear();
}
