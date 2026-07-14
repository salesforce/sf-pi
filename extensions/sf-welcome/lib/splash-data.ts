/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Aggregate data discovery for the sf-welcome splash screen.
 *
 * Responsibility split:
 * - this file orchestrates the splash payload
 * - session-data.ts owns session scanning and cost estimation
 * - extension-health.ts owns sf-pi registry + settings state
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir as osHomedir } from "node:os";
import {
  globalAgentPath,
  globalSettingsPath,
  projectConfigPath,
  projectSettingsPath,
} from "../../../lib/common/pi-paths.ts";
import { discoverExtensionHealth } from "./extension-health.ts";
import { estimateMonthlyCost, getRecentSessions } from "./session-data.ts";
import { getMonthlyUsageState } from "../../../lib/common/monthly-usage/store.ts";
import { getSlackStatus } from "../../../lib/common/slack-status/store.ts";
import { isSfPiExtensionEnabled } from "../../../lib/common/sf-pi-extension-state.ts";
import {
  buildAnnouncementsSync,
  refreshAnnouncements,
} from "../../../lib/common/catalog-state/announcements-orchestrator.ts";
import { collectRecommendationsStatus } from "./recommendations-status.ts";
import { collectCaBundleNudge } from "./ca-bundle-nudge.ts";
import { readCachedNodeCertStatus } from "./node-cert-cache.ts";
import { collectInitialPiReleaseStatus, detectSfPiReleaseStatus } from "./release-status.ts";
import { summarizeAvailableSkillSources } from "../../../lib/common/skill-sources/skill-sources.ts";
import { readCodeAnalyzerReadiness } from "../../../lib/common/code-analyzer-status/store.ts";
import { getTelemetryState } from "../../../lib/common/privacy/state.ts";
import { isNodeRuntimeSupported, NODE_RUNTIME_FLOOR } from "../../../lib/common/runtime-floor.ts";
import {
  readAutoUpdateEnabled,
  readAutoUpdateStatus,
} from "../../../lib/common/auto-update/store.ts";
import {
  defaultBrowserRuntimeStatus,
  readCachedBrowserRuntimeStatus,
} from "../../../lib/common/browser-runtime-status/store.ts";
import { defaultFontRuntimeStatus, readCachedFontRuntimeStatus } from "./font-status-cache.ts";
import { defaultHunkStatus, readCachedHunkStatus } from "./hunk-status.ts";
import { defaultHomebrewStatus, readCachedHomebrewStatus } from "./homebrew-status.ts";
import { collectHerdrRuntimeStatus } from "./herdr-runtime-status.ts";
import {
  runDoctorDiagnostics,
  summarizeStartupDoctorNudge,
} from "../../../lib/common/doctor/diagnostics.ts";
// Only the types actually referenced in this module's function bodies are
// imported here; the rest are re-exported for convenience via the
// `export type` block below, which does not require a local import.
import type {
  AnnouncementsSummary,
  DoctorNudgeSummary,
  LoadedCounts,
  NodeRuntimeStatusInfo,
  AutoUpdateStatusInfo,
  PrivacyStatusSummary,
  SplashData,
} from "./types.ts";

export type {
  AnnouncementLine,
  AnnouncementsSummary,
  LoadedCounts,
  SfCliStatusInfo,
  ReleaseStatusInfo,
  ReleaseFreshness,
  SfSkillsStatusInfo,
  SfSkillsInstallKind,
  SfSkillsFreshness,
  NodeCertStatusInfo,
  NodeCertStatusKind,
  NodeCertStatusSource,
  NodeRuntimeStatusInfo,
  HerdrRuntimeStatusInfo,
  FontRuntimeStatusInfo,
  HunkStatusInfo,
  HomebrewStatusInfo,
  AutoUpdateStatusInfo,
  SplashData,
  RecentSession,
  ExtensionHealthItem,
  RecommendationsStatusSummary,
  RecommendationStatusItem,
  RecommendationDisplayStatus,
} from "./types.ts";
export { discoverExtensionHealth } from "./extension-health.ts";
export {
  detectSfCliStatus,
  isVersionCurrent,
  parseSfCliVersion,
  readCachedSfCliStatus,
  writeCachedSfCliStatus,
} from "./sf-cli-status.ts";
export {
  detectSfSkillsStatus,
  detectInstallStateLocal,
  detectManagedSourceAvailabilityLocal,
  fetchUpstreamCompare,
  readCachedSfSkillsStatus,
  reconcileCachedSfSkillsStatus,
  writeCachedSfSkillsStatus,
} from "./sf-skills-status.ts";
export { readCachedNodeCertStatus, writeCachedNodeCertStatus } from "./node-cert-cache.ts";
export {
  collectInitialPiReleaseStatus,
  detectPiReleaseStatus,
  detectSfPiReleaseStatus,
  fetchLatestPiVersion,
  readCachedPiReleaseStatus,
  writeCachedPiReleaseStatus,
} from "./release-status.ts";
export { estimateMonthlyCost, getRecentSessions } from "./session-data.ts";
export {
  buildAnnouncementsSync,
  refreshAnnouncements,
  MAX_VISIBLE_ANNOUNCEMENTS,
} from "../../../lib/common/catalog-state/announcements-orchestrator.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Loaded counts discovery
// ═══════════════════════════════════════════════════════════════════════════

