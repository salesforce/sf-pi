/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read/write the recommendations state file.
 *
 * Stored at:
 *   <globalAgentDir>/state/sf-pi/recommendations.json
 *
 * Backed by the shared `lib/common/state-store.ts` helper (atomic write,
 * schema versioning, safe defaults). The on-disk path is preserved at the
 * legacy `state/sf-pi/` location so existing dismissals and decisions
 * survive the migration.
 *
 * Why a separate state file (not settings.json):
 * - Settings live under the user's control and should stay human-editable.
 * - State is machine-written bookkeeping ("has the user seen revision X?",
 *   "did they decline item Y?") and should not pollute settings diffs.
 *
 * The state is additive and sticky:
 * - `acknowledgedRevision` records the manifest revision the user last saw.
 *   Bumping the manifest revision re-arms the nudge exactly once.
 * - `decisions[itemId]` is sticky across revisions. We never re-install an
 *   item the user declined, and we never re-prompt for an item they already
 *   installed (unless the manifest drops and re-adds it under a new id).
 */
import { createStateStore, type StateStore } from "../state-store.ts";
import { globalAgentPath } from "../pi-paths.ts";

const NAMESPACE = "sf-pi-recommendations";
const SCHEMA_VERSION = 1;

export type RecommendationDecision = "installed" | "declined";

export interface RecommendationsState {
  acknowledgedRevision: string;
  decisions: Record<string, RecommendationDecision>;
}

const EMPTY_STATE: RecommendationsState = {
  acknowledgedRevision: "",
  decisions: {},
};

/** Default state path under the global pi agent directory. */
export function recommendationsStatePath(): string {
  return globalAgentPath("state", "sf-pi", "recommendations.json");
}

function buildStore(filePath: string): StateStore<RecommendationsState> {
  return createStateStore<RecommendationsState>({
    namespace: NAMESPACE,
    filename: "recommendations.json",
    schemaVersion: SCHEMA_VERSION,
    defaults: cloneEmptyState(),
    pathOverride: filePath,
    // Pre-envelope (fromVersion === 0) — the legacy bare-object format.
    // Re-validate each known field; unknown fields are intentionally dropped
    // because the shape is small and exhaustively enumerated.
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      return parseLooseState(raw as Record<string, unknown>);
    },
  });
}

function parseLooseState(parsed: Record<string, unknown>): RecommendationsState {
  const state = cloneEmptyState();
  if (typeof parsed.acknowledgedRevision === "string") {
    state.acknowledgedRevision = parsed.acknowledgedRevision;
  }
  if (parsed.decisions && typeof parsed.decisions === "object") {
    for (const [itemId, value] of Object.entries(parsed.decisions as Record<string, unknown>)) {
      if (value === "installed" || value === "declined") {
        state.decisions[itemId] = value;
      }
    }
  }
  return state;
}

/** Read state. Returns a fresh empty state on any error — never throws. */
export function readRecommendationsState(
  filePath = recommendationsStatePath(),
): RecommendationsState {
  try {
    return parseLooseState(buildStore(filePath).read() as unknown as Record<string, unknown>);
  } catch {
    return cloneEmptyState();
  }
}

/** Write state atomically (tmp-file + rename), creating parent dirs as needed. */
export function writeRecommendationsState(
  state: RecommendationsState,
  filePath = recommendationsStatePath(),
): void {
  try {
    buildStore(filePath).write(state);
  } catch {
    // Persistence is best-effort — never crash the manager flow.
  }
}

/** Merge a decision into the state and persist. */
export function recordDecision(
  itemId: string,
  decision: RecommendationDecision,
  filePath = recommendationsStatePath(),
): RecommendationsState {
  const state = readRecommendationsState(filePath);
  state.decisions[itemId] = decision;
  writeRecommendationsState(state, filePath);
  return state;
}

/** Mark the manifest revision as seen. */
export function acknowledgeRevision(
  revision: string,
  filePath = recommendationsStatePath(),
): RecommendationsState {
  const state = readRecommendationsState(filePath);
  state.acknowledgedRevision = revision;
  writeRecommendationsState(state, filePath);
  return state;
}

function cloneEmptyState(): RecommendationsState {
  return { acknowledgedRevision: EMPTY_STATE.acknowledgedRevision, decisions: {} };
}
