/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-lwc behavior contract
 *
 * SF LWC is a lean local-native LWC Lifecycle Extension. It owns local SFDX
 * project scans, component inspection, focused LWC diagnostics, targeted local
 * Jest runs, and artifacts while leaving source edits, deploy/retrieve, visual
 * preview, org source evidence, and broad static analysis to existing SF Pi
 * surfaces.
 *
 * Behavior matrix:
 *
 *   Event/Trigger          | Result
 *   -----------------------|--------------------------------------------
 *   session_start          | Register the sf_lwc lifecycle tool
 *   /sf-lwc (no args)      | Open the extension in the SF Pi Manager panel
 *   /sf-lwc status         | Print status as plain text (headless-safe)
 *   /sf-lwc help           | Print command usage as plain text
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  type CommandPanelAction,
  type CommandPanelState,
  openCommandPanel,
} from "../../lib/common/command-panel.ts";
import { getFirstTokenCompletionsFromActions } from "../../lib/common/command-actions.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import {
  buildToggleExtensionAction,
  isLifecycleToggleAction,
  LIFECYCLE_GROUP,
  performToggleExtension,
  type LifecycleActionId,
} from "../../lib/common/extension-toggle.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { registerSfLwcTool } from "./lib/sf-lwc-tool.ts";

const COMMAND_NAME = "sf-lwc";

type SfLwcAction = "status" | "help" | "close" | LifecycleActionId;

const SF_LWC_ACTIONS: CommandPanelAction<SfLwcAction>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Print current SF LWC extension status.",
    group: "Diagnostics",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command and tool usage.",
    group: "Reference",
  },
  {
    value: "close",
    label: "Close",
    description: "Dismiss this panel.",
    group: LIFECYCLE_GROUP,
  },
];

export default function (pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-lwc")) return;

  pi.on("session_start", async () => {
    registerSfLwcTool(pi);
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "SF LWC — local LWC lifecycle status & controls",
    getArgumentCompletions: (prefix: string) =>
      getFirstTokenCompletionsFromActions(SF_LWC_ACTIONS, prefix, {
        excludeValues: ["close", "lifecycle.toggle"],
      }),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const sub = (args ?? "").trim().toLowerCase();
        if (sub === "" && ctx.hasUI) {
          await handlePanel(ctx);
          return;
        }
        await handleAction(ctx, sub === "" ? "status" : sub, false);
      });
    },
  });
}

async function handlePanel(ctx: ExtensionCommandContext): Promise<void> {
  const state: CommandPanelState<SfLwcAction> = {};
  await openCommandPanel(ctx, {
    title: "🧩 SF LWC — lifecycle",
    subtitle: "Local-native LWC scan, inspect, diagnose, targeted Jest tests, and artifacts.",
    statusLines: () => [
      "• Tool: sf_lwc",
      "• Hot path: local SFDX project + public LWC compiler packages",
      "• Safety: no sf CLI fallback, no deploy/retrieve, no watch mode, no dependency installs",
      "• Evidence: scans, diagnostics, and Jest output stored as LWC Artifacts",
    ],
    actions: () => buildActions(ctx.cwd),
    closeValue: "close",
    state,
    closeBeforeAction: isLifecycleToggleAction,
    onAction: (action) => handleAction(ctx, action, true),
  });
}

function buildActions(cwd: string): CommandPanelAction<SfLwcAction>[] {
  const toggle = buildToggleExtensionAction({ extensionId: "sf-lwc", cwd });
  return toggle ? [...SF_LWC_ACTIONS, toggle] : SF_LWC_ACTIONS;
}

async function handleAction(
  ctx: ExtensionCommandContext,
  action: string,
  fromPanel: boolean,
): Promise<void> {
  if (action === "close") return;
  if (action === "lifecycle.toggle") {
    await performToggleExtension(ctx, "sf-lwc");
    return;
  }
  if (action === "status") {
    await emitOutput(ctx, "SF LWC status", statusText(), "info", fromPanel);
    return;
  }
  if (action === "help") {
    await emitOutput(ctx, "SF LWC help", helpText(), "info", fromPanel);
    return;
  }
  await emitOutput(
    ctx,
    "SF LWC — unknown subcommand",
    `Unknown /${COMMAND_NAME} subcommand: ${action}`,
    "warning",
    fromPanel,
  );
}

function statusText(): string {
  return [
    "SF LWC is installed.",
    "Use the sf_lwc tool for local-native Lightning Web Component lifecycle workflows.",
    "Use /sf-lwc with no args for the interactive panel.",
  ].join("\n");
}

function helpText(): string {
  return [
    "Commands:",
    "  /sf-lwc          Open the SF LWC panel",
    "  /sf-lwc status   Print extension status",
    "  /sf-lwc help     Print this help",
    "",
    "Tool actions:",
    "  status",
    "  project.scan, component.list, component.inspect",
    "  file.diagnose",
    "  test.discover, test.plan, test.run",
    "  history.last, history.rerun",
  ].join("\n");
}

async function emitOutput(
  ctx: ExtensionCommandContext,
  title: string,
  body: string,
  severity: InfoPanelSeverity,
  fromPanel: boolean,
): Promise<void> {
  if (fromPanel && ctx.hasUI) {
    await openInfoPanel(ctx, { title, body, severity });
    return;
  }
  if (ctx.hasUI) {
    ctx.ui.notify(body, severity === "success" ? "info" : severity);
    return;
  }
  console.info(body);
}