export function discoverLoadedCounts(cwd: string): LoadedCounts {
  const homeDir = process.env.HOME || process.env.USERPROFILE || osHomedir();

  let extensions = 0;
  let skills = 0;
  let promptTemplates = 0;

  const extensionDirs = [globalAgentPath("extensions"), projectConfigPath(cwd, "extensions")];
  const countedExtensions = new Set<string>();

  const settingsPaths = [globalSettingsPath(), projectSettingsPath(cwd)];

  // Count installed npm packages listed in settings.json.
  for (const settingsPath of settingsPaths) {
    if (!existsSync(settingsPath)) continue;
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
        packages?: Array<string | { source?: string }>;
      };
      const packages = Array.isArray(settings.packages) ? settings.packages : [];
      for (const pkg of packages) {
        const source = typeof pkg === "string" ? pkg : pkg?.source;
        if (typeof source !== "string") continue;
        const normalized = source.trim();
        if (!normalized.startsWith("npm:")) continue;
        const body = normalized.slice(4);
        const versionIndex = body.lastIndexOf("@");
        const name = versionIndex > 0 ? body.slice(0, versionIndex) : body;
        if (name && !countedExtensions.has(name)) {
          countedExtensions.add(name);
          extensions++;
        }
      }
    } catch {
      // Ignore malformed settings entries and keep best-effort counts.
    }
  }

  // Count file-based extensions installed in Pi extension directories.
  for (const dir of extensionDirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        try {
          const stats = statSync(entryPath);
          if (stats.isDirectory()) {
            if (
              existsSync(join(entryPath, "index.ts")) ||
              existsSync(join(entryPath, "index.js")) ||
              existsSync(join(entryPath, "package.json"))
            ) {
              if (!countedExtensions.has(entry)) {
                countedExtensions.add(entry);
                extensions++;
              }
            }
          } else if ((entry.endsWith(".ts") || entry.endsWith(".js")) && !entry.startsWith(".")) {
            const ext = entry.endsWith(".ts") ? ".ts" : ".js";
            const name = basename(entry, ext);
            if (!countedExtensions.has(name)) {
              countedExtensions.add(name);
              extensions++;
            }
          }
        } catch {
          // Ignore unreadable entries.
        }
      }
    } catch {
      // Ignore unreadable directories.
    }
  }

  const skillDirs = [
    globalAgentPath("skills"),
    join(homeDir, ".claude", "skills"),
    projectConfigPath(cwd, "skills"),
    join(cwd, "skills"),
  ];

  const countedSkills = new Set<string>();
  for (const dir of skillDirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        try {
          if (statSync(entryPath).isDirectory() && existsSync(join(entryPath, "SKILL.md"))) {
            if (!countedSkills.has(entry)) {
              countedSkills.add(entry);
              skills++;
            }
          }
        } catch {
          // Ignore unreadable skill entries.
        }
      }
    } catch {
      // Ignore unreadable skill directories.
    }
  }

  const templateDirs = [
    globalAgentPath("commands"),
    join(homeDir, ".claude", "commands"),
    projectConfigPath(cwd, "commands"),
    join(cwd, ".claude", "commands"),
  ];

  const countedTemplates = new Set<string>();

  function countTemplatesInDir(dir: string) {
    if (!existsSync(dir)) return;
    try {
      for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        try {
          const stats = statSync(entryPath);
          if (stats.isDirectory()) {
            countTemplatesInDir(entryPath);
          } else if (entry.endsWith(".md")) {
            const name = basename(entry, ".md");
            if (!countedTemplates.has(name)) {
              countedTemplates.add(name);
              promptTemplates++;
            }
          }
        } catch {
          // Ignore unreadable files.
        }
      }
    } catch {
      // Ignore unreadable directories.
    }
  }

  for (const dir of templateDirs) {
    countTemplatesInDir(dir);
  }

  return { extensions, skills, promptTemplates };
}

