/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared data shapes for the sf-welcome extension.
 *
 * The splash screen pulls data from several sources. Keeping the shared types
 * in one small file helps both agents and humans understand the contracts
 * without opening every discovery module.
 */
import type {
  GatewayConnectionStatus,
  KeyConflictWarning,
} from "../../../lib/common/monthly-usage/store.ts";
import type { SlackStatusSnapshot } from "../../../lib/common/slack-status/store.ts";
import type { CodeAnalyzerReadinessState } from "../../../lib/common/code-analyzer-status/store.ts";
import type { AutoUpdateStatus } from "../../../lib/common/auto-update/store.ts";
import type { BrowserRuntimeStatusInfo } from "../../../lib/common/browser-runtime-status/store.ts";
import type { GlyphMode } from "../../../lib/common/glyph-policy.ts";

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
  checkSkipped?: boolean;
  skipReason?: "offline" | "version-check-disabled";
}

export type ReleaseFreshness = "checking" | "latest" | "update-available" | "unknown";

export interface ReleaseStatusInfo {
  installedVersion?: string;
  latestVersion?: string;
  /** Absolute upstream latest when `latestVersion` is policy-constrained. */
  absoluteLatestVersion?: string;
  /** Newest release currently allowed by the user's package-manager policy. */
  policyVisibleLatestVersion?: string;
  /** True when a release-age policy is hiding a newer absolute Pi release. */
  cooldownActive?: boolean;
  /** True when SF Pi's audited runtime ceiling hides a newer upstream release. */
  supportWindowLimited?: boolean;
  freshness: ReleaseFreshness;
  loading: boolean;
  /** Optional command shown as a muted hint when freshness is update-available. */
  updateCommand?: string;
  /** True when the caller deliberately skipped the live latest check. */
  checkSkipped?: boolean;
  skipReason?: "offline" | "version-check-disabled";
}

/**
 * How the official forcedotcom/afv-library skills repo is available to the
 * current pi install.
 *
 *   managed       — cloned + sentinel-marked by `/sf-skills defaults install`
 *   linked        — user-owned checkout wired via `/sf-skills defaults link`
 *   not-installed — no afv-library entry found in either scope
 */
export type SfSkillsInstallKind = "managed" | "linked" | "not-installed";

/** Same vocabulary as SfCliFreshness so the splash row reads symmetrically. */
export type SfSkillsFreshness = "checking" | "latest" | "update-available" | "unknown";

export interface SfSkillsStatusInfo {
  installKind: SfSkillsInstallKind;
  /** Scope of the install or current-session wiring — "global" or "project". Undefined when not installed. */
  scope?: "global" | "project";
  /** For managed sources, whether the current global/project Skill Gate wires the source. */
  wired?: boolean;
  /** Absolute path to the skills/ dir. Undefined when not installed. */
  skillsPath?: string;
  /** Absolute path to the repo root. Undefined when not installed. */
  rootPath?: string;
  /** Local commit SHA (full or abbreviated) read from .git/HEAD. */
  localSha?: string;
  /** Latest upstream main commit SHA from GitHub. */
  remoteSha?: string;
  /** Number of commits the local clone is behind upstream main, when we
   *  could compute it via the GitHub compare endpoint. */
  commitsBehind?: number;
  /** Number of skill subdirs under <skillsPath>/ (each with a SKILL.md). */
  skillCount?: number;
  freshness: SfSkillsFreshness;
  loading: boolean;
  checkSkipped?: boolean;
  skipReason?: "offline" | "version-check-disabled";
}

/** Startup-safe status for Node's custom CA bundle wiring. */
export type NodeCertStatusKind =
  "checking" | "verified" | "installed" | "found" | "not-configured" | "invalid" | "unknown";

export type NodeCertStatusSource =
  "env" | "launch-agent" | "shell" | "fixer" | "candidate" | "probe";

export interface NodeCertStatusInfo {
  kind: NodeCertStatusKind;
  source?: NodeCertStatusSource;
  /** Absolute local path when one is known. Renderers intentionally avoid
   *  showing this on the splash; it is kept for diagnostics and cache reuse. */
  path?: string;
  /** Short reason for invalid / unknown states. */
  reason?: string;
  loading: boolean;
}

