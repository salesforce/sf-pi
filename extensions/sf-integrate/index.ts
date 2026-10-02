/* SPDX-License-Identifier: Apache-2.0 */
/** SF Integrate extension entry point. */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  getFirstTokenCompletionsFromActions,
  type SfPiCommandAction,
} from "../../lib/common/command-actions.ts";
import type { InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import { openExtensionInManager } from "../../lib/common/manager-deep-link.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { createSecureCredentialPromptBridge } from "../../lib/common/secure-credential-prompt.ts";
import { beginSalesforceConnectionSession } from "../../lib/common/sf-conn/index.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { registerSfIntegrateTool } from "./lib/sf-integrate-tool.ts";

const COMMAND_NAME = "sf-integrate";
type SfIntegrateCommandAction = "status" | "help";

const ACTIONS: SfPiCommandAction<SfIntegrateCommandAction>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Print current SF Integrate extension status.",
    group: "Diagnostics",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command and tool usage.",
    group: "Reference",
  },
];

export default function sfIntegrate(pi: ExtensionAPI): void {
  if (!requirePiVersion(pi, "sf-integrate")) return;

  const secretPrompt = createSecureCredentialPromptBridge({
    title: "Outbound credential secret",
    description:
      "The value is sent directly to Salesforce, masked, and never added to the session.",
  });
  pi.on("session_start", async (event, ctx) => {
    beginSalesforceConnectionSession(event);
    secretPrompt.bind(ctx.ui, ctx.mode);
    registerSfIntegrateTool(pi, { promptSecret: (signal) => secretPrompt.prompt(signal) });
  });
  pi.on("session_shutdown", async () => secretPrompt.clear());

  pi.registerCommand(COMMAND_NAME, {
    description: "SF Integrate — inbound OAuth and outbound credential lifecycle",
    getArgumentCompletions: (prefix: string) =>
      getFirstTokenCompletionsFromActions(ACTIONS, prefix),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const action = (args ?? "").trim().toLowerCase();
        if (action === "" && ctx.hasUI) {
          await openInManager(pi, ctx);
          return;
        }
        await handleAction(ctx, action === "" ? "status" : action);
      });
    },
  });
}

async function openInManager(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const opened = await openExtensionInManager(pi, ctx, {
    extensionId: COMMAND_NAME,
    view: "detail",
  });
  if (!opened) {
    ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-integrate.", "warning");
  }
}

async function handleAction(ctx: ExtensionCommandContext, action: string): Promise<void> {
  if (action === "status") {
    await emit(ctx, statusText(), "info");
    return;
  }
  if (action === "help") {
    await emit(ctx, helpText(), "info");
    return;
  }
  await emit(ctx, `Unknown /${COMMAND_NAME} subcommand: ${action}`, "warning");
}

function statusText(): string {
  return [
    "SF Integrate is installed.",
    "Use sf_integrate for Headless 360, the core inbound ECA OAuth matrix, and modern outbound Named Credential setup.",
    "Use /sf-integrate with no args to open its SF Pi Manager detail page.",
  ].join("\n");
}

function helpText(): string {
  return [
    "Commands:",
    "  /sf-integrate          Open SF Integrate in the SF Pi Manager",
    "  /sf-integrate status   Print extension status",
    "  /sf-integrate help     Print this help",
    "",
    "Tool actions:",
    "  status, org.preflight, design.plan, setup.apply",
    "  secret.populate, oauth.authorize, setup.verify",
    "  connection.test, mcp.handoff",
  ].join("\n");
}

async function emit(
  ctx: ExtensionCommandContext,
  body: string,
  severity: InfoPanelSeverity,
): Promise<void> {
  if (ctx.hasUI) {
    ctx.ui.notify(body, severity === "success" ? "info" : severity);
    return;
  }
  console.info(body);
}
