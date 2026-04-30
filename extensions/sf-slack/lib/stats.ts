/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Session-scoped research-activity counters for the sf-slack widget (P4).
 *
 * Kept intentionally minimal:
 *   - counts are per-action
 *   - message volume and approximate output bytes are tracked separately
 *   - a single listener is notified so index.ts can re-render the widget
 *
 * We do NOT persist these across reloads — the widget is a "what just
 * happened in this session" signal, not a historical log.
 */

export type StatAction = "search" | "thread" | "history" | "permalink";

export interface StatSample {
  action: StatAction;
  /** Number of messages / matches returned by the call. */
  messageCount: number;
  /** Size of the text body sent back to the LLM, in bytes. Approximate. */
  bytes: number;
}

export interface StatSnapshot {
  searches: number;
  threads: number;
  historyCalls: number;
  permalinks: number;
  messagesFetched: number;
  totalBytes: number;
}

const empty: StatSnapshot = {
  searches: 0,
  threads: 0,
  historyCalls: 0,
  permalinks: 0,
  messagesFetched: 0,
  totalBytes: 0,
};

let snapshot: StatSnapshot = { ...empty };
let listener: (() => void) | undefined;

export function getStats(): StatSnapshot {
  return snapshot;
}

export function resetStats(): void {
  snapshot = { ...empty };
  listener?.();
}

/** index.ts calls this once on session_start to hook the widget refresh. */
export function setStatsListener(fn: (() => void) | undefined): void {
  listener = fn;
}

/** Called from tool execute() right before returning a result. */
export function recordSample(sample: StatSample): void {
  switch (sample.action) {
    case "search":
      snapshot = { ...snapshot, searches: snapshot.searches + 1 };
      break;
    case "thread":
      snapshot = { ...snapshot, threads: snapshot.threads + 1 };
      break;
    case "history":
      snapshot = { ...snapshot, historyCalls: snapshot.historyCalls + 1 };
      break;
    case "permalink":
      snapshot = { ...snapshot, permalinks: snapshot.permalinks + 1 };
      break;
  }
  snapshot = {
    ...snapshot,
    messagesFetched: snapshot.messagesFetched + Math.max(0, sample.messageCount),
    totalBytes: snapshot.totalBytes + Math.max(0, sample.bytes),
  };
  listener?.();
}

// ─── Widget rendering ──────────────────────────────────────────────────────────

export interface StatsTheme {
  dim: (text: string) => string;
  muted: (text: string) => string;
  accent: (text: string) => string;
}

/** Render a compact single-line summary.
 *  Returns an empty array when nothing has been recorded — the caller should
 *  hide the widget in that case. */
export function renderStatsLines(theme: StatsTheme): string[] {
  const s = snapshot;
  const totalCalls = s.searches + s.threads + s.historyCalls + s.permalinks;
  if (totalCalls === 0) return [];

  const parts: string[] = [];
  if (s.searches > 0) parts.push(`${s.searches} search${s.searches !== 1 ? "es" : ""}`);
  if (s.threads > 0) parts.push(`${s.threads} thread${s.threads !== 1 ? "s" : ""}`);
  if (s.historyCalls > 0) parts.push(`${s.historyCalls} history`);
  if (s.permalinks > 0) parts.push(`${s.permalinks} permalink${s.permalinks !== 1 ? "s" : ""}`);
  if (s.messagesFetched > 0) parts.push(`${s.messagesFetched} msgs`);
  if (s.totalBytes > 0) parts.push(`${formatKb(s.totalBytes)} fetched`);

  return [theme.dim("Slack research ") + theme.muted("· ") + theme.accent(parts.join(" · "))];
}

function formatKb(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)}KB`;
  return `${(kb / 1024).toFixed(1)}MB`;
}