// ═══════════════════════════════════════════════════════════════════════════
// Optional integration visibility/status
// ═══════════════════════════════════════════════════════════════════════════

export function checkSlackConnection(cwd?: string): boolean {
  if (cwd && !isSfPiExtensionEnabled(cwd, "sf-slack")) return false;
  return getSlackStatus().kind === "ready";
}

function shouldShowSlackStatus(cwd: string): boolean {
  if (!isSfPiExtensionEnabled(cwd, "sf-slack")) return false;
  const status = getSlackStatus();
  return status.kind !== "hidden" && status.kind !== "not-configured";
}

function shouldShowGatewayStatus(cwd: string, modelName: string, providerName: string): boolean {
  if (!isSfPiExtensionEnabled(cwd, "sf-llm-gateway-internal")) return false;
  const activeGateway =
    providerName.toLowerCase().includes("gateway") || modelName.toLowerCase().includes("gateway");
  const gatewayState = getMonthlyUsageState();
  const status = gatewayState.connectionStatus;
  if (activeGateway) return true;
  if (gatewayState.monthlyUsage) return true;
  return !!status && status.kind !== "checking" && status.kind !== "not-configured";
}

// ═══════════════════════════════════════════════════════════════════════════
// Aggregate data collection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the monthly-usage payload shown on the splash.
 *
 * Prefers the gateway's live numbers (same source as the bottom bar) so the
 * splash and footer never disagree. Local session estimates are opt-in for
 * callers that explicitly need them; the splash hides usage for non-gateway
 * users to keep the startup surface compact.
 */
export function resolveMonthlyUsage(
  monthlyBudgetFallback: number = 3000,
  options: { includeSessionFallback?: boolean } = {},
): {
  monthlyCost: number;
  monthlyBudget: number | null;
  monthlyUsageSource: "gateway" | "sessions";
} {
  const gatewayState = getMonthlyUsageState();
  // Narrow once so TS proves non-undefined without a non-null assertion.
  const gatewayUsage = gatewayState.monthlyUsage;
  const usesGateway = !!gatewayUsage;
  const includeSessionFallback = options.includeSessionFallback !== false;
  const monthlyCost = gatewayUsage
    ? gatewayUsage.spend
    : includeSessionFallback
      ? estimateMonthlyCost()
      : 0;
  // Gateway budgets with no ceiling come through as 0 or a sentinel value.
  // Treat anything non-positive as "unlimited" (null → ∞ on render).
  const gatewayBudget = gatewayState.monthlyUsage?.maxBudget;
  const monthlyBudget: number | null = usesGateway
    ? typeof gatewayBudget === "number" && gatewayBudget > 0
      ? gatewayBudget
      : null
    : monthlyBudgetFallback;

  return {
    monthlyCost,
    monthlyBudget,
    monthlyUsageSource: usesGateway ? "gateway" : "sessions",
  };
}

interface SplashRuntimeOptions {
  doctor?: DoctorNudgeSummary;
  activeToolNames?: string[];
  allToolNames?: string[];
}

