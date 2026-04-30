/* SPDX-License-Identifier: Apache-2.0 */
/**
 * User preferences for sf-slack.
 *
 * Persisted via `pi.appendEntry(PREFS_ENTRY_TYPE, ...)` so they survive reloads
 * and respect branch navigation (same pattern as examples/tools.ts).
 *
 * Why in-memory plus entry-log?
 *   - renderCall / renderResult run outside the tool's execute() context and
 *     cannot await any async store. They need synchronous access.
 *   - Reading from the session branch on each render would be wasteful.
 *
 * So index.ts reconstructs prefs on session_start / session_tree and mutates
 * the single in-memory record exported here. All readers are sync.
 */

export type FieldsMode = "summary" | "preview" | "full";
export type DefaultFieldsMode = "auto" | FieldsMode;
export type OnOff = "on" | "off";
/** Body-detail level for thread/history ladders in the tool-result TUI. */
export type ThreadBodyMode = "full" | "preview";

/** Preference record shape. Kept flat so SettingsList rows map 1:1. */
export interface SlackPreferences {
  /** Default body-detail level for slack search/thread/history when the LLM
   *  does not pass an explicit `fields` argument. */
  defaultFields: DefaultFieldsMode;
  /** Whether to show the research-activity summary widget above the editor. */
  showWidget: OnOff;
  /** Whether to render permalinks in the TUI as short OSC 8 hyperlinks. */
  compactPermalinks: OnOff;
  /** How thread/history tool-result bodies render in the TUI.
   *  - `full`: always render each reply in full; the pi harness `expanded`
   *    flag is effectively ignored for these paths. Best when the LLM is
   *    reading a handful of messages and full context matters.
   *  - `preview`: clip each body to ~110 chars with an ellipsis; the
   *    original pre-0.5.3 behavior. Useful when screen real estate is
   *    tight or a thread has many replies.
   *  Search-result bodies are always clipped regardless of this setting
   *  because search is a results list, not a conversation. */
  threadBodies: ThreadBodyMode;
}

/** customType used with `pi.appendEntry` for persistence. */
export const PREFS_ENTRY_TYPE = "sf-slack-prefs";

export const DEFAULT_PREFERENCES: SlackPreferences = {
  // "auto" follows the shared /sf-pi display profile: compact → summary,
  // balanced → preview, verbose → full. Balanced preserves the old default.
  defaultFields: "auto",
  showWidget: "on",
  compactPermalinks: "on",
  // Default to full-fidelity conversations in the TUI. Users who preferred
  // the terse 110-char clip can flip this back to "preview" via settings.
  threadBodies: "full",
};

// ─── In-memory singleton ────────────────────────────────────────────────────────

let current: SlackPreferences = { ...DEFAULT_PREFERENCES };

/** Synchronous read. Safe from render.ts / format.ts. */
export function getPreferences(): SlackPreferences {
  return current;
}

/** Overwrite the in-memory record. Intended for index.ts after reading the
 *  latest entry from the session branch. */
export function setPreferences(next: Partial<SlackPreferences>): SlackPreferences {
  current = sanitize({ ...current, ...next });
  return current;
}

/** Hard reset to defaults — used by tests. */
export function resetPreferences(): SlackPreferences {
  current = { ...DEFAULT_PREFERENCES };
  return current;
}

// ─── Validation ────────────────────────────────────────────────────────────────

const FIELDS: readonly DefaultFieldsMode[] = ["auto", "summary", "preview", "full"] as const;
const ON_OFF: readonly OnOff[] = ["on", "off"] as const;
const THREAD_BODIES: readonly ThreadBodyMode[] = ["full", "preview"] as const;

/** Clamp any unknown stored values back to defaults so reload from an older
 *  prefs entry can't poison the rest of the extension. */
export function sanitize(input: Partial<SlackPreferences>): SlackPreferences {
  return {
    defaultFields: FIELDS.includes(input.defaultFields as DefaultFieldsMode)
      ? (input.defaultFields as DefaultFieldsMode)
      : DEFAULT_PREFERENCES.defaultFields,
    showWidget: ON_OFF.includes(input.showWidget as OnOff)
      ? (input.showWidget as OnOff)
      : DEFAULT_PREFERENCES.showWidget,
    compactPermalinks: ON_OFF.includes(input.compactPermalinks as OnOff)
      ? (input.compactPermalinks as OnOff)
      : DEFAULT_PREFERENCES.compactPermalinks,
    threadBodies: THREAD_BODIES.includes(input.threadBodies as ThreadBodyMode)
      ? (input.threadBodies as ThreadBodyMode)
      : DEFAULT_PREFERENCES.threadBodies,
  };
}
