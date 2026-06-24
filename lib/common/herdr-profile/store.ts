/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared Herdr workflow-profile persistence.
 *
 * SF Herdr owns editing these managed preferences while other extensions may
 * consume the shared lane-planning types and helpers. The persisted file is
 * SF Pi-managed state, not a hand-edited Pi setting:
 *   <globalAgentDir>/sf-pi/herdr/preferences.json
 */
import { canonicalStatePath, createStateStore } from "../state-store.ts";
import {
  DEFAULT_SF_HERDR_PREFERENCES,
  clonePreferences,
  normalizePreferences,
} from "./defaults.ts";
import type { SfHerdrPreferences } from "./types.ts";

export * from "./types.ts";
export * from "./defaults.ts";
export * from "./planner.ts";

export const HERDR_PROFILE_NAMESPACE = "herdr";
export const HERDR_PROFILE_FILENAME = "preferences.json";
export const HERDR_PROFILE_SCHEMA_VERSION = 1;

export function herdrPreferencesPath(): string {
  return canonicalStatePath(HERDR_PROFILE_NAMESPACE, HERDR_PROFILE_FILENAME);
}

export function readSfHerdrPreferences(): SfHerdrPreferences {
  return normalizePreferences(store().read());
}

export function writeSfHerdrPreferences(preferences: SfHerdrPreferences): void {
  store().write(normalizePreferences(preferences));
}

export function updateSfHerdrPreferences(
  update: (current: SfHerdrPreferences) => SfHerdrPreferences,
): SfHerdrPreferences {
  return store().update((current) => normalizePreferences(update(normalizePreferences(current))));
}

function store() {
  return createStateStore<SfHerdrPreferences>({
    namespace: HERDR_PROFILE_NAMESPACE,
    filename: HERDR_PROFILE_FILENAME,
    schemaVersion: HERDR_PROFILE_SCHEMA_VERSION,
    defaults: clonePreferences(DEFAULT_SF_HERDR_PREFERENCES),
    migrate: (raw) => normalizePreferences(raw),
  });
}