export type NodeRuntimeStatusKind = "supported" | "unsupported" | "unknown";

export interface NodeRuntimeStatusInfo {
  kind: NodeRuntimeStatusKind;
  version: string;
  requiredVersion: string;
  loading: boolean;
}

export type HerdrRuntimeStatusKind =
  "ready" | "tool-only" | "installed-not-active" | "missing" | "disabled";

export type HerdrPiIntegrationStatusKind = "installed" | "missing" | "unknown";

export interface HerdrPiIntegrationStatusInfo {
  kind: HerdrPiIntegrationStatusKind;
  path: string;
  version?: number;
  reason?: string;
  loading: boolean;
}

export interface HerdrRuntimeStatusInfo {
  kind: HerdrRuntimeStatusKind;
  extensionEnabled: boolean;
  toolActive: boolean;
  packageInstalled: boolean;
  activeControlEnv: boolean;
  passiveStatusBridge: boolean;
  piIntegration: HerdrPiIntegrationStatusInfo;
  paneId?: string;
  loading: boolean;
}

export type FontRuntimeStatusKind =
  "checking" | "installed" | "missing" | "unsupported" | "unknown";

export interface FontRuntimeStatusInfo {
  kind: FontRuntimeStatusKind;
  fontFamily: string;
  glyphMode: GlyphMode;
  supportedPlatform: boolean;
  installed: boolean;
  loading: boolean;
  checkedAt?: string;
}

export interface HunkStatusInfo {
  installed: boolean;
  command?: "hunk" | "hunkdiff";
  installedVersion?: string;
  loading: boolean;
  checkedAt?: string;
}

export type HomebrewStatusKind = "checking" | "installed" | "missing" | "unknown";

export interface HomebrewStatusInfo {
  kind: HomebrewStatusKind;
  version?: string;
  prefix?: string;
  loading: boolean;
  checkedAt?: string;
  platform?: string;
}

