/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Command handlers for `/sf-pi recommended`.
 *
 * Split out of index.ts to keep the main entry point readable. This module
 * glues together:
 *
 *   - recommendations-manifest.ts  (what is recommended)
 *   - recommendations-state.ts     (what the user has already decided)
 *   - recommendations-install.ts   (shell out to `pi install` / `pi remove`)
 *   - recommendations-overlay.ts   (interactive checklist)
 *
 * Each handler is async and self-contained; they never throw out of the
 * manager extension \u2014 errors are surfaced via ctx.ui.notify so a bad
 * recommendations entry can never crash a pi session.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { RecommendationsManifest, RecommendedItem } from "../../../catalog/types.ts";
import {
  defaultFirstRunBundleIds,
  loadRecommendationsManifest,
  resolveBundleItems,
} from "../../../lib/common/catalog-state/recommendations-manifest.ts";
import { installPackage, removePackage, type InstallScope } from "./recommendations-install.ts";
import {
  RecommendationsOverlayComponent,
  type RecommendationRow,
  type RecommendationsOverlayResult,
} from "./recommendations-overlay.ts";
import {
  acknowledgeRevision,
  readRecommendationsState,
  recordDecision,
  type RecommendationsState,
} from "../../../lib/common/catalog-state/recommendations-state.ts";

export type RecommendedSubcommand = "overlay" | "list" | "install" | "remove" | "status";

export interface RecommendedArgs {
  subcommand: RecommendedSubcommand;
  scope: InstallScope;
  target?: string;
}

const PREFIX = "/sf-pi recommended";

// -------------------------------------------------------------------------------------------------
// Argument parsing
// -------------------------------------------------------------------------------------------------

/**
 * Parse the tail after `/sf-pi recommended`.
 *
 * Accepted forms:
 *   ""                                    \u2192 overlay, global
 *   "list [global|project]"              \u2192 list
 *   "install <id|bundle:xxx> [scope]"    \u2192 install
 *   "remove  <id> [scope]"               \u2192 remove
 *   "status  [global|project]"           \u2192 status
 */
export function parseRecommendedArgs(raw: string): RecommendedArgs {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const sub = (tokens[0] ?? "").toLowerCase();

  const last = tokens[tokens.length - 1]?.toLowerCase();
  const scope: InstallScope =
    last === "project" || last === "global" ? (last as InstallScope) : "global";

  if (!sub) return { subcommand: "overlay", scope };
  if (sub === "list" || sub === "ls") return { subcommand: "list", scope };
  if (sub === "status") return { subcommand: "status", scope };
  if (sub === "install") {
    const target =
      tokens[1] && tokens[1].toLowerCase() !== "global" && tokens[1].toLowerCase() !== "project"
        ? tokens[1]
        : undefined;
    return { subcommand: "install", scope, target };
  }
  if (sub === "remove" || sub === "rm" || sub === "uninstall") {
    const target =
      tokens[1] && tokens[1].toLowerCase() !== "global" && tokens[1].toLowerCase() !== "project"
        ? tokens[1]
        : undefined;
    return { subcommand: "remove", scope, target };
  }

  return { subcommand: "overlay", scope };
}

// -------------------------------------------------------------------------------------------------
// Top-level dispatcher
// -------------------------------------------------------------------------------------------------

export async function handleRecommended(
  _pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  packageVersion: string,
  packageRoot: string,
  args: RecommendedArgs,
): Promise<void> {
  const manifest = loadRecommendationsManifest(packageRoot);

  switch (args.subcommand) {
    case "overlay":
      await handleOverlay(ctx, packageVersion, manifest, args.scope);
      break;
    case "list":
      handleList(ctx, manifest);
      break;
    case "install":
      await handleInstall(ctx, manifest, args.scope, args.target);
      break;
    case "remove":
      await handleRemove(ctx, manifest, args.scope, args.target);
      break;
    case "status":
      handleStatus(ctx, manifest);
      break;
  }
}

// -------------------------------------------------------------------------------------------------
// Overlay
// -------------------------------------------------------------------------------------------------

