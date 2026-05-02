/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-pi-manager — Core manager extension for the sf-pi package.
 *
 * Provides:
 * - /sf-pi command with subcommands (list, enable, disable, status, etc.)
 * - Interactive TUI overlay for browsing, toggling, and inspecting extensions
 * - Footer status showing active extension count
 *
 * How enable/disable works:
 * - Uses pi's native package filtering in settings.json
 * - Disabling an extension adds a "!extensions/<file>" exclusion pattern
 * - Enabling removes the exclusion pattern
 * - Changes require ctx.reload() to take effect
 *
 * Commands:
 * - /sf-pi                    open interactive TUI overlay
 * - /sf-pi list               list extensions with enabled/disabled status
 * - /sf-pi enable <name>      enable a specific extension
 * - /sf-pi disable <name>     disable a specific extension
 * - /sf-pi enable-all         enable all extensions
 * - /sf-pi disable-all        disable all (except the manager)
 * - /sf-pi status             show summary
 * - /sf-pi display [profile]  show or set compact/balanced/verbose display profile
 * - /sf-pi help               show available commands
 *
 * Behavior matrix:
 *
 *   Trigger                      | Condition                   | Result
 *   -----------------------------|-----------------------------|-----------------------------------
 *   /sf-pi (no args)             | has UI                      | Open TUI overlay
 *   /sf-pi (no args)             | no UI                       | Fall back to list
 *   /sf-pi list                  | package in settings         | Show extension states
 *   /sf-pi list                  | package NOT in settings     | Show states (all enabled assumed)
 *   /sf-pi enable <id>           | valid, currently disabled   | Remove exclusion, reload
 *   /sf-pi enable <id>           | valid, already enabled      | Notify "already enabled"
 *   /sf-pi enable <id>           | alwaysActive                | Notify "cannot toggle"
 *   /sf-pi disable <id>          | valid, currently enabled    | Add exclusion, reload
 *   /sf-pi disable-all           | —                           | Exclude all non-alwaysActive, reload
 *   /sf-pi enable-all            | —                           | Remove all exclusions, reload
 *   /sf-pi display               | no profile                  | Show effective display profile
 *   /sf-pi display <profile>     | compact/balanced/verbose    | Save shared display profile
 *   TUI overlay → Enter          | list view                   | Open extension detail/config view
 *   TUI overlay → Esc            | list view, changes pending  | Apply exclusions, reload if needed
 *   TUI overlay → Esc            | detail view                 | Return to extension list
 *   session_start                | —                           | Update footer status
 *   session_shutdown             | —                           | Clear footer status
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { SF_PI_REGISTRY } from "../../catalog/registry.ts";
import { SfPiOverlayComponent, type ExtensionState, type OverlayResult } from "./lib/overlay.ts";
import {
  applyExtensionState,
  findPackageInSettings,
  getDisabledExtensions,
  getDisabledExtensionsForCwd,
} from "./lib/package-state.ts";
import { glyph, resolveGlyphMode } from "../../lib/common/glyph-policy.ts";
import { requirePiVersion, setWorkingVisible } from "../../lib/common/pi-compat.ts";
import {
  describeDisplaySettingsSource,
  readEffectiveSfPiDisplaySettings,
  writeScopedSfPiDisplaySettings,
} from "../../lib/common/display/settings.ts";
import { SF_PI_DISPLAY_PROFILES, isSfPiDisplayProfile } from "../../lib/common/display/types.ts";
import {
  computeRecommendationsNudge,
  handleRecommended,
  parseRecommendedArgs,
} from "./lib/recommendations.ts";
import { loadRecommendationsManifest } from "../../lib/common/catalog-state/recommendations-manifest.ts";
import { readRecommendationsState } from "../../lib/common/catalog-state/recommendations-state.ts";
import {
  computeAnnouncementsNudge,
  handleAnnouncements,
  parseAnnouncementsArgs,
} from "./lib/announcements.ts";
import { loadAnnouncementsManifest } from "../../lib/common/catalog-state/announcements-manifest.ts";
import { buildAnnouncementsSync } from "../sf-welcome/lib/announcements.ts";
import { readAnnouncementsState } from "../../lib/common/catalog-state/announcements-state.ts";

