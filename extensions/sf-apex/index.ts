/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-apex behavior contract
 *
 * SF Apex is a lean Apex Lifecycle Extension: it owns Apex authoring guidance,
 * bounded diagnostics, trace/log/watch, Anonymous Apex probes, and targeted
 * tests while leaving source edits to normal Pi file tools.
 *
 * Behavior matrix:
 *
 *   Event/Trigger          | Result
 *   -----------------------|--------------------------------------------
 *   session_start          | Register the sf_apex lifecycle tool
 *   /sf-apex (no args)     | Open the extension in the SF Pi Manager-style panel
 *   /sf-apex status        | Print status as plain text (headless-safe)
 *   /sf-apex help          | Print command usage as plain text
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
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
import { clearConnectionCache } from "../../lib/common/sf-conn/connection.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { registerSfApexTool } from "./lib/sf-apex-tool.ts";
import { diagnoseApexFile, isApexFile, resolveToolPath } from "./lib/diagnostics.ts";

const COMMAND_NAME = "sf-apex";

type SfApexAction = "status" | "help" | "close" | LifecycleActionId;

const SF_APEX_ACTIONS: CommandPanelAction<SfApexAction>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Print current SF Apex extension status.",
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
  if (!requirePiVersion(pi, "sf-apex")) return;

  pi.on("session_start", async () => {
    clearConnectionCache();
    registerSfApexTool(pi);
  });
  pi.on("session_shutdown", async () => clearConnectionCache());
  pi.on("tool_result", async (event, ctx) => handleToolResult(event, ctx));

  pi.registerCommand(COMMAND_NAME, {
    description: "SF Apex — Apex lifecycle status & controls",
    getArgumentCompletions: (prefix: string) =>
      getFirstTokenCompletionsFromActions(SF_APEX_ACTIONS, prefix, {
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
  const state: CommandPanelState<SfApexAction> = {};
  await openCommandPanel(ctx, {
    title: "⚡ SF Apex — lifecycle",
    subtitle:
      "API-native Apex authoring guidance, diagnostics, trace/logs, Anonymous Apex, and targeted tests.",
    statusLines: () => [
      "• Tool: sf_apex",
      "• Hot path: API-native, no sf apex subprocess fallback",
      "• Diagnostics: Apex-owned handoff in progress; existing sf-lsp remains fallback",
      "• Evidence: raw logs/results stored as Apex Artifacts",
    ],
    actions: () => buildActions(ctx.cwd),
    closeValue: "close",
    state,
    closeBeforeAction: isLifecycleToggleAction,
    onAction: (action) => handleAction(ctx, action, true),
  });
}

async function handleToolResult(event: ToolResultEvent, ctx: ExtensionContext) {
  if (event.isError || !isFileMutationToolResult(event)) return undefined;
  const rawPath = event?.input?.path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") return undefined;
  const filePath = resolveToolPath(rawPath, ctx.cwd);
  if (!filePath || !isApexFile(filePath)) return undefined;

  const result = await diagnoseApexFile(filePath, ctx.cwd);
  if (result.details.ok === true && result.details.status === "clean") return undefined;

  const existingContent = Array.isArray(event.content) ? event.content : [];
  return {
    content: [
      ...existingContent,
      {
        type: "text" as const,
        text: `\n\nSF Apex diagnostics:\n${result.content[0]?.text ?? ""}`,
      },
    ],
    details: {
      ...(typeof event.details === "object" && event.details ? event.details : {}),
      sf_apex_diagnostics: result.details,
    },
  };
}

function isFileMutationToolResult(event: ToolResultEvent): boolean {
  return event.toolName === "write" || event.toolName === "edit";
}

function buildActions(cwd: string): CommandPanelAction<SfApexAction>[] {
  const toggle = buildToggleExtensionAction({ extensionId: "sf-apex", cwd });
  return toggle ? [...SF_APEX_ACTIONS, toggle] : SF_APEX_ACTIONS;
}

async function handleAction(
  ctx: ExtensionCommandContext,
  action: string,
  fromPanel: boolean,
): Promise<void> {
  if (action === "close") return;
  if (action === "lifecycle.toggle") {
    await performToggleExtension(ctx, "sf-apex");
    return;
  }
  if (action === "status") {
    await emitOutput(ctx, "SF Apex status", statusText(), "info", fromPanel);
    return;
  }
  if (action === "help") {
    await emitOutput(ctx, "SF Apex help", helpText(), "info", fromPanel);
    return;
  }
  await emitOutput(
    ctx,
    "SF Apex — unknown subcommand",
    `Unknown /${COMMAND_NAME} subcommand: ${action}`,
    "warning",
    fromPanel,
  );
}

function statusText(): string {
  return [
    "SF Apex is installed.",
    "Use the sf_apex tool for API-native Apex lifecycle workflows.",
    "Use /sf-apex with no args for the interactive panel.",
  ].join("\n");
}

function helpText(): string {
  return [
    "Commands:",
    "  /sf-apex          Open the SF Apex panel",
    "  /sf-apex status   Print extension status",
    "  /sf-apex help     Print this help",
    "",
    "Tool actions:",
    "  status, org.preflight, apex.search",
    "  test.discover, test.plan, coverage.summary",
    "  author.plan, diagnose.file",
    "  trace.start, trace.stop, trace.status",
    "  log.latest, log.get, log.analyze, log.watch",
    "  anon.run",
    "  test.run, test.result, test.rerun",
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
