/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared "inject this custom_message exactly once per live session" helper.
 *
 * Four sf-pi extensions (sf-brain, sf-devbar, sf-guardrail, sf-slack) inject
 * hidden `custom_message` entries from `before_agent_start`. The pattern is
 * identical:
 *
 *   1. Each call writes one entry the LLM sees on every replay (cache-friendly).
 *   2. The entry must be injected exactly once per *live* session — not on
 *      every turn — or the prompt bloats by N copies after N turns.
 *   3. Pi's compaction can sweep early entries into the summary; after that,
 *      the model no longer sees the entry verbatim and the extension must
 *      re-inject so the rules / identity / context stay live.
 *
 * Two pi-side traps the helper exists to neutralize:
 *
 * - **Entry-type mismatch.** Pi has two unrelated custom shapes:
 *     - `CustomEntry` (`type: "custom"`) — state-only marker, NOT in LLM
 *       context. Created via `pi.appendEntry()`.
 *     - `CustomMessageEntry` (`type: "custom_message"`) — content the LLM
 *       sees. Created when an extension returns
 *       `BeforeAgentStartEventResult.message`.
 *   Predicates that check `type === "custom"` never match a real injection.
 *   This helper only matches `custom_message`, so the bug class disappears.
 *
 * - **Branch and compaction projection.** The helper reads Pi's public
 *   `buildContextEntries()` projection, which follows only the active leaf and
 *   omits entries swept into the latest compaction summary.
 */
import type { CustomMessageEntry, SessionEntry } from "@earendil-works/pi-coding-agent";

export interface ActiveContextSession {
  buildContextEntries(): SessionEntry[];
}

/**
 * Type guard for a `custom_message` entry with the given customType.
 * Use this instead of hand-rolling `entry.type === "custom"` checks — the
 * `"custom"` shape is a different (state-only) entry kind that never
 * matches what extensions actually inject.
 */
export function isLiveCustomMessageEntry(
  entry: unknown,
  customType: string,
): entry is CustomMessageEntry {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as { type?: string; customType?: string };
  return candidate.type === "custom_message" && candidate.customType === customType;
}

/**
 * Decide whether a `custom_message` of the given customType should be
 * injected on this `before_agent_start`.
 *
 * Returns `true` when the active compaction-aware branch has no matching
 * message, or when its latest matching message is stale according to the
 * optional predicate. Looking only at the latest match makes A→B→A changes
 * reinject A instead of treating the older A as current.
 */
export function shouldInjectOnce(
  sessionManager: ActiveContextSession,
  customType: string,
  predicate: (entry: CustomMessageEntry) => boolean = () => true,
): boolean {
  const entries = sessionManager.buildContextEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (isLiveCustomMessageEntry(entry, customType)) return !predicate(entry);
  }
  return true;
}
