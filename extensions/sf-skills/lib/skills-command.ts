/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Subcommand dispatcher for `/sf-skills`.
 *
 * The HUD-visible behavior (summary, help, lifecycle toggle) lives in
 * the extension entry point. This module owns the management
 * subcommands that don't depend on HUD state — currently:
 *
 *   /sf-skills defaults install [project|global]
 *   /sf-skills defaults update  [project|global]
 *   /sf-skills defaults link <path> [project|global]
 *   /sf-skills defaults unlink <path> [project|global] [--delete]
 *   /sf-skills defaults status
 *
 * Each handler is async and self-contained; they never throw out of
 * the extension — errors surface via ctx.ui.notify (or the info panel
 * when invoked from a panel).
 */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { openInfoPanel } from "../../../lib/common/info-panel.ts";
import type { SkillSourceScope } from "../../../lib/common/skill-sources/skill-sources.ts";
import {
  inspectManagedClone,
  installDefaults,
  linkExistingCheckout,
  managedClonePath,
  unlinkCheckout,
  updateDefaults,
} from "./defaults.ts";

// -------------------------------------------------------------------------------------------------
// Argument parsing
// -------------------------------------------------------------------------------------------------

export type DefaultsAction = "status" | "install" | "update" | "link" | "unlink";

export interface DefaultsArgs {
  action: DefaultsAction;
  scope: SkillSourceScope;
  target?: string;
  deleteOnDisk?: boolean;
}

/**
 * Parse the tail after `defaults`.
 *
 * Examples:
 *   ""                                           → status, global
 *   "install"                                    → install, global
 *   "install project"                            → install, project
 *   "link ~/work/afv-library"                    → link, global, target
 *   "link ~/work/afv-library project"            → link, project, target
 *   "unlink ~/work/afv-library --delete"         → unlink, global, target, deleteOnDisk
 */
export function parseDefaultsArgs(
  raw: string,
  defaultScope: SkillSourceScope = "project",
): DefaultsArgs {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const action = (tokens[0] ?? "status").toLowerCase() as DefaultsAction;

  const flags = new Set(tokens.filter((t) => t.startsWith("--")).map((t) => t.toLowerCase()));
  const positional = tokens.slice(1).filter((t) => !t.startsWith("--"));

  // Scope marker (project|global) can appear at any positional slot; pull
  // it out so the remaining slot is unambiguously the target path.
  // Default is "project" (local-first): `defaults install` wires the curated
  // skills into the current project; `defaults install global` is the explicit
  // opt-in for everywhere. The content is cloned once globally either way.
  let scope: SkillSourceScope = defaultScope;
  const scopeIndex = positional.findIndex(
    (t) => t.toLowerCase() === "project" || t.toLowerCase() === "global",
  );
  if (scopeIndex >= 0) {
    const removed = positional.splice(scopeIndex, 1)[0];
    if (removed) scope = removed.toLowerCase() as SkillSourceScope;
  }

  const target = positional[0];
  const knownActions: DefaultsAction[] = ["status", "install", "update", "link", "unlink"];
  const safeAction: DefaultsAction = (knownActions as string[]).includes(action)
    ? action
    : "status";

  return {
    action: safeAction,
    scope,
    target,
    deleteOnDisk: flags.has("--delete"),
  };
}

// -------------------------------------------------------------------------------------------------
// Dispatcher
// -------------------------------------------------------------------------------------------------

