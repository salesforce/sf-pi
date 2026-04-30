/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared types for the sf-pi extension registry.
 *
 * Hand-maintained. The generated registry.ts re-exports these types.
 */
import type { Focusable } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";

// -------------------------------------------------------------------------------------------------
// Config panel protocol
// -------------------------------------------------------------------------------------------------

/**
 * A config panel is a Focusable component that an extension provides for
 * drill-down configuration inside the sf-pi Extension Manager overlay.
 *
 * The panel renders its own content rows (no border box — the host draws that).
 * It receives input when focused and calls `done()` when the user is finished.
 *
 * Panels that need to signal a reload (e.g. after enabling/disabling a provider)
 * return `{ needsReload: true }` via the done callback.
 */
export type ConfigPanelResult = {
  needsReload?: boolean;
};

export type ConfigPanelFactory = (
  theme: Theme,
  cwd: string,
  scope: "global" | "project",
  done: (result: ConfigPanelResult | undefined) => void,
) => Focusable;

// -------------------------------------------------------------------------------------------------
// Extension definition
// -------------------------------------------------------------------------------------------------

export interface SfPiExtension {
  /** Unique slug used in commands (e.g., "sf-ohana-spinner"). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** One-line description shown in the TUI and /sf-pi list. */
  description: string;
  /** Relative path from package root (e.g., "extensions/sf-ohana-spinner/index.ts"). */
  file: string;
  /** Category tag for grouping in the UI. */
  category: "ui" | "provider" | "core";
  /** Whether this extension is enabled on first install. */
  defaultEnabled: boolean;
  /** If true, cannot be disabled (used for the manager itself). */
  alwaysActive?: boolean;
  /** If true, this extension has a config panel accessible via Enter in the manager overlay. */
  configurable?: boolean;
  /** Slash commands exposed by this extension (e.g. "/sf-slack"). */
  commands?: string[];
  /** Auth/providers registered by this extension. */
  providers?: string[];
  /** Tool names registered by this extension. */
  tools?: string[];
  /** Pi runtime events observed by this extension. */
  events?: string[];
  /** Lazy factory for the config panel component. Only defined when configurable is true. */
  getConfigPanel?: () => Promise<ConfigPanelFactory>;
}

// -------------------------------------------------------------------------------------------------
// Manifest schema (matches extensions/*/manifest.json)
// -------------------------------------------------------------------------------------------------

export interface ExtensionManifest {
  id: string;
  name: string;
  description: string;
  category: "ui" | "provider" | "core";
  defaultEnabled: boolean;
  alwaysActive?: boolean;
  configurable?: boolean;
  commands?: string[];
  providers?: string[];
  tools?: string[];
  events?: string[];
}

// -------------------------------------------------------------------------------------------------
// Recommended external packages
// -------------------------------------------------------------------------------------------------

/**
 * Licenses allowed in catalog/recommendations.json.
 *
 * sf-pi only *recommends* external packages; it does not redistribute them.
 * Even so, we keep the allow-list to permissive OSI licenses so the project
 * stays easy to reason about for downstream users. Update this list + the
 * matching check in scripts/generate-catalog.mjs together.
 */
export const ALLOWED_RECOMMENDED_LICENSES = [
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
] as const;

export type AllowedRecommendedLicense = (typeof ALLOWED_RECOMMENDED_LICENSES)[number];

/**
 * A single recommended external pi package.
 *
 * `id` is an sf-pi-local stable slug (independent of the upstream source URL)
 * so we can swap the upstream without invalidating user state.
 */
export interface RecommendedItem {
  /** Stable sf-pi-local id, e.g. "pi-web-access". */
  id: string;
  /** Human-readable name shown in the overlay. */
  name: string;
  /** Short description — one line. */
  description: string;
  /** pi-install source, e.g. "git:github.com/user/repo" or "npm:@scope/pkg". */
  source: string;
  /** Homepage for attribution and docs. */
  homepage: string;
  /** SPDX license identifier — must be in ALLOWED_RECOMMENDED_LICENSES. */
  license: AllowedRecommendedLicense;
  /** Why the sf-pi team recommends this. Shown in the overlay. */
  rationale: string;
  /** Default install scope when the user accepts. */
  scope?: "global" | "project";
}

/**
 * A curated bundle of recommended items, grouped for quick opt-in.
 * `defaultOnFirstRun: true` bundles surface in the first-run nudge.
 */
export interface RecommendationBundle {
  id: string;
  name: string;
  description: string;
  defaultOnFirstRun: boolean;
  items: string[];
}

/**
 * Shape of catalog/recommendations.json.
 *
 * `revision` is the nudge cursor. Bumping it re-arms the one-time
 * notification for users whose acknowledgedRevision is older. Items the
 * user already installed or declined stay sticky across revisions.
 */
export interface RecommendationsManifest {
  schemaVersion: 1;
  revision: string;
  bundles: RecommendationBundle[];
  items: Record<string, RecommendedItem>;
}

// -------------------------------------------------------------------------------------------------
// Announcements (ships-with-release + optional remote feed)
// -------------------------------------------------------------------------------------------------

/**
 * Classification for rendering (icon + color). `update` is the
 * synthetic announcement we inject when the installed sf-pi version is
 * behind `latestVersion`.
 */
export type AnnouncementKind = "note" | "update" | "breaking" | "deprecation";

/** Visual severity — drives the accent color on the splash panel. */
export type AnnouncementSeverity = "info" | "warn" | "critical";

/**
 * A single maintainer announcement.
 *
 * `id` must be sticky across manifest revisions so once a user dismisses
 * an announcement it stays dismissed. Bumping the manifest `revision`
 * re-arms the footer nudge but does NOT resurface already-dismissed ids.
 */
export interface AnnouncementItem {
  /** Stable, human-readable slug (e.g. "2026-04-tdx-livestream"). */
  id: string;
  /** Classification used for icon + color. */
  kind: AnnouncementKind;
  /** One-line title shown as the panel entry. */
  title: string;
  /** Optional longer body shown in `/sf-pi announcements`. */
  body?: string;
  /** Optional link (docs, release, livestream, etc.). */
  link?: string;
  /** ISO timestamp — when the announcement was published. */
  publishedAt?: string;
  /** ISO timestamp — hide automatically past this date, even if not dismissed. */
  expiresAt?: string;
  /** Visual severity. Defaults to "info". */
  severity?: AnnouncementSeverity;
  /** Only show to installs >= this version. */
  minVersion?: string;
  /** Only show to installs <= this version (e.g. deprecation notices). */
  maxVersion?: string;
}

/**
 * Shape of catalog/announcements.json.
 *
 * `revision` is the nudge cursor (same pattern as recommendations).
 * `latestVersion` / `feedUrl` are optional hooks for the update-nudge and
 * the optional remote feed merge — both are safe to omit.
 */
export interface AnnouncementsManifest {
  schemaVersion: 1;
  revision: string;
  /** Latest sf-pi release known to this manifest. Drives the update nudge
   * when it exceeds the installed version. */
  latestVersion?: string;
  /** Optional hosted JSON feed. Omit to disable network entirely. */
  feedUrl?: string;
  announcements: AnnouncementItem[];
}
