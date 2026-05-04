/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared data shapes for the sf-welcome extension.
 *
 * The splash screen pulls data from several sources. Keeping the shared types
 * in one small file helps both agents and humans understand the contracts
 * without opening every discovery module.
 */

export interface RecentSession {
  name: string;
  timeAgo: string;
}

export interface LoadedCounts {
  extensions: number;
  skills: number;
  promptTemplates: number;
}

export interface ExtensionHealthItem {
  name: string;
  status: "active" | "disabled" | "locked";
  icon: string;
}

export type SfCliFreshness = "checking" | "latest" | "update-available" | "unknown";

export interface SfCliStatusInfo {
  installed: boolean;
  installedVersion?: string;
  latestVersion?: string;
  freshness: SfCliFreshness;
  loading: boolean;
}

/** Install status shown in the splash's Recommendations block. */
export type RecommendationDisplayStatus = "installed" | "pending" | "declined";

/** Single recommended item shown in the splash's Recommendations block. */
export interface RecommendationStatusItem {
  id: string;
  name: string;
  status: RecommendationDisplayStatus;
}

/** Splash-facing payload for the Recommendations block. */
export interface RecommendationsStatusSummary {
  total: number;
  installedCount: number;
  pendingCount: number;
  declinedCount: number;
  items: RecommendationStatusItem[];
}

/** Splash-facing payload for the external-skill-sources nudge line.
 *  Populated only when at least one candidate root is detected but not
 *  yet wired into `~/.pi/agent/settings.json → skills[]`. */
export interface SkillSourcesNudge {
  availableCount: number;
  totalSkillCount: number;
}

export interface SplashData {
  modelName: string;
  providerName: string;
  loadedCounts: LoadedCounts;
  recentSessions: RecentSession[];
  extensionHealth: ExtensionHealthItem[];
  slackConnected: boolean;
  /** Current monthly spend in USD. Prefers the gateway's live value, falls back
   * to a best-effort estimate from local session files when the gateway is
   * unreachable or not the active provider. */
  monthlyCost: number;
  /** Monthly budget ceiling in USD. `null` means unlimited / ∞ (matches the
   * gateway bar's `$N/∞` display). */
  monthlyBudget: number | null;
  /** Origin of the monthly cost value — used for subtle display hints. */
  monthlyUsageSource?: "gateway" | "sessions";
  /** All-time cumulative spend in USD. Prefers the gateway's per-key lifetime
   * counter (`/key/info.spend`), falls back to a local session-file sum when
   * no gateway data is available (e.g. bring-your-own-keys users). */
  lifetimeCost: number;
  /** Origin of the lifetime cost value. 'gateway' = live per-key counter,
   * 'sessions' = local best-effort estimate clearly labeled as such. */
  lifetimeUsageSource?: "gateway" | "sessions";
  /** Install status for recommended external pi packages. Replaces the
   * legacy Salesforce AI block when any recommendations are defined. */
  recommendations?: RecommendationsStatusSummary;
  /** External skill-source directories detected on disk but not yet wired
   * into pi's global settings. Drives the `/sf-pi skills` nudge line
   * shown under the Recommended block. Undefined means no nudge. */
  skillSources?: SkillSourcesNudge;
  /** Lightweight SF CLI install/latest status populated asynchronously after initial render. */
  sfCli?: SfCliStatusInfo;
  /** Short summary of pi-coding-agent changes since the user's last splash.
   * Present only when there is something new to announce. */
  whatsNew?: WhatsNewSummary;
  /** Maintainer announcements and update nudges, sourced from
   * catalog/announcements.json (+ optional remote feed). Undefined when
   * the feature is disabled or there is nothing active to show. */
  announcements?: AnnouncementsSummary;
}

/** Compact render-ready entry used by the splash's Announcements panel. */
export interface AnnouncementLine {
  id: string;
  kind: "note" | "update" | "breaking" | "deprecation";
  severity: "info" | "warn" | "critical";
  title: string;
}

/** Splash-facing payload for the Announcements panel. */
export interface AnnouncementsSummary {
  /** Current manifest revision. Drives the nudge cursor. */
  revision: string;
  /** Total active items after filtering (visible list is capped). */
  totalActive: number;
  /** Ordered, capped items to render. */
  visible: AnnouncementLine[];
}

/** One-line distilled change sourced from the pi CHANGELOG. */
export interface WhatsNewBulletItem {
  text: string;
  section: "feature" | "fix";
}

/** Compact payload that drives the What's New splash panel. */
export interface WhatsNewSummary {
  fromVersion?: string;
  toVersion: string;
  bullets: WhatsNewBulletItem[];
}
