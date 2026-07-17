/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-soql behavior contract
 *
 * SF SOQL is a lean SOQL Lifecycle Extension: it owns schema-aware query
 * describe, validation, explain, bounded execution, and artifacts while leaving
 * source edits to normal Pi file tools and broad exploration to sf-data-explorer.
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
import { clearConnectionCache } from "../../lib/common/sf-conn/connection.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { registerSfSoqlTool } from "./lib/sf-soql-tool.ts";

const COMMAND_NAME = "sf-soql";

type SfSoqlAction = "status" | "help" | "close" | LifecycleActionId;

const SF_SOQL_ACTIONS: CommandPanelAction<SfSoqlAction>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Print current SF SOQL extension status.",
    group: "Diagnostics",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command and tool usage.",
    group: "Reference",
  },
  { value: "close", label: "Close", description: "Dismiss this panel.", group: LIFECYCLE_GROUP },
];

export default function (pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-soql")) return;

  pi.on("session_start", async () => {
    clearConnectionCache();
    registerSfSoqlTool(pi);
  });
  pi.on("session_shutdown", async () => clearConnectionCache());

  pi.registerCommand(COMMAND_NAME, {
    description: "SF SOQL — query lifecycle status & controls",
    getArgumentCompletions: (prefix: string) =>
      getFirstTokenCompletionsFromActions(SF_SOQL_ACTIONS, prefix, {
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
  const state: CommandPanelState<SfSoqlAction> = {};
  await openCommandPanel(ctx, {
    title: "🔎 SF SOQL — query lifecycle",
    subtitle: "API-native schema-aware SOQL validation, query plans, bounded runs, and artifacts.",
    statusLines: () => [
      "• Tool: sf_soql",
      "• Hot path: API-native REST/Tooling, no sf data query subprocess fallback",
      "• Safety: sample/count before broad runs; queryAll is explicit",
      "• Evidence: raw and flattened results stored as SOQL Artifacts",
    ],
    actions: () => buildActions(ctx.cwd),
    closeValue: "close",
    state,
    closeBeforeAction: isLifecycleToggleAction,
    onAction: (action) => handleAction(ctx, action, true),
  });
}

function buildActions(cwd: string): CommandPanelAction<SfSoqlAction>[] {
  const toggle = buildToggleExtensionAction({ extensionId: "sf-soql", cwd });
  return toggle ? [...SF_SOQL_ACTIONS, toggle] : SF_SOQL_ACTIONS;
}

async function handleAction(
  ctx: ExtensionCommandContext,
  action: string,
  fromPanel: boolean,
): Promise<void> {
  if (action === "close") return;
  if (action === "lifecycle.toggle") {
    await performToggleExtension(ctx, "sf-soql");
    return;
  }
  if (action === "status") {
    await emitOutput(ctx, "SF SOQL status", statusText(), "info", fromPanel);
    return;
  }
  if (action === "help") {
    await emitOutput(ctx, "SF SOQL help", helpText(), "info", fromPanel);
    return;
  }
  await emitOutput(
    ctx,
    "SF SOQL — unknown subcommand",
    `Unknown /${COMMAND_NAME} subcommand: ${action}`,
    "warning",
    fromPanel,
  );
}

function statusText(): string {
  return [
    "SF SOQL is installed.",
    "Use the sf_soql tool for API-native SOQL lifecycle workflows.",
    "Use /sf-soql with no args for the interactive panel.",
  ].join("\n");
}

function helpText(): string {
  return [
    "Commands:",
    "  /sf-soql          Open the SF SOQL panel",
    "  /sf-soql status   Print extension status",
    "  /sf-soql help     Print this help",
    "",
    "Tool actions:",
    "  status, org.preflight",
    "  schema.search, schema.describe, schema.relationships",
    "  query.draft, query.validate, query.explain, query.sample",
    "  query.run, query.count, query.queryAll, query.export",
    "  sosl.run, file.diagnose, lsp.status",
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