export function collectInitialSplashData(
  modelName: string,
  providerName: string,
  monthlyBudgetFallback: number = 3000,
  cwd?: string,
  options: SplashRuntimeOptions = {},
): SplashData {
  const gatewayState = getMonthlyUsageState();
  const gatewayUsage = gatewayState.monthlyUsage;
  const gatewayBudget = gatewayUsage?.maxBudget;
  const slackStatus = getSlackStatus();

  return {
    modelName,
    providerName,
    loadedCounts: { extensions: 0, skills: 0, promptTemplates: 0 },
    recentSessions: [],
    extensionHealth: [],
    slackConnected: false,
    slackVisible: false,
    slackStatus,
    monthlyCost: gatewayUsage?.spend ?? 0,
    monthlyBudget: gatewayUsage
      ? typeof gatewayBudget === "number" && gatewayBudget > 0
        ? gatewayBudget
        : null
      : monthlyBudgetFallback,
    monthlyUsageSource: gatewayUsage ? "gateway" : "sessions",
    gatewayVisible: false,
    gatewayStatus: gatewayState.connectionStatus ?? null,
    gatewayLoading: gatewayState.connectionStatus?.kind === "checking",
    gatewayKeyConflict: gatewayState.keyConflict ?? null,
    loading: true,
    slackLoading: true,
    extensionHealthLoading: true,
    loadedCountsLoading: true,
    recentSessionsLoading: true,
    sfCli: { installed: false, freshness: "checking", loading: true },
    nodeRuntime: collectNodeRuntimeStatus(),
    herdrRuntime: collectHerdrRuntimeStatus(cwd, {
      activeToolNames: options.activeToolNames,
      allToolNames: options.allToolNames,
    }),
    fontRuntime: readCachedFontRuntimeStatus() ?? defaultFontRuntimeStatus(),
    hunk: readCachedHunkStatus() ?? defaultHunkStatus(),
    homebrew: readCachedHomebrewStatus() ?? defaultHomebrewStatus(),
    autoUpdate: collectAutoUpdateStatus(),
    browserRuntime: readCachedBrowserRuntimeStatus() ?? defaultBrowserRuntimeStatus(),
    sfPiRelease: detectSfPiReleaseStatus(cwd),
    piRelease: collectInitialPiReleaseStatus(),
    codeAnalyzer:
      cwd && isSfPiExtensionEnabled(cwd, "sf-code-analyzer")
        ? readCodeAnalyzerReadiness()
        : undefined,
    nodeCert: { kind: "checking", loading: true },
    doctor:
      options.doctor ??
      summarizeStartupDoctorNudge(runDoctorDiagnostics({ cwd, runtime: "cached" })) ??
      undefined,
    privacy: collectPrivacyStatus(),
  };
}

