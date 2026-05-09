/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Persistent state for announcements.
 *
 * Stored at:
 *   <globalAgentDir>/state/sf-pi/announcements.json
 *
 * Backed by the shared `lib/common/state-store.ts` helper (atomic write,
 * schema versioning, safe defaults). The on-disk path is preserved at the
 * legacy `state/sf-pi/` location so existing dismissals and remote-feed
 * caches survive the migration.
 *
 * Design mirrors recommendations-state.ts intentionally:
 *   - Separate state file (don't pollute settings.json diffs)
 *   - Best-effort read/write — never throws
 *   - Sticky dismissals across manifest revisions; bumping `revision`
 *     re-arms the nudge but already-dismissed ids stay hidden
 *
 * Stored fields:
 *   - acknowledgedRevision  — manifest revision the user last saw in the splash
 *   - dismissed[id]         — ISO timestamp when the user dismissed an item
 *   - lastFetchAt           — ISO timestamp of last successful remote fetch
 *   - lastFetchEtag         — ETag from the remote feed (for conditional GET)
 *   - cachedRemote          — last successful remote payload (opaque string,
 *                              trusted only after schema re-validation)
 */
import { createStateStore, type StateStore } from "../state-store.ts";
import { globalAgentPath } from "../pi-paths.ts";

const NAMESPACE = "sf-pi-announcements";
const SCHEMA_VERSION = 1;

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

function buildStore(filePath: string): StateStore<AnnouncementsState> {
  return createStateStore<AnnouncementsState>({
    namespace: NAMESPACE,
    filename: "announcements.json",
    schemaVersion: SCHEMA_VERSION,
    defaults: cloneEmptyState(),
    pathOverride: filePath,
    // Pre-envelope (fromVersion === 0) is the bare object the file
    // shipped with before this module adopted state-store.ts. Migrate by
    // re-validating each known field; unknown fields are dropped because
    // every supported field is enumerated below.
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      return parseLooseState(raw as Partial<AnnouncementsState>);
    },
  });
}

function parseLooseState(parsed: Partial<AnnouncementsState>): AnnouncementsState {
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
}

/** Read state. Returns a fresh empty state on any error — never throws. */
export function readAnnouncementsState(filePath = announcementsStatePath()): AnnouncementsState {
  try {
    return parseLooseState(buildStore(filePath).read());
  } catch {
    return cloneEmptyState();
  }
}

/** Write state atomically (tmp-file + rename), creating parent dirs as needed. */
export function writeAnnouncementsState(
  state: AnnouncementsState,
  filePath = announcementsStatePath(),
): void {
  try {
    buildStore(filePath).write(state);
  } catch {
    // Persistence is best-effort — never crash the splash.
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
