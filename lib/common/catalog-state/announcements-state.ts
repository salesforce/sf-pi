/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Persistent state for announcements.
 *
 * Stored at:
 *   <globalAgentDir>/state/sf-pi/announcements.json
 *
 * Design mirrors recommendations-state.ts intentionally:
 *   - Separate state file (don't pollute settings.json diffs)
 *   - Best-effort read/write \u2014 never throws
 *   - Sticky dismissals across manifest revisions; bumping `revision`
 *     re-arms the nudge but already-dismissed ids stay hidden
 *
 * Stored fields:
 *   - acknowledgedRevision  \u2014 manifest revision the user last saw in the splash
 *   - dismissed[id]         \u2014 ISO timestamp when the user dismissed an item
 *   - lastFetchAt           \u2014 ISO timestamp of last successful remote fetch
 *   - lastFetchEtag         \u2014 ETag from the remote feed (for conditional GET)
 *   - cachedRemote          \u2014 last successful remote payload (opaque string,
 *                              trusted only after schema re-validation)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { globalAgentPath } from "../pi-paths.ts";

export interface AnnouncementsState {
  acknowledgedRevision: string;
  dismissed: Record<string, string>;
  lastFetchAt?: string;
  lastFetchEtag?: string;
  cachedRemote?: string;
}

const EMPTY_STATE: AnnouncementsState = {
  acknowledgedRevision: "",
  dismissed: {},
};

/** Default state path under the global pi agent directory. */
export function announcementsStatePath(): string {
  return globalAgentPath("state", "sf-pi", "announcements.json");
}

/** Read state. Returns a fresh empty state on any error \u2014 never throws. */
export function readAnnouncementsState(filePath = announcementsStatePath()): AnnouncementsState {
  if (!existsSync(filePath)) return cloneEmptyState();
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<AnnouncementsState>;
    if (!parsed || typeof parsed !== "object") return cloneEmptyState();

    const state = cloneEmptyState();
    if (typeof parsed.acknowledgedRevision === "string") {
      state.acknowledgedRevision = parsed.acknowledgedRevision;
    }
    if (parsed.dismissed && typeof parsed.dismissed === "object") {
      for (const [itemId, value] of Object.entries(parsed.dismissed)) {
        if (typeof value === "string" && value.trim()) {
          state.dismissed[itemId] = value;
        }
      }
    }
    if (typeof parsed.lastFetchAt === "string") state.lastFetchAt = parsed.lastFetchAt;
    if (typeof parsed.lastFetchEtag === "string") state.lastFetchEtag = parsed.lastFetchEtag;
    if (typeof parsed.cachedRemote === "string") state.cachedRemote = parsed.cachedRemote;
    return state;
  } catch {
    return cloneEmptyState();
  }
}

/** Write state atomically, creating parent dirs as needed. */
export function writeAnnouncementsState(
  state: AnnouncementsState,
  filePath = announcementsStatePath(),
): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    // Persistence is best-effort \u2014 never crash the splash.
  }
}

/** Mark a single announcement id as dismissed now. */
export function dismissAnnouncement(
  id: string,
  filePath = announcementsStatePath(),
): AnnouncementsState {
  const state = readAnnouncementsState(filePath);
  state.dismissed[id] = new Date().toISOString();
  writeAnnouncementsState(state, filePath);
  return state;
}

/** Mark the manifest revision as seen (after the splash has shown it). */
export function acknowledgeAnnouncementsRevision(
  revision: string,
  filePath = announcementsStatePath(),
): AnnouncementsState {
  const state = readAnnouncementsState(filePath);
  state.acknowledgedRevision = revision;
  writeAnnouncementsState(state, filePath);
  return state;
}

/** Reset all dismissals and the acknowledged revision. */
export function resetAnnouncementsState(filePath = announcementsStatePath()): void {
  writeAnnouncementsState(cloneEmptyState(), filePath);
}

/** Persist remote-fetch bookkeeping (ETag + payload cache). */
export function updateRemoteCache(
  patch: Pick<AnnouncementsState, "lastFetchAt" | "lastFetchEtag" | "cachedRemote">,
  filePath = announcementsStatePath(),
): AnnouncementsState {
  const state = readAnnouncementsState(filePath);
  if (patch.lastFetchAt !== undefined) state.lastFetchAt = patch.lastFetchAt;
  if (patch.lastFetchEtag !== undefined) state.lastFetchEtag = patch.lastFetchEtag;
  if (patch.cachedRemote !== undefined) state.cachedRemote = patch.cachedRemote;
  writeAnnouncementsState(state, filePath);
  return state;
}

function cloneEmptyState(): AnnouncementsState {
  return {
    acknowledgedRevision: EMPTY_STATE.acknowledgedRevision,
    dismissed: {},
  };
}
