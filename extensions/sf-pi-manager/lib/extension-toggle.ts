/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared "toggle this extension" action used by every per-extension
 * settings panel.
 *
 * Why this lives in sf-pi-manager:
 * - sf-pi-manager owns the write-side of pi's settings.json filter list
 *   (`applyExtensionState`), so the toggle action would have to import
 *   from here anyway.
 * - sf-pi-manager is `alwaysActive`, so any other extension that imports
 *   this module is guaranteed to find it loaded.
 * - Keeping it here also means `lib/common/` does not have to invert the
 *   dependency direction (lib/common stays extension-agnostic).
 *
 * Public surface:
 * - {@link buildToggleExtensionAction}: returns a `CommandPanelAction`
 *   row labeled "Disable this extension" / "Enable this extension"
 *   depending on the current state. Returns `null` for `alwaysActive`
 *   extensions so callers can spread the result into an actions array
 *   without an extra branch.
 * - {@link performToggleExtension}: flips the disabled set in the
 *   appropriate scope (project > global, mirroring
 *   {@link resolveEffectiveScope}), notifies the user, and triggers a
 *   reload so the change takes effect.
 */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SF_PI_REGISTRY } from "../../../catalog/registry.ts";
import { isSfPiExtensionEnabled } from "../../../lib/common/sf-pi-extension-state.ts";
import type { CommandPanelAction } from "../../../lib/common/command-panel.ts";
import {
  applyExtensionState,
  findPackageInSettings,
  getDisabledExtensions,
  resolveEffectiveScope,
} from "./package-state.ts";

/**
 * Stable group label used by every panel that adopts the shared toggle
 * action. Exported so individual extensions can also place a "Close"
 * action in the same group for visual consistency.
 */
export const LIFECYCLE_GROUP = "Lifecycle";

/**
 * The lifecycle action ids reserved by this helper. Extensions should not
 * reuse these values for unrelated actions, or the toggle wiring breaks.
 */
export type LifecycleActionId = "lifecycle.toggle";

export interface BuildToggleActionOptions {
  /** sf-pi extension id, e.g. "sf-data360". */
  extensionId: string;
  /** Resolves the cwd at action build time. Pass `() => ctx.cwd`. */
  cwd: string;
}

/**
 * Build the toggle action row, or return `null` when the extension is
 * `alwaysActive` (sf-pi-manager, sf-brain) and therefore cannot be
 * toggled at all. Callers are expected to treat `null` as "skip this row".
 */
export function buildToggleExtensionAction(
  options: BuildToggleActionOptions,
): CommandPanelAction<LifecycleActionId> | null {
  const ext = SF_PI_REGISTRY.find((e) => e.id === options.extensionId);
  if (!ext) return null;
  if (ext.alwaysActive) return null;

  const enabled = isSfPiExtensionEnabled(options.cwd, ext.id);
  return {
    value: "lifecycle.toggle",
    label: enabled ? "Disable this extension" : "Enable this extension",
    description: enabled
      ? `Add an exclusion for ${ext.id} to your sf-pi settings and reload. Re-enable later with /sf-pi enable ${ext.id}.`
      : `Remove the exclusion for ${ext.id} from your sf-pi settings and reload so its tools, skills, and commands return.`,
    group: LIFECYCLE_GROUP,
  };
}

/**
 * Flip the disabled state for the given extension in the appropriate
 * settings scope (project > global), notify the user, and trigger a
 * reload so pi re-reads the filter list.
 *
 * Behavior:
 * - `alwaysActive` extensions are a no-op; we surface a warning so panels
 *   that incorrectly forward the toggle still produce a clear message
 *   instead of silently doing nothing.
 * - When sf-pi is not installed in either scope, we surface a friendly
 *   warning that points at /sf-pi instead of crashing.
 */
export async function performToggleExtension(
  ctx: ExtensionCommandContext,
  extensionId: string,
): Promise<void> {
  const ext = SF_PI_REGISTRY.find((e) => e.id === extensionId);
  if (!ext) {
    ctx.ui.notify(`Unknown sf-pi extension: ${extensionId}.`, "warning");
    return;
  }
  if (ext.alwaysActive) {
    ctx.ui.notify(`${ext.name} is always active and cannot be toggled.`, "warning");
    return;
  }

  const scope = resolveEffectiveScope(ctx.cwd);
  const match = findPackageInSettings(ctx.cwd, scope);
  if (!match) {
    ctx.ui.notify(
      `sf-pi package not found in project or global settings. Install with: pi install . (project) or pi install -g <source> (global).`,
      "warning",
    );
    return;
  }

  const disabledFiles = getDisabledExtensions(match.settingsPath);
  const wasEnabled = !disabledFiles.has(ext.file);
  if (wasEnabled) {
    disabledFiles.add(ext.file);
  } else {
    disabledFiles.delete(ext.file);
  }
  applyExtensionState(match, disabledFiles);

  const verb = wasEnabled ? "disabled" : "enabled";
  ctx.ui.notify(`${ext.name} ${verb}. Reloading…`, "info");
  await ctx.reload();
}