export function collectSplashData(
  modelName: string,
  providerName: string,
  cwd: string,
  monthlyBudgetFallback: number = 3000,
  options: {
    includeLoadedCounts?: boolean;
    includeSessionCostFallback?: boolean;
    doctor?: DoctorNudgeSummary;
    activeToolNames?: string[];
    allToolNames?: string[];
  } = {},
): SplashData {
  const includeLoadedCounts = options.includeLoadedCounts !== false;
  const extensionHealth = discoverExtensionHealth(cwd);
  // extensionHealth is still surfaced in the splash header counter; no other
  // consumer needs the derived list anymore now that Tips is gone.
  const usage = resolveMonthlyUsage(monthlyBudgetFallback, {
    includeSessionFallback: options.includeSessionCostFallback === true,
  });
  const gatewayState = getMonthlyUsageState();
  const slackStatus = getSlackStatus();
  const slackVisible = shouldShowSlackStatus(cwd);
  const gatewayVisible = shouldShowGatewayStatus(cwd, modelName, providerName);

  // Announcements are resolved synchronously from bundled + cached remote
  // content. The remote feed (if configured) is fetched later via
  // refreshAnnouncements() and repaints in place. See extension index.ts.
  const announcementsPayload = buildAnnouncementsSync({ cwd });
  const announcements: AnnouncementsSummary | undefined =
    announcementsPayload.visible.length > 0
      ? {
          revision: announcementsPayload.revision,
          totalActive: announcementsPayload.totalActive,
          visible: announcementsPayload.visible.map((a) => ({
            id: a.id,
            kind: a.kind,
            severity: a.severity,
            title: a.title,
          })),
        }
      : undefined;

  const doctor =
    options.doctor ??
    summarizeStartupDoctorNudge(runDoctorDiagnostics({ cwd, runtime: "cached" })) ??
    undefined;
  const privacy = collectPrivacyStatus();
  const nodeCert = readCachedNodeCertStatus() ?? { kind: "checking" as const, loading: true };
  // Cache-first read: collectCaBundleNudge only inspects pre-persisted
  // state files written by the gateway extension's deferred doctor /
  // fix-ca-bundle apply paths. No filesystem walk, no subprocess, no
  // network. Returns undefined whenever the gateway extension is off,
  // the doctor passed, or a fix is already applied.
  const caBundleNudge = collectCaBundleNudge({ cwd });

  return {
    modelName,
    providerName,
    loadedCounts: includeLoadedCounts
      ? discoverLoadedCounts(cwd)
      : { extensions: 0, skills: 0, promptTemplates: 0 },
    recentSessions: getRecentSessions(3),
    extensionHealth,
    slackConnected: checkSlackConnection(cwd),
    slackVisible,
    slackStatus,
    monthlyCost: usage.monthlyCost,
    monthlyBudget: usage.monthlyBudget,
    monthlyUsageSource: usage.monthlyUsageSource,
    gatewayVisible,
    gatewayStatus: gatewayVisible ? (gatewayState.connectionStatus ?? null) : null,
    gatewayLoading: gatewayVisible && gatewayState.connectionStatus?.kind === "checking",
    gatewayKeyConflict: gatewayVisible ? (gatewayState.keyConflict ?? null) : null,
    recommendations: collectRecommendationsStatus(cwd),
    skillSources: summarizeAvailableSkillSources() ?? undefined,
    doctor,
    caBundleNudge,
    privacy,
    sfCli: undefined,
    nodeRuntime: collectNodeRuntimeStatus(),
    herdrRuntime: collectHerdrRuntimeStatus(cwd, {
      activeToolNames: options.activeToolNames,
      allToolNames: options.allToolNames,
    }),
    fontRuntime: readCachedFontRuntimeStatus() ?? defaultFontRuntimeStatus(),
    hunk: readCachedHunkStatus() ?? defaultHunkStatus(),
    homebrew: readCachedHomebrewStatus() ?? defaultHomebrewStatus(),
    autoUpdate: collectAutoUpdateStatus(),
    browserRuntime: readCachedBrowserRuntimeStatus() ?? defaultBrowserRuntimeStatus(),
    sfPiRelease: detectSfPiReleaseStatus(cwd),
    piRelease: collectInitialPiReleaseStatus(),
    codeAnalyzer: isSfPiExtensionEnabled(cwd, "sf-code-analyzer")
      ? readCodeAnalyzerReadiness()
      : undefined,
    nodeCert,
    announcements,
    loading: false,
    slackLoading: false,
    extensionHealthLoading: false,
    loadedCountsLoading: !includeLoadedCounts,
    recentSessionsLoading: false,
  };
}

/**
 * Refresh the announcements payload from the remote feed (when configured).
 *
 * Returns `undefined` when nothing visible changed — the extension uses
 * that signal to skip a repaint. This is a thin adapter over
 * refreshAnnouncements() that shapes the result for SplashData.
 */
export async function refreshAnnouncementsSummary(
  cwd?: string,
): Promise<AnnouncementsSummary | undefined> {
  try {
    const payload = await refreshAnnouncements({ cwd });
    if (payload.visible.length === 0) return undefined;
    return {
      revision: payload.revision,
      totalActive: payload.totalActive,
      visible: payload.visible.map((a) => ({
        id: a.id,
        kind: a.kind,
        severity: a.severity,
        title: a.title,
      })),
    };
  } catch {
    return undefined;
  }
}

/**
 * Snapshot the live telemetry posture for the splash row.
 *
 * Pure read: combines pi's `enableInstallTelemetry` setting with sf-pi's
 * own assertion record (see lib/common/privacy/state.ts) into a stable
 * shape the splash component can render without touching the FS again.
 */
export function collectPrivacyStatus(): PrivacyStatusSummary {
  const state = getTelemetryState();
  return {
    telemetryEnabled: state.effectivelyEnabled,
    source: state.source,
  };
}

export function collectNodeRuntimeStatus(version: string = process.version): NodeRuntimeStatusInfo {
  const parsed = /^v?\d+(?:\.\d+){0,2}/.test(version);
  return {
    kind: parsed ? (isNodeRuntimeSupported(version) ? "supported" : "unsupported") : "unknown",
    version,
    requiredVersion: NODE_RUNTIME_FLOOR,
    loading: false,
  };
}

export function collectAutoUpdateStatus(): AutoUpdateStatusInfo {
  return {
    enabled: readAutoUpdateEnabled(),
    status: readAutoUpdateStatus(),
  };
}