async function handleOverlay(
  ctx: ExtensionCommandContext,
  packageVersion: string,
  manifest: RecommendationsManifest,
  scope: InstallScope,
): Promise<void> {
  if (!ctx.hasUI) {
    handleList(ctx, manifest);
    return;
  }

  const state = readRecommendationsState();
  const items = Object.values(manifest.items);
  const rows: RecommendationRow[] = items.map((item) => ({
    item,
    // Pre-check:
    //   - never-seen items are pre-checked (opt-out)
    //   - previously installed items stay checked
    //   - previously declined items stay unchecked
    selected: state.decisions[item.id] !== "declined",
    previousDecision: state.decisions[item.id],
  }));

  ctx.ui.setWorkingVisible(false);
  let result: RecommendationsOverlayResult | undefined;
  try {
    result = await ctx.ui.custom<RecommendationsOverlayResult | undefined>(
      (_tui, theme, _keybindings, done) =>
        new RecommendationsOverlayComponent(theme, packageVersion, manifest.revision, rows, done),
      {
        overlay: true,
        overlayOptions: () => ({
          anchor: "center" as const,
          width: "78%",
          minWidth: 70,
        }),
      },
    );
  } finally {
    ctx.ui.setWorkingVisible(true);
  }

  // Always mark the revision as seen once the overlay opened, even on cancel.
  // The user has now been presented with the current list; don't nag them
  // again for this revision.
  if (manifest.revision) {
    acknowledgeRevision(manifest.revision);
  }

  if (!result || result.kind === "cancel") {
    return;
  }

  await applyRows(ctx, result.rows, scope);
}

// -------------------------------------------------------------------------------------------------
// Non-interactive handlers
// -------------------------------------------------------------------------------------------------

