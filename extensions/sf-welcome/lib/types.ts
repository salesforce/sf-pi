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

export interface SfEnvironmentInfo {
  cliInstalled: boolean;
  cliVersion?: string;
  defaultOrg?: string;
  orgType?: string;
  connected?: boolean;
  instanceUrl?: string;
  apiVersion?: string;
  configScope?: string;
  detectedAt?: number;
  source?: "cached" | "live";
  refreshing?: boolean;
  loading: boolean;
}

/** Tip entry for the right-column quick-help list. */
export interface TipItem {
  command: string;
  description: string;
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
  /** Tips shown in the right column. Derived from active sf-pi extensions. */
  tips?: TipItem[];
  /** Populated asynchronously after initial render. */
  sfEnvironment?: SfEnvironmentInfo;
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
