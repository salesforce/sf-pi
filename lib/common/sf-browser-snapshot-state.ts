/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Cross-extension state for the latest SF Browser snapshot refs.
 *
 * SF Browser writes compact ref metadata after each snapshot. SF Guardrail reads
 * it during pre-execution tool_call mediation so it can classify committing UI
 * clicks from the latest accessible label, not only from model-supplied
 * mutation/reason fields.
 */
import { createStateStore } from "./state-store.ts";

export interface BrowserSnapshotRefEntry {
  ref: string;
  role?: string;
  label?: string;
  line: string;
}

export interface BrowserSnapshotSessionState {
  sessionId: string;
  capturedAt: string;
  url?: string;
  fullSnapshotPath?: string;
  refs: BrowserSnapshotRefEntry[];
}

interface BrowserSnapshotState {
  sessions: BrowserSnapshotSessionState[];
}

const MAX_SESSIONS = 25;

const store = createStateStore<BrowserSnapshotState>({
  namespace: "sf-browser/snapshots",
  filename: "latest-refs.json",
  schemaVersion: 1,
  defaults: { sessions: [] },
});

export function writeLatestBrowserSnapshotRefs(input: {
  sessionId: string;
  snapshot: string;
  url?: string;
  fullSnapshotPath?: string;
}): BrowserSnapshotSessionState {
  const refs = extractBrowserSnapshotRefs(input.snapshot);
  const next: BrowserSnapshotSessionState = {
    sessionId: input.sessionId,
    capturedAt: new Date().toISOString(),
    url: input.url,
    fullSnapshotPath: input.fullSnapshotPath,
    refs,
  };
  store.update((current) => ({
    sessions: [
      next,
      ...current.sessions.filter((session) => session.sessionId !== input.sessionId),
    ].slice(0, MAX_SESSIONS),
  }));
  return next;
}

export function findLatestBrowserSnapshotRef(
  sessionId: string | undefined,
  ref: string | undefined,
): BrowserSnapshotRefEntry | undefined {
  if (!sessionId || !ref) return undefined;
  const normalized = normalizeBrowserRef(ref);
  if (!normalized) return undefined;
  const session = store.read().sessions.find((entry) => entry.sessionId === sessionId);
  return session?.refs.find((entry) => normalizeBrowserRef(entry.ref) === normalized);
}

export function extractBrowserSnapshotRefs(snapshot: string): BrowserSnapshotRefEntry[] {
  return snapshot
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseSnapshotRefLine)
    .filter((entry): entry is BrowserSnapshotRefEntry => Boolean(entry));
}

export function normalizeBrowserRef(ref: string | undefined): string | undefined {
  const match = ref?.trim().match(/^@?(e\d+)$/i);
  return match ? match[1].toLowerCase() : undefined;
}

function parseSnapshotRefLine(line: string): BrowserSnapshotRefEntry | undefined {
  const refMatch = line.match(/\bref=(@?e\d+)\b/i);
  if (!refMatch) return undefined;
  const quoted = line.match(/^[-\s]*([A-Za-z][\w-]*)\s+"([^"]+)"/);
  const fallback = line.match(/^[-\s]*([A-Za-z][\w-]*)\b/);
  return {
    ref: normalizeBrowserRef(refMatch[1]) ?? refMatch[1],
    role: quoted?.[1] ?? fallback?.[1],
    label: quoted?.[2],
    line,
  };
}