export {
  applyExtensionState,
  findSfPiPackageEntry,
  getDisabledExtensions,
  matchesPackageSource,
} from "./lib/package-state.ts";

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const COMMAND_NAME = "sf-pi";
const STATUS_KEY = "sf-pi";
const RECOMMENDATIONS_STATUS_KEY = "sf-pi-recommend";
const ANNOUNCEMENTS_STATUS_KEY = "sf-pi-announce";

// -------------------------------------------------------------------------------------------------
// Package root detection
// -------------------------------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "../..");

const PACKAGE_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

type CommandArgs = {
  subcommand:
    | "overlay"
    | "list"
    | "enable"
    | "disable"
    | "enable-all"
    | "disable-all"
    | "status"
    | "display"
    | "recommended"
    | "announcements"
    | "help";
  scope: "global" | "project";
  target?: string;
  /** Raw tail after the subcommand token, used by multi-arg subcommands. */
  rest?: string;
};

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export default function sfPiManagerExtension(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-pi-manager")) return;

  pi.registerCommand(COMMAND_NAME, {
    description: "Salesforce pi extension manager — browse, enable, and disable extensions",
    getArgumentCompletions: (prefix: string) => {
      const subcommands = [
        "list",
        "enable",
        "disable",
        "enable-all",
        "disable-all",
        "status",
        "display",
        "recommended",
        "announcements",
        "help",
      ];
      const tokens = prefix.trim().split(/\s+/);
      const current = tokens[tokens.length - 1] ?? "";

      // First token: subcommand completion
      if (tokens.length <= 1) {
        const matches = subcommands
          .filter((s) => s.startsWith(current.toLowerCase()))
          .map((s) => ({ value: s, label: s }));
        return matches.length > 0 ? matches : null;
      }

      const sub = tokens[0]?.toLowerCase();

      // Second token for display: profile names
      if (sub === "display" && tokens.length <= 2) {
        const profiles = SF_PI_DISPLAY_PROFILES.filter((profile) =>
          profile.startsWith(current.toLowerCase()),
        ).map((profile) => ({ value: profile, label: profile }));
        return profiles.length > 0 ? profiles : null;
      }

      // Second token for enable/disable: extension IDs
      if ((sub === "enable" || sub === "disable") && tokens.length <= 2) {
        const ids = SF_PI_REGISTRY.filter((e) => !e.alwaysActive)
          .map((e) => e.id)
          .filter((id) => id.startsWith(current.toLowerCase()))
          .map((id) => ({ value: id, label: id }));
        return ids.length > 0 ? ids : null;
      }

      // Scope completion for subcommands that accept it
      const scopedSubs = [
        "list",
        "enable",
        "disable",
        "enable-all",
        "disable-all",
        "status",
        "display",
      ];
      if (scopedSubs.includes(sub ?? "")) {
        const scopes = ["global", "project"]
          .filter((s) => s.startsWith(current.toLowerCase()))
          .map((s) => ({ value: s, label: s }));
        return scopes.length > 0 ? scopes : null;
      }

      return null;
    },
    handler: async (args, ctx) => {
      await handleCommand(pi, args, ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    updateFooterStatus(ctx);
    updateRecommendationsNudge(ctx);
    updateAnnouncementsNudge(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setStatus(RECOMMENDATIONS_STATUS_KEY, undefined);
    ctx.ui.setStatus(ANNOUNCEMENTS_STATUS_KEY, undefined);
  });
}

// -------------------------------------------------------------------------------------------------
// Command routing
// -------------------------------------------------------------------------------------------------

// Exported for unit tests.
export function parseCommandArgs(raw: string): CommandArgs {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const sub = (tokens[0] ?? "").toLowerCase();

  // Scope detection: last token can be "global" or "project"
  let scope: "global" | "project" = "global";
  const lastToken = tokens[tokens.length - 1]?.toLowerCase();
  if (lastToken === "project" || lastToken === "global") {
    scope = lastToken as "global" | "project";
  }

  if (sub === "list" || sub === "ls") return { subcommand: "list", scope };
  if (sub === "status") return { subcommand: "status", scope };
  if (sub === "recommended" || sub === "recommend" || sub === "rec") {
    const rest = tokens.slice(1).join(" ");
    return { subcommand: "recommended", scope, rest };
  }
  if (sub === "announcements" || sub === "announce" || sub === "ann") {
    const rest = tokens.slice(1).join(" ");
    return { subcommand: "announcements", scope, rest };
  }
  if (sub === "display") {
    const target =
      tokens[1] && tokens[1].toLowerCase() !== "global" && tokens[1].toLowerCase() !== "project"
        ? tokens[1].toLowerCase()
        : undefined;
    return { subcommand: "display", scope, target };
  }
  if (sub === "help") return { subcommand: "help", scope };
  if (sub === "enable-all") return { subcommand: "enable-all", scope };
  if (sub === "disable-all") return { subcommand: "disable-all", scope };

  if (sub === "enable") {
    const target =
      tokens[1] && tokens[1].toLowerCase() !== "global" && tokens[1].toLowerCase() !== "project"
        ? tokens[1]
        : undefined;
    return { subcommand: "enable", scope, target };
  }

  if (sub === "disable") {
    const target =
      tokens[1] && tokens[1].toLowerCase() !== "global" && tokens[1].toLowerCase() !== "project"
        ? tokens[1]
        : undefined;
    return { subcommand: "disable", scope, target };
  }

  // No subcommand or unknown → open overlay
  if (!sub || sub === "manage" || sub === "open") return { subcommand: "overlay", scope };

  return { subcommand: "help", scope };
}

async function handleCommand(
  pi: ExtensionAPI,
  raw: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const args = parseCommandArgs(raw);

  switch (args.subcommand) {
    case "overlay":
      await handleOverlay(ctx, args.scope);
      break;
    case "list":
      await handleList(ctx, args.scope);
      break;
    case "enable":
      await handleToggle(ctx, args.scope, args.target, true);
      break;
    case "disable":
      await handleToggle(ctx, args.scope, args.target, false);
      break;
    case "enable-all":
      await handleToggleAll(ctx, args.scope, true);
      break;
    case "disable-all":
      await handleToggleAll(ctx, args.scope, false);
      break;
    case "status":
      await handleStatus(ctx, args.scope);
      break;
    case "display":
      handleDisplay(ctx, args.scope, args.target);
      break;
    case "recommended": {
      const recArgs = parseRecommendedArgs(args.rest ?? "");
      if (!args.rest || !/\b(global|project)\b/i.test(args.rest)) {
        recArgs.scope = args.scope;
      }
      await handleRecommended(pi, ctx, PACKAGE_VERSION, PACKAGE_ROOT, recArgs);
      break;
    }
    case "announcements": {
      const annArgs = parseAnnouncementsArgs(args.rest ?? "");
      await handleAnnouncements(ctx, PACKAGE_ROOT, annArgs);
      // Listing an announcement counts as acknowledging the revision so the
      // footer nudge clears even if the user never dismisses the splash.
      updateAnnouncementsNudge(ctx);
      break;
    }
    case "help":
      handleHelp(ctx);
      break;
  }
}

// -------------------------------------------------------------------------------------------------
// Command handlers
// -------------------------------------------------------------------------------------------------

async function handleOverlay(
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<void> {
  if (!ctx.hasUI) {
    // Fall back to list in non-interactive mode
    await handleList(ctx, scope);
    return;
  }

  const match = findPackageInSettings(ctx.cwd, scope);
  if (!match) {
    ctx.ui.notify(
      `sf-pi package not found in ${scope} settings. Is it installed? Run: pi install .`,
      "warning",
    );
    return;
  }

  const disabledFiles = getDisabledExtensions(match.settingsPath);
  const extensions = buildExtensionStates(disabledFiles);

  // Hide pi's built-in working loader row while the overlay is modal so the
  // row doesn't reserve space behind our centered dialog. Restored in the
  // finally block regardless of how the overlay closes. No-op on pi < 0.70.3.
  setWorkingVisible(ctx, false);
  let result: OverlayResult | undefined;
  try {
    result = await ctx.ui.custom<OverlayResult | undefined>(
      (_tui, theme, _keybindings, done) =>
        new SfPiOverlayComponent(
          theme,
          PACKAGE_VERSION,
          PACKAGE_ROOT,
          ctx.cwd,
          extensions,
          SF_PI_REGISTRY,
          scope,
          done,
        ),
      {
        overlay: true,
        // Use function form for responsive sizing on terminal resize
        overlayOptions: () => ({
          anchor: "center" as const,
          width: "78%",
          minWidth: 70,
        }),
      },
    );
  } finally {
    setWorkingVisible(ctx, true);
  }

  if (!result || !result.changed) {
    return;
  }

  // Use the scope from the overlay result (user may have toggled it)
  const effectiveScope = result.scope ?? scope;
  const effectiveMatch = findPackageInSettings(ctx.cwd, effectiveScope) ?? match;

  applyExtensionState(effectiveMatch, result.disabledFiles);
  ctx.ui.notify("sf-pi extensions updated. Reloading…", "info");
  await ctx.reload();
  return;
}

async function handleList(
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<void> {
  const match = findPackageInSettings(ctx.cwd, scope);
  const disabledFiles = match ? getDisabledExtensions(match.settingsPath) : new Set<string>();
  const states = buildExtensionStates(disabledFiles);

  const enabledCount = states.filter((e) => e.enabled).length;
  const lines = [
    `sf-pi v${PACKAGE_VERSION} — ${enabledCount}/${states.length} extensions enabled`,
    `Settings scope: ${scope}${match ? "" : " (package not found in settings)"}`,
    "",
    ...states.map((ext) => {
      const icon = ext.alwaysActive ? "◆" : ext.enabled ? "●" : "○";
      const status = ext.alwaysActive ? "always" : ext.enabled ? "enabled" : "disabled";
      return `  ${icon} ${ext.name} [${ext.category}] — ${status}\n    ${ext.description}`;
    }),
  ];

  ctx.ui.notify(lines.join("\n"), "info");
}

async function handleToggle(
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
  target: string | undefined,
  enable: boolean,
): Promise<void> {
  if (!target) {
    ctx.ui.notify(
      `Usage: /${COMMAND_NAME} ${enable ? "enable" : "disable"} <extension-id>`,
      "warning",
    );
    return;
  }

  const ext = SF_PI_REGISTRY.find((e) => e.id === target || e.id === target.toLowerCase());

  if (!ext) {
    const available = SF_PI_REGISTRY.filter((e) => !e.alwaysActive)
      .map((e) => e.id)
      .join(", ");
    ctx.ui.notify(`Unknown extension: "${target}". Available: ${available}`, "warning");
    return;
  }

  if (ext.alwaysActive) {
    ctx.ui.notify(
      `${ext.name} is always active and cannot be ${enable ? "enabled" : "disabled"}.`,
      "warning",
    );
    return;
  }

  const match = findPackageInSettings(ctx.cwd, scope);
  if (!match) {
    ctx.ui.notify(`sf-pi package not found in ${scope} settings. Is it installed?`, "warning");
    return;
  }

  const disabledFiles = getDisabledExtensions(match.settingsPath);
  const wasEnabled = !disabledFiles.has(ext.file);

  if (enable && wasEnabled) {
    ctx.ui.notify(`${ext.name} is already enabled.`, "info");
    return;
  }

  if (!enable && !wasEnabled) {
    ctx.ui.notify(`${ext.name} is already disabled.`, "info");
    return;
  }

  if (enable) {
    disabledFiles.delete(ext.file);
  } else {
    disabledFiles.add(ext.file);
  }

  applyExtensionState(match, disabledFiles);
  ctx.ui.notify(`${ext.name} ${enable ? "enabled" : "disabled"}. Reloading…`, "info");
  await ctx.reload();
  return;
}

async function handleToggleAll(
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
  enable: boolean,
): Promise<void> {
  const match = findPackageInSettings(ctx.cwd, scope);
  if (!match) {
    ctx.ui.notify(`sf-pi package not found in ${scope} settings. Is it installed?`, "warning");
    return;
  }

  const disabledFiles = new Set<string>();

  if (!enable) {
    // Disable all except alwaysActive
    for (const ext of SF_PI_REGISTRY) {
      if (!ext.alwaysActive) {
        disabledFiles.add(ext.file);
      }
    }
  }

  applyExtensionState(match, disabledFiles);
  const action = enable ? "enabled" : "disabled";
  const count = enable
    ? SF_PI_REGISTRY.length
    : SF_PI_REGISTRY.filter((e) => !e.alwaysActive).length;
  ctx.ui.notify(`${count} extension(s) ${action}. Reloading…`, "info");
  await ctx.reload();
  return;
}

async function handleStatus(
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<void> {
  const match = findPackageInSettings(ctx.cwd, scope);
  const disabledFiles = match ? getDisabledExtensions(match.settingsPath) : new Set<string>();
  const states = buildExtensionStates(disabledFiles);

  const enabledCount = states.filter((e) => e.enabled).length;
  const display = readEffectiveSfPiDisplaySettings(ctx.cwd);

  const lines = [
    "sf-pi Extension Suite",
    "",
    `Version: ${PACKAGE_VERSION}`,
    `Package root: ${PACKAGE_ROOT}`,
    `Extensions: ${enabledCount}/${states.length} enabled`,
    `Display profile: ${display.profile} (${describeDisplaySettingsSource(display)})`,
    `Settings scope: ${scope}`,
    `Package in settings: ${match ? "yes" : "no"}`,
    match ? `Settings file: ${match.settingsPath}` : "",
    match ? `Package source: ${match.source}` : "",
    "",
    "Extensions:",
    ...states.map((ext) => {
      const icon = ext.alwaysActive ? "◆" : ext.enabled ? "●" : "○";
      const status = ext.alwaysActive ? "always" : ext.enabled ? "enabled" : "disabled";
      return `  ${icon} ${ext.id} (${status}) — ${ext.description}`;
    }),
    "",
    `Commands: /${COMMAND_NAME} help`,
  ].filter(Boolean);

  ctx.ui.notify(lines.join("\n"), "info");
}

function handleDisplay(
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
  target: string | undefined,
): void {
  if (!target) {
    const display = readEffectiveSfPiDisplaySettings(ctx.cwd);
    ctx.ui.notify(
      [
        `sf-pi display profile: ${display.profile}`,
        `Source: ${describeDisplaySettingsSource(display)}`,
        "",
        "Profiles:",
        "  compact  — terse summaries and minimal previews",
        "  balanced — concise defaults with useful previews",
        "  verbose  — richer previews and fuller research detail",
        "",
        `Usage: /${COMMAND_NAME} display <compact|balanced|verbose> [global|project]`,
      ].join("\n"),
      "info",
    );
    return;
  }

  if (!isSfPiDisplayProfile(target)) {
    ctx.ui.notify(
      `Unknown display profile: ${target}. Use one of: ${SF_PI_DISPLAY_PROFILES.join(", ")}`,
      "warning",
    );
    return;
  }

  const saved = writeScopedSfPiDisplaySettings(ctx.cwd, scope, {
    profile: target,
  });
  ctx.ui.notify(
    `sf-pi display profile set to ${saved.settings.profile} in ${scope} settings.`,
    "info",
  );
}

function handleHelp(ctx: ExtensionCommandContext): void {
  const lines = [
    `sf-pi v${PACKAGE_VERSION} — Salesforce extension manager for pi`,
    "",
    "Commands:",
    `  /${COMMAND_NAME}                          Open interactive TUI overlay`,
    `  /${COMMAND_NAME} list [global|project]     List extensions with status`,
    `  /${COMMAND_NAME} enable <id> [scope]       Enable an extension`,
    `  /${COMMAND_NAME} disable <id> [scope]      Disable an extension`,
    `  /${COMMAND_NAME} enable-all [scope]        Enable all extensions`,
    `  /${COMMAND_NAME} disable-all [scope]       Disable all (except manager)`,
    `  /${COMMAND_NAME} status [scope]            Show summary`,
    `  /${COMMAND_NAME} display [profile] [scope] Show or set display profile`,
    `  /${COMMAND_NAME} recommended [...]         Manage recommended external extensions`,
    `  /${COMMAND_NAME} announcements [...]       List/dismiss/reset sf-pi announcements`,
    `  /${COMMAND_NAME} help                      Show this help`,
    "",
    "Available extensions:",
    ...SF_PI_REGISTRY.map(
      (ext) =>
        `  ${ext.id} [${ext.category}]${ext.alwaysActive ? " (always active)" : ""} — ${ext.description}`,
    ),
    "",
    "Scope defaults to global. Use 'project' to target .pi/settings.json.",
  ];

  ctx.ui.notify(lines.join("\n"), "info");
}

// -------------------------------------------------------------------------------------------------
// Footer status
// -------------------------------------------------------------------------------------------------

function updateFooterStatus(ctx: ExtensionContext): void {
  const globalDisabled = getDisabledExtensionsForCwd(ctx.cwd);
  const states = buildExtensionStates(globalDisabled);
  const enabledCount = states.filter((e) => e.enabled).length;
  // Glyph policy swaps `📦` for `[]` on terminals without emoji font
  // fallback so the bottom-bar status stays readable instead of tofu.
  const icon = glyph("loaded", resolveGlyphMode({ cwd: ctx.cwd }));
  ctx.ui.setStatus(
    STATUS_KEY,
    `${icon} SF Pi Packages: ${enabledCount}/${states.length} extensions`,
  );
}

// Surface a one-line nudge in the footer when the user hasn't seen the
// current recommendations revision. Zero-cost when there are no pending
// items or the user opted out via SF_PI_RECOMMENDATIONS=off.
function updateRecommendationsNudge(ctx: ExtensionContext): void {
  try {
    const manifest = loadRecommendationsManifest(PACKAGE_ROOT);
    const state = readRecommendationsState();
    const nudge = computeRecommendationsNudge(manifest, state);
    if (!nudge.show) {
      ctx.ui.setStatus(RECOMMENDATIONS_STATUS_KEY, undefined);
      return;
    }
    ctx.ui.setStatus(
      RECOMMENDATIONS_STATUS_KEY,
      `✨ sf-pi: ${nudge.pendingCount} new recommended extension(s) — /sf-pi recommended`,
    );
  } catch {
    // Nudge is best-effort; never break session_start.
    ctx.ui.setStatus(RECOMMENDATIONS_STATUS_KEY, undefined);
  }
}

// Footer nudge for unacknowledged announcements. Mirrors the
// recommendations nudge pattern: one line, best-effort, cleared when the
// user acknowledges via splash dismiss or explicit `/sf-pi announcements`.
function updateAnnouncementsNudge(ctx: ExtensionContext): void {
  try {
    const manifest = loadAnnouncementsManifest(PACKAGE_ROOT);
    const state = readAnnouncementsState();
    const payload = buildAnnouncementsSync({ packageRoot: PACKAGE_ROOT, cwd: ctx.cwd });
    const nudge = computeAnnouncementsNudge(manifest, state, payload);
    if (!nudge.show) {
      ctx.ui.setStatus(ANNOUNCEMENTS_STATUS_KEY, undefined);
      return;
    }
    ctx.ui.setStatus(
      ANNOUNCEMENTS_STATUS_KEY,
      `🔔 sf-pi: ${nudge.visibleCount} announcement(s) — /sf-pi announcements`,
    );
  } catch {
    ctx.ui.setStatus(ANNOUNCEMENTS_STATUS_KEY, undefined);
  }
}

// -------------------------------------------------------------------------------------------------
// Extension state helpers
// -------------------------------------------------------------------------------------------------

// Exported for unit tests.
export function buildExtensionStates(disabledFiles: Set<string>): ExtensionState[] {
  return SF_PI_REGISTRY.map((ext) => ({
    ...ext,
    enabled: ext.alwaysActive || !disabledFiles.has(ext.file),
  }));
}