export interface AutoUpdateStatusInfo {
  enabled: boolean;
  status: AutoUpdateStatus;
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

export interface DoctorNudgeSummary {
  issueCount: number;
  message: string;
  command: string;
}

/**
 * Splash-facing payload for the corporate-CA-bundle nudge.
 *
 * Populated only when the gateway extension is enabled, the most recent
 * doctor run flagged a TLS-class failure on macOS, and no fix has been
 * applied yet. Drives a single muted row under the gateway status line
 * pointing at `/sf-llm-gateway fix-ca-bundle`.
 *
 * Public-safe: this UI surface lives in sf-welcome (shared) but is
 * gated by `isSfPiExtensionEnabled("sf-llm-gateway-internal")` so it
 * never renders for users who have the internal-only extension off.
 */
export interface CaBundleNudgeSummary {
  /** Slash command the user should run. Always `/sf-llm-gateway fix-ca-bundle`. */
  command: string;
  /** Short prose surfaced in the splash row. */
  message: string;
}

/** Compact splash payload for the Privacy row.
 *  Computed from lib/common/privacy/state.ts at every collect call. */
export interface PrivacyStatusSummary {
  /** True when pi will currently send the anonymous install/update ping. */
  telemetryEnabled: boolean;
  /** Where the current value comes from. Drives the row label and color. */
  source: "sf-pi-default" | "user-override" | "unset";
}

export interface SplashData {
  modelName: string;
  providerName: string;
  loadedCounts: LoadedCounts;
  recentSessions: RecentSession[];
  extensionHealth: ExtensionHealthItem[];
  slackConnected: boolean;
  slackVisible?: boolean;
  slackStatus?: SlackStatusSnapshot | null;
  /** Current monthly spend in USD. Prefers the gateway's live value, falls back
   * to a best-effort estimate from local session files when the gateway is
   * unreachable or not the active provider. */
  monthlyCost: number;
  /** Monthly budget ceiling in USD. `null` means unlimited / ∞ (matches the
   * gateway bar's `$N/∞` display). */
  monthlyBudget: number | null;
  /** Origin of the monthly cost value — used for subtle display hints. */
  monthlyUsageSource?: "gateway" | "sessions";
  /** True when the optional gateway integration should be surfaced. */
  gatewayVisible?: boolean;
  /** Live gateway connection status from an auth-gated read-only probe. */
  gatewayStatus?: GatewayConnectionStatus | null;
  /** True while gateway status is being checked. */
  gatewayLoading?: boolean;
  /** Optional cross-source key-conflict warning surfaced under the gateway
   * row. Phase 1.6: present when env and saved API keys both exist and
   * differ. UIs render once per session as a passive nudge — not blocking. */
  gatewayKeyConflict?: KeyConflictWarning | null;
  /** Install status for recommended external pi packages. Replaces the
   * legacy Salesforce AI block when any recommendations are defined. */
  recommendations?: RecommendationsStatusSummary;
  /** External skill-source directories detected on disk but not yet wired
   * into pi's global settings. Drives the `/sf-pi skills` nudge line
   * shown under the Recommended block. Undefined means no nudge. */
  skillSources?: SkillSourcesNudge;
  /** Startup/setup issues detected by sf-pi doctor. When present, the
   * welcome screen nudges the user toward `/sf-pi doctor` and safe-start
   * mode avoids the blocking overlay. */
  doctor?: DoctorNudgeSummary;
  /** Corporate CA bundle nudge for macOS users hitting NODE_EXTRA_CA_CERTS
   *  failures. Computed synchronously from cached gateway probe state +
   *  fixer-applied state. Undefined when the extension is disabled, the
   *  doctor passed, the fix is already applied, or the user is on a
   *  non-darwin platform. Only renders one row — no live probing on the
   *  splash hot path. */
  caBundleNudge?: CaBundleNudgeSummary;
  /** Telemetry posture (sf-pi default opts users out of pi's anonymous
   *  install/update ping). Always present after the first collect. */
  privacy?: PrivacyStatusSummary;
  /** True while the first full filesystem/settings hydration pass is pending. */
  loading?: boolean;
  /** True while Slack auth status is still being checked. */
  slackLoading?: boolean;
  /** True while extension health has not been hydrated yet. */
  extensionHealthLoading?: boolean;
  /** True while loaded extension/skill/prompt counts have not been hydrated yet. */
  loadedCountsLoading?: boolean;
  /** True while recent sessions have not been hydrated yet. */
  recentSessionsLoading?: boolean;
  /** Lightweight SF CLI install/latest status populated asynchronously after initial render. */
  sfCli?: SfCliStatusInfo;
  /** Current Node.js runtime support status. Pure process-local read. */
  nodeRuntime?: NodeRuntimeStatusInfo;
  /** Upstream Herdr pane-control runtime status; distinct from sf-herdr being enabled. */
  herdrRuntime?: HerdrRuntimeStatusInfo;
  /** Bundled Nerd Font / glyph fallback status. Cache-first then local-only refresh. */
  fontRuntime?: FontRuntimeStatusInfo;
  /** Optional Hunk diff-review tool readiness. Cache-first; no integration implied. */
  hunk?: HunkStatusInfo;
  /** Optional Homebrew package-manager readiness. Cache-first; no update/doctor runs. */
  homebrew?: HomebrewStatusInfo;
  /** Native Auto Update setting/status. Cache-only in the splash. */
  autoUpdate?: AutoUpdateStatusInfo;
  /** External agent-browser runtime install/freshness status used by SF Browser. */
  browserRuntime?: BrowserRuntimeStatusInfo;
  /** Lightweight forcedotcom/afv-library install + freshness status
   *  populated asynchronously after initial render. Mirrors the sfCli
   *  cache-first → deferred-refresh pattern; never blocks startup. */
  sfSkills?: SfSkillsStatusInfo;
  /** sf-pi package release freshness. Local/cache-only at startup; live
   *  freshness piggybacks on the deferred announcements refresh. */
  sfPiRelease?: ReleaseStatusInfo;
  /** Pi runtime release freshness. Local/cache-only at startup, then
   *  refreshed by a deferred bounded fetch that respects Pi's offline flags. */
  piRelease?: ReleaseStatusInfo;
  /** Cached Code Analyzer readiness. Read-only at startup; refreshed by sf-code-analyzer. */
  codeAnalyzer?: CodeAnalyzerReadinessState;
  /** Node custom-CA status populated cache-first, then refreshed on a
   *  deferred timer. Never performs a live TLS probe during startup. */
  nodeCert?: NodeCertStatusInfo;
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