export async function handleDefaults(
  ctx: ExtensionCommandContext,
  args: DefaultsArgs,
  emit: (
    title: string,
    body: string,
    level: "info" | "warning" | "error" | "success",
  ) => Promise<void>,
): Promise<void> {
  const projectTrusted = ctx.isProjectTrusted();
  if (args.scope === "project" && args.action !== "status" && !projectTrusted) {
    await emit(
      "Project scope unavailable",
      "Project-scope skill management is unavailable until Pi trusts this project. Use /trust for future sessions, or restart with --approve if you want SF Pi to read or write project-local skill settings.",
      "warning",
    );
    return;
  }

  switch (args.action) {
    case "status":
      await emit(
        "SF Skills defaults",
        renderStatus(ctx.cwd, { includeProject: projectTrusted }),
        "info",
      );
      return;

    case "install": {
      ctx.ui.notify(`Installing afv-library (${args.scope})…`, "info");
      const result = await installDefaults({ scope: args.scope, cwd: ctx.cwd });
      if (!result.ok) {
        await emit("Install failed", result.message, "warning");
        return;
      }
      await emit("Installed", result.message, "info");
      await ctx.reload();
      return;
    }

    case "update": {
      ctx.ui.notify(`Updating afv-library (${args.scope})…`, "info");
      const result = await updateDefaults({ scope: args.scope, cwd: ctx.cwd });
      if (!result.ok) {
        await emit("Update failed", result.message, "warning");
        return;
      }
      await emit(
        "Updated",
        `${result.message}${result.output ? `\n\n${result.output}` : ""}`,
        "info",
      );
      return;
    }

    case "link": {
      if (!args.target) {
        await emit(
          "Usage",
          "/sf-skills defaults link <path> [project|global]\nExample: /sf-skills defaults link ~/work/afv-library",
          "warning",
        );
        return;
      }
      const result = linkExistingCheckout({
        checkoutPath: args.target,
        scope: args.scope,
        cwd: ctx.cwd,
      });
      await emit(
        result.ok ? "Linked" : "Link failed",
        result.message,
        result.ok ? "info" : "warning",
      );
      if (result.ok) await ctx.reload();
      return;
    }

    case "unlink": {
      if (!args.target) {
        await emit(
          "Usage",
          "/sf-skills defaults unlink <path> [project|global] [--delete]\nExample: /sf-skills defaults unlink ~/work/afv-library --delete",
          "warning",
        );
        return;
      }
      const result = unlinkCheckout({
        target: args.target,
        scope: args.scope,
        cwd: ctx.cwd,
        deleteOnDisk: args.deleteOnDisk,
      });
      await emit(
        result.ok ? "Unlinked" : "Unlink failed",
        result.message,
        result.ok ? "info" : "warning",
      );
      if (result.ok) await ctx.reload();
      return;
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Status rendering
// -------------------------------------------------------------------------------------------------

function renderStatus(cwd: string, opts: { includeProject: boolean }): string {
  const lines: string[] = ["forcedotcom/afv-library managed checkouts:", ""];
  for (const scope of ["global", "project"] as const) {
    if (scope === "project" && !opts.includeProject) {
      lines.push("PROJECT");
      lines.push("  status:  unavailable until Pi trusts this project");
      lines.push("");
      continue;
    }

    const targetPath = managedClonePath(scope, cwd);
    const clone = inspectManagedClone(scope, cwd);
    lines.push(`${scope.toUpperCase()}`);
    lines.push(`  path:    ${targetPath}`);
    lines.push(
      `  status:  ${
        !clone.exists
          ? "not installed"
          : clone.managed
            ? clone.wired
              ? "managed · wired"
              : "managed · unwired"
            : "user-owned (no sentinel)"
      }`,
    );
    lines.push(`  wiring:  ${clone.wired ? "in settings.skills[]" : "not in settings.skills[]"}`);
    lines.push("");
  }
  lines.push("Commands:");
  lines.push(
    "  /sf-skills defaults install [project|global]  (default: project; content cloned once globally)",
  );
  lines.push("  /sf-skills defaults update  [project|global]");
  lines.push("  /sf-skills defaults link    <path> [project|global]");
  lines.push("  /sf-skills defaults unlink  <path> [project|global] [--delete]");
  return lines.join("\n");
}

// Re-export for the panel renderer.
export { openInfoPanel };
