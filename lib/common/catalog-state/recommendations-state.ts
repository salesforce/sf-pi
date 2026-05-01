/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read/write the recommendations state file.
 *
 * Stored at:
 *   <globalAgentDir>/state/sf-pi/recommendations.json
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { globalAgentPath } from "../pi-paths.ts";

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

/** Read state. Returns a fresh empty state on any error \u2014 never throws. */
export function readRecommendationsState(
  filePath = recommendationsStatePath(),
): RecommendationsState {
  if (!existsSync(filePath)) {
    return cloneEmptyState();
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return cloneEmptyState();

    const state: RecommendationsState = cloneEmptyState();
    if (typeof parsed.acknowledgedRevision === "string") {
      state.acknowledgedRevision = parsed.acknowledgedRevision;
    }
    if (parsed.decisions && typeof parsed.decisions === "object") {
      for (const [itemId, value] of Object.entries(parsed.decisions)) {
        if (value === "installed" || value === "declined") {
          state.decisions[itemId] = value;
        }
      }
    }
    return state;
  } catch {
    return cloneEmptyState();
  }
}

/** Write state atomically, creating parent dirs as needed. */
export function writeRecommendationsState(
  state: RecommendationsState,
  filePath = recommendationsStatePath(),
): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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