function handleList(ctx: ExtensionCommandContext, manifest: RecommendationsManifest): void {
  const items = Object.values(manifest.items);
  if (items.length === 0) {
    ctx.ui.notify("No recommendations are defined in this sf-pi build.", "info");
    return;
  }

  const state = readRecommendationsState();
  const lines = [
    `sf-pi recommended extensions (revision ${manifest.revision || "unset"}):`,
    "",
    ...items.map((item) => {
      const decision = state.decisions[item.id];
      const badge = decision === "installed" ? "●" : decision === "declined" ? "○" : "·";
      const status = decision ?? "new";
      return (
        `  ${badge} ${item.name} [${item.license}] — ${status}\n` +
        `      ${item.description}\n` +
        `      source: ${item.source}\n` +
        `      why:    ${item.rationale}`
      );
    }),
    "",
    `Run: ${PREFIX} install <id>  |  ${PREFIX} remove <id>  |  ${PREFIX} status`,
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}

function handleStatus(ctx: ExtensionCommandContext, manifest: RecommendationsManifest): void {
  const state = readRecommendationsState();
  const items = Object.values(manifest.items);
  const installed = items.filter((i) => state.decisions[i.id] === "installed").length;
  const declined = items.filter((i) => state.decisions[i.id] === "declined").length;
  const pending = items.length - installed - declined;
  const currentRevision = manifest.revision || "unset";
  const seenRevision = state.acknowledgedRevision || "never";

  const lines = [
    "sf-pi recommendations status",
    "",
    `Manifest revision: ${currentRevision}`,
    `Last acknowledged: ${seenRevision}`,
    `Items total:       ${items.length}`,
    `  installed:       ${installed}`,
    `  declined:        ${declined}`,
    `  pending:         ${pending}`,
    "",
    `Open the checklist with: ${PREFIX}`,
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}

// -------------------------------------------------------------------------------------------------
// Install / remove
// -------------------------------------------------------------------------------------------------

async function handleInstall(
  ctx: ExtensionCommandContext,
  manifest: RecommendationsManifest,
  scope: InstallScope,
  target: string | undefined,
): Promise<void> {
  const items = resolveInstallTarget(manifest, target);
  if (!items) {
    const ids = Object.keys(manifest.items).join(", ") || "(none)";
    const bundles = manifest.bundles.map((b) => `bundle:${b.id}`).join(", ") || "(none)";
    ctx.ui.notify(
      `Usage: ${PREFIX} install <id|bundle:name> [global|project]\n` +
        `Items:   ${ids}\n` +
        `Bundles: ${bundles}`,
      "warning",
    );
    return;
  }
  if (items.length === 0) {
    ctx.ui.notify(`No items resolved for "${target}".`, "warning");
    return;
  }

  let anyInstalled = false;
  for (const item of items) {
    const effectiveScope = item.scope ?? scope;
    const ok = await runInstall(ctx, item, effectiveScope);
    if (ok) {
      recordDecision(item.id, "installed");
      anyInstalled = true;
    }
  }

  if (anyInstalled) {
    ctx.ui.notify("Recommended extensions installed. Reloading…", "info");
    await ctx.reload();
  }
}

async function handleRemove(
  ctx: ExtensionCommandContext,
  manifest: RecommendationsManifest,
  scope: InstallScope,
  target: string | undefined,
): Promise<void> {
  const items = resolveInstallTarget(manifest, target);
  if (!items) {
    ctx.ui.notify(`Usage: ${PREFIX} remove <id|bundle:name> [global|project]`, "warning");
    return;
  }
  if (items.length === 0) {
    ctx.ui.notify(`No items resolved for "${target}".`, "warning");
    return;
  }

  let anyRemoved = false;
  for (const item of items) {
    const effectiveScope = item.scope ?? scope;
    const result = await removePackage(item.source, effectiveScope, { cwd: ctx.cwd });
    if (result.success) {
      recordDecision(item.id, "declined");
      anyRemoved = true;
      ctx.ui.notify(`Removed ${item.name}.`, "info");
    } else {
      ctx.ui.notify(
        `Failed to remove ${item.name}: ${result.stderr || result.stdout || "unknown error"}\n` +
          `You can retry manually: ${result.command}`,
        "warning",
      );
    }
  }

  if (anyRemoved) {
    ctx.ui.notify("Reloading…", "info");
    await ctx.reload();
  }
}

// -------------------------------------------------------------------------------------------------
// Shared helpers
// -------------------------------------------------------------------------------------------------

function resolveInstallTarget(
  manifest: RecommendationsManifest,
  target: string | undefined,
): RecommendedItem[] | null {
  if (!target) return null;
  if (target.startsWith("bundle:")) {
    const bundleId = target.slice("bundle:".length);
    return resolveBundleItems(manifest, [bundleId]);
  }
  const item = manifest.items[target];
  return item ? [item] : [];
}

async function runInstall(
  ctx: ExtensionCommandContext,
  item: RecommendedItem,
  scope: InstallScope,
): Promise<boolean> {
  ctx.ui.notify(`Installing ${item.name} (${scope})…`, "info");
  const result = await installPackage(item.source, scope, { cwd: ctx.cwd });
  if (result.success) {
    ctx.ui.notify(`Installed ${item.name}.`, "info");
    return true;
  }
  ctx.ui.notify(
    `Failed to install ${item.name}: ${result.stderr || result.stdout || "unknown error"}\n` +
      `You can retry manually: ${result.command}`,
    "warning",
  );
  return false;
}

async function applyRows(
  ctx: ExtensionCommandContext,
  rows: readonly RecommendationRow[],
  scope: InstallScope,
): Promise<void> {
  // Split into three buckets keyed off previous decision vs. new selection.
  const toInstall = rows.filter((r) => r.selected && r.previousDecision !== "installed");
  const toRemove = rows.filter((r) => !r.selected && r.previousDecision === "installed");
  const toDeclineOnly = rows.filter((r) => !r.selected && r.previousDecision !== "installed");

  let didMutate = false;

  for (const row of toInstall) {
    const effectiveScope = row.item.scope ?? scope;
    const ok = await runInstall(ctx, row.item, effectiveScope);
    if (ok) {
      recordDecision(row.item.id, "installed");
      didMutate = true;
    }
  }

  for (const row of toRemove) {
    const effectiveScope = row.item.scope ?? scope;
    const result = await removePackage(row.item.source, effectiveScope, { cwd: ctx.cwd });
    if (result.success) {
      recordDecision(row.item.id, "declined");
      didMutate = true;
      ctx.ui.notify(`Removed ${row.item.name}.`, "info");
    } else {
      ctx.ui.notify(
        `Failed to remove ${row.item.name}: ${result.stderr || "unknown error"}`,
        "warning",
      );
    }
  }

  for (const row of toDeclineOnly) {
    if (row.previousDecision !== "declined") {
      recordDecision(row.item.id, "declined");
    }
  }

  if (didMutate) {
    ctx.ui.notify("Recommendations applied. Reloading…", "info");
    await ctx.reload();
  }
}

// -------------------------------------------------------------------------------------------------
// Session nudge
// -------------------------------------------------------------------------------------------------

/**
 * Decide whether to surface the first-run nudge in the footer status bar.
 *
 * We surface a nudge when:
 *   - The manifest has a revision
 *   - The user has not acknowledged this revision
 *   - At least one default-bundle item is still pending (not installed/declined)
 *
 * Opt-out:
 *   - SF_PI_RECOMMENDATIONS=off environment variable
 *   - (future) sfPi.recommendations.auto = "off" in settings
 */
export interface NudgeInfo {
  show: boolean;
  pendingCount: number;
  revision: string;
}

export function computeRecommendationsNudge(
  manifest: RecommendationsManifest,
  state: RecommendationsState,
  env: NodeJS.ProcessEnv = process.env,
): NudgeInfo {
  if ((env.SF_PI_RECOMMENDATIONS ?? "").toLowerCase() === "off") {
    return { show: false, pendingCount: 0, revision: manifest.revision };
  }
  if (!manifest.revision) {
    return { show: false, pendingCount: 0, revision: "" };
  }
  if (state.acknowledgedRevision === manifest.revision) {
    return { show: false, pendingCount: 0, revision: manifest.revision };
  }

  const defaultBundleIds = defaultFirstRunBundleIds(manifest);
  const defaultItems = resolveBundleItems(manifest, defaultBundleIds);
  const pending = defaultItems.filter((item) => {
    const decision = state.decisions[item.id];
    return decision !== "installed" && decision !== "declined";
  });

  return {
    show: pending.length > 0,
    pendingCount: pending.length,
    revision: manifest.revision,
  };
}
