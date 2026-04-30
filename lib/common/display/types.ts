/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared display contracts for sf-pi extensions.
 *
 * These types keep agent-facing tool content, renderer metadata, and user
 * display profiles aligned across independently loaded extensions.
 */

export const SF_PI_DISPLAY_PROFILES = ["compact", "balanced", "verbose"] as const;

export type SfPiDisplayProfile = (typeof SF_PI_DISPLAY_PROFILES)[number];

export interface SfPiDisplaySettings {
  profile: SfPiDisplayProfile;
}

export const DEFAULT_SF_PI_DISPLAY_SETTINGS: SfPiDisplaySettings = {
  profile: "balanced",
};

export interface SfPiRenderHints {
  /** Short status line for collapsed renderers. */
  summary?: string;
  /** Suggested collapsed preview line budget. */
  collapsedLines?: number;
  /** Suggested expanded preview line cap. Zero means uncapped. */
  expandedMaxLines?: number;
  /** Whether the renderer should prefer a compact, balanced, or verbose view. */
  profile?: SfPiDisplayProfile;
}

export interface SfPiTruncationMetadata {
  truncated: boolean;
  outputLines?: number;
  totalLines?: number;
  outputBytes?: number;
  totalBytes?: number;
  fullOutputPath?: string;
}

/**
 * Recommended details envelope for sf-pi custom tools.
 *
 * `content` remains concise and model-relevant. Renderers and follow-on UI read
 * this structured payload from `details.sfPi` when richer display is useful.
 */
export interface SfPiToolResultEnvelope<TData = unknown> {
  ok: boolean;
  action?: string;
  summary?: string;
  data?: TData;
  renderHints?: SfPiRenderHints;
  truncation?: SfPiTruncationMetadata;
}

export function isSfPiDisplayProfile(value: unknown): value is SfPiDisplayProfile {
  return SF_PI_DISPLAY_PROFILES.includes(value as SfPiDisplayProfile);
}

export function normalizeSfPiDisplayProfile(value: unknown): SfPiDisplayProfile {
  return isSfPiDisplayProfile(value) ? value : DEFAULT_SF_PI_DISPLAY_SETTINGS.profile;
}

export function normalizeSfPiDisplaySettings(value: unknown): SfPiDisplaySettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_SF_PI_DISPLAY_SETTINGS };
  }

  const record = value as { profile?: unknown };
  return {
    profile: normalizeSfPiDisplayProfile(record.profile),
  };
}

/** Display profile → conservative collapsed preview budget. */
export function previewLinesForDisplayProfile(profile: SfPiDisplayProfile): number {
  switch (profile) {
    case "compact":
      return 4;
    case "verbose":
      return 20;
    case "balanced":
    default:
      return 8;
  }
}
