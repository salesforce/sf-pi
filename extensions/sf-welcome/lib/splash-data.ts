/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Aggregate data discovery for the sf-welcome splash screen.
 *
 * Responsibility split:
 * - this file orchestrates the splash payload
 * - session-data.ts owns session scanning and cost estimation
 * - extension-health.ts owns sf-pi registry + settings state
 * - sf-environment.ts adapts the shared lib/common/sf-environment runtime
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
import { estimateLifetimeCost, estimateMonthlyCost, getRecentSessions } from "./session-data.ts";
import { buildTipsForActiveExtensions } from "./tips.ts";
import { detectTokenSource } from "../../sf-slack/lib/auth.ts";
import { getMonthlyUsageState } from "../../../lib/common/monthly-usage/store.ts";
import { buildWhatsNewPayload } from "./whats-new.ts";
import { buildAnnouncementsSync, refreshAnnouncements } from "./announcements.ts";
import { collectRecommendationsStatus } from "./recommendations-status.ts";
// Only the types actually referenced in this module's function bodies are
// imported here; the rest are re-exported for convenience via the
// `export type` block below, which does not require a local import.
import type { AnnouncementsSummary, LoadedCounts, SplashData, WhatsNewSummary } from "./types.ts";

export type {
  AnnouncementLine,
  AnnouncementsSummary,
  LoadedCounts,
  SfEnvironmentInfo,
  SplashData,
  RecentSession,
  ExtensionHealthItem,
  TipItem,
  RecommendationsStatusSummary,
  RecommendationStatusItem,
  RecommendationDisplayStatus,
  WhatsNewSummary,
} from "./types.ts";
export { discoverExtensionHealth } from "./extension-health.ts";
export { detectSfEnvironment, getCachedSfEnvironmentInfo } from "./sf-environment.ts";
export { estimateLifetimeCost, estimateMonthlyCost, getRecentSessions } from "./session-data.ts";
export { buildTipsForActiveExtensions } from "./tips.ts";
export { buildWhatsNewPayload, readCurrentPiVersion } from "./whats-new.ts";
export {
  buildAnnouncementsSync,
  refreshAnnouncements,
  MAX_VISIBLE_ANNOUNCEMENTS,
} from "./announcements.ts";

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
// Slack connection status
// ═══════════════════════════════════════════════════════════════════════════

export function checkSlackConnection(): boolean {
  // Mirror sf-slack's real token resolution so the welcome screen matches the
  // extension's actual auth behavior instead of a partial best-effort guess.
  return detectTokenSource() !== "none";
}

// ═══════════════════════════════════════════════════════════════════════════
// Aggregate data collection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the monthly-usage payload shown on the splash.
 *
 * Prefers the gateway's live numbers (same source as the bottom bar) so the
 * splash and footer never disagree. Falls back to a best-effort estimate
 * from local session files when the gateway hasn't populated its cache.
 */
export function resolveMonthlyUsage(monthlyBudgetFallback: number = 3000): {
  monthlyCost: number;
  monthlyBudget: number | null;
  monthlyUsageSource: "gateway" | "sessions";
} {
  const gatewayState = getMonthlyUsageState();
  // Narrow once so TS proves non-undefined without a non-null assertion.
  const gatewayUsage = gatewayState.monthlyUsage;
  const usesGateway = !!gatewayUsage;
  const monthlyCost = gatewayUsage ? gatewayUsage.spend : estimateMonthlyCost();
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

/**
 * Compute the lifetime-usage payload shown on the splash.
 *
 * Prefers the gateway's per-key lifetime counter (`/key/info.spend`) so the
 * splash matches the gateway status report. Falls back to a best-effort
 * sum across local session files for users who aren't on the gateway
 * (bring-your-own-keys). The fallback is clearly labeled as an estimate on
 * the splash so the user knows the number is local-only.
 */
export function resolveLifetimeUsage(): {
  lifetimeCost: number;
  lifetimeUsageSource: "gateway" | "sessions";
} {
  const gatewayState = getMonthlyUsageState();
  const keyInfo = gatewayState.keyInfo;
  if (keyInfo && typeof keyInfo.spend === "number") {
    return { lifetimeCost: keyInfo.spend, lifetimeUsageSource: "gateway" };
  }
  return { lifetimeCost: estimateLifetimeCost(), lifetimeUsageSource: "sessions" };
}

export function collectSplashData(
  modelName: string,
  providerName: string,
  cwd: string,
  monthlyBudgetFallback: number = 3000,
): SplashData {
  const extensionHealth = discoverExtensionHealth(cwd);
  const usage = resolveMonthlyUsage(monthlyBudgetFallback);
  const lifetime = resolveLifetimeUsage();

  // Resolve the What's New panel eagerly so the splash can include it on
  // the very first render. Returns undefined on first-ever launch or when
  // the user has already acknowledged the current version.
  const whatsNewPayload = buildWhatsNewPayload();
  const whatsNew: WhatsNewSummary | undefined = whatsNewPayload
    ? {
        fromVersion: whatsNewPayload.fromVersion,
        toVersion: whatsNewPayload.toVersion,
        bullets: whatsNewPayload.bullets.map((b) => ({ text: b.text, section: b.section })),
      }
    : undefined;

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

  return {
    modelName,
    providerName,
    loadedCounts: discoverLoadedCounts(cwd),
    recentSessions: getRecentSessions(3),
    extensionHealth,
    slackConnected: checkSlackConnection(),
    monthlyCost: usage.monthlyCost,
    monthlyBudget: usage.monthlyBudget,
    monthlyUsageSource: usage.monthlyUsageSource,
    lifetimeCost: lifetime.lifetimeCost,
    lifetimeUsageSource: lifetime.lifetimeUsageSource,
    tips: buildTipsForActiveExtensions(extensionHealth),
    recommendations: collectRecommendationsStatus(cwd),
    sfEnvironment: undefined,
    whatsNew,
    announcements,
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
