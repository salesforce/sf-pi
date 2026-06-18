/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-data360 behavior contract
 *
 * Data Cloud / Data 360 direct REST helper for sf-pi.
 *
 * Design:
 * - No MCP server/client support.
 * - No 180 always-on generated operation tools.
 * - One pi-native v2 family tool surface (`data360_*`) over the shared
 *   action registry/dispatcher, plus plain reference docs for progressive
 *   disclosure.
 * - sf-data360 does not contribute Agent Skills; disabling the extension removes
 *   its tools on reload/new sessions.
 *
 * Behavior matrix:
 *
 *   Event/Trigger          | Result
 *   -----------------------|-----------------------------------------------------------
 *   extension load         | Register data360_* family tools and /sf-data360
 *   session_start          | Re-register tools if enabled; clear cached @salesforce/core Org
 *   session_shutdown       | Clear cached @salesforce/core Org so resume re-auths cleanly
 *   resources_discover     | Re-register tools on reload; no skill contribution
 *   /sf-data360 (no args)  | Open standardized command panel (status/help/close)
 *   /sf-data360 status     | Print enablement, tools, target org, and API version
 *   /sf-data360 help       | Print command usage
 *   data360_* dry_run      | Resolve action/org/safety without calling Salesforce
 *   data360_* read         | Call Data 360 REST endpoint via @salesforce/core Connection
 *   data360_* mutating     | Confirm dangerous calls according to safety policy
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import {
  type SfPiCommandAction,
  formatHelpFromActions,
  getCompletionsFromActions,
  resolveAction,
} from "../../lib/common/command-actions.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import {
  openExtensionInManager,
  type SfPiManagerOpenRoute,
} from "../../lib/common/manager-deep-link.ts";
import {
  registerManagerDetailActions,
  type ManagerDetailAction,
} from "../../lib/common/manager-actions.ts";
import { buildExecFn } from "../../lib/common/exec-adapter.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../lib/common/sf-environment/shared-runtime.ts";
import type { SfEnvironment } from "../../lib/common/sf-environment/types.ts";
import { clearConnectionCache } from "../../lib/common/sf-conn/connection.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { isSfPiExtensionEnabled } from "../../lib/common/sf-pi-extension-state.ts";
import { registerData360V2Tools, DATA360_V2_TOOL_DEFS } from "./lib/v2/tools.ts";
import { registerExtensionDoctor } from "../../lib/common/doctor/registry.ts";
import { buildSfData360Doctor } from "./lib/extension-doctor.ts";

const COMMAND_NAME = "sf-data360";
export default function sfData360(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-data360")) return;

  let toolsRegistered = false;

  function ensureToolsRegistered(): void {
    if (toolsRegistered) return;
    registerData360V2Tools(pi);
    toolsRegistered = true;
  }

  pi.on("session_start", (event, ctx) => {
    // /reload can reuse the same extension closure. Re-register on reload so
    // tool schemas, renderers, and registry-backed closures pick up code/data
    // changes without requiring a full pi restart.
    if (event.reason === "reload") toolsRegistered = false;
    if (isSfPiExtensionEnabled(ctx.cwd, "sf-data360")) ensureToolsRegistered();
    // Drop the cached @salesforce/core Org so resumed sessions re-auth and
    // pick up any token refresh that happened outside this process. Cache
    // is global; clearing it here is harmless when other extensions also
    // wire the same hook.
    clearConnectionCache();
  });
  pi.on("session_shutdown", () => {
    toolsRegistered = false;
    clearConnectionCache();
  });

  registerManagerDetailActions(pi, "sf-data360", buildSfData360ManagerActions(pi));

  // Contribute a small org-connectivity + readiness probe to the
  // aggregated `/sf-pi doctor` view. Deep readiness remains available through
  // data360_discover readiness actions.
  registerExtensionDoctor("sf-data360", buildSfData360Doctor(pi));

  pi.on("resources_discover", (event) => {
    if (!isSfPiExtensionEnabled(event.cwd, "sf-data360")) return;
    if (event.reason === "reload") {
      toolsRegistered = false;
      ensureToolsRegistered();
    }
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "Show Data 360 family-tool status and usage",
    // Single source of truth for completions — SF_DATA360_ACTIONS drives
    // the panel rows, the completions, and the auto-generated help block.
    getArgumentCompletions: (prefix: string) =>
      getCompletionsFromActions(SF_DATA360_ACTIONS, prefix.trim().split(/\s+/).at(-1) ?? "", {
        excludeValues: ["close", "lifecycle.toggle"],
      }),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, () => handleCommand(pi, ctx, args || ""));
    },
  });
}

// Action ids for the /sf-data360 settings panel. Mirrors the pattern used by
// sf-slack, sf-agentscript, sf-guardrail, sf-llm-gateway-internal,
// etc. so users get the same standardized command-panel UX everywhere.
type SfData360Action = "status" | "help";

const SF_DATA360_ACTIONS: SfPiCommandAction<SfData360Action>[] = [
  {
    value: "status",
    label: "Show status",
    description:
      "Print enablement, registered tools, target org, and API version for the current cwd.",
    group: "Diagnostics",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command usage and the recommended Data 360 workflow.",
    group: "Reference",
  },
];

function buildSfData360ManagerActions(pi: ExtensionAPI): ManagerDetailAction[] {
  return SF_DATA360_ACTIONS.map((action) => ({
    id: action.value,
    label: action.label,
    description: action.description,
    group: action.group,
    run: (ctx) => handleSfData360Action(pi, ctx, action.value, true),
  }));
}

async function handleCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string,
): Promise<void> {
  const subcommand = args.trim().split(/\s+/)[0] ?? "";

  if (subcommand === "" && ctx.hasUI) {
    await openData360InManager(pi, ctx, "detail");
    return;
  }

  const resolved =
    subcommand === "" ? "status" : (resolveAction(SF_DATA360_ACTIONS, subcommand) ?? subcommand);
  await handleSfData360Action(pi, ctx, resolved, false);
}

async function openData360InManager(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  view: NonNullable<SfPiManagerOpenRoute["view"]>,
): Promise<void> {
  const opened = await openExtensionInManager(pi, ctx, {
    extensionId: "sf-data360",
    view,
    actions: buildSfData360ManagerActions(pi),
  });
  if (!opened) {
    ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-data360.", "warning");
  }
}

async function handleSfData360Action(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  action: SfData360Action | string,
  fromPanel: boolean,
): Promise<void> {
  const enabled = isSfPiExtensionEnabled(ctx.cwd, "sf-data360");

  if (action === "help") {
    await emitOutput(ctx, "SF Data 360 help", buildHelpText(enabled), "info", fromPanel);
    return;
  }

  if (action === "status") {
    const exec = buildExecFn(pi);
    const env = getCachedSfEnvironment(ctx.cwd) ?? (await getSharedSfEnvironment(exec, ctx.cwd));
    await emitOutput(ctx, "SF Data 360 status", buildStatusText(enabled, env), "info", fromPanel);
    return;
  }

  // Unknown subcommand from a headless invocation. From the panel this is
  // unreachable because action is constrained to SfData360Action.
  await emitOutput(
    ctx,
    "SF Data 360 — unknown subcommand",
    `Unknown /${COMMAND_NAME} subcommand: ${action}\n\n${buildHelpText(enabled)}`,
    "warning",
    fromPanel,
  );
}

function formatData360ToolNames(): string {
  return DATA360_V2_TOOL_DEFS.map((tool) => tool.name).join(", ");
}

function buildStatusText(enabled: boolean, env: SfEnvironment): string {
  return [
    "SF Data 360 — status",
    "",
    `Enabled: ${enabled ? "yes (default)" : "no (re-enable with /sf-pi enable sf-data360)"}`,
    `Tools: ${enabled ? formatData360ToolNames() : "not registered"}`,
    `References: extensions/sf-data360/references/`,
    `SF CLI: ${env.cli.installed ? (env.cli.version ?? "installed") : "not installed"}`,
    `Target org: ${env.config.targetOrg ?? "not configured"}`,
    `Org type: ${env.org.orgType}`,
    `API version: ${env.org.apiVersion ?? env.project.sourceApiVersion ?? "66.0"}`,
    "",
    "Use data360_* family tools for Data 360 work; read extensions/sf-data360/references/ for deeper guidance.",
  ].join("\n");
}

// Standard panel-output emit: route through openInfoPanel when invoked from
// the settings panel so the result lands in the same popup surface the
// rest of the suite uses (sf-slack, sf-devbar, sf-guardrail, ...). Direct
// command-line invocations get a plain notify (small, dismissable), and
// headless mode falls through to stdout so `pi -p /sf-data360 status`
// still prints something useful.
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

function buildHelpText(enabled: boolean): string {
  return [
    "SF Data 360 — agent-first family tools",
    "",
    formatHelpFromActions(SF_DATA360_ACTIONS, COMMAND_NAME),
    "",
    "Enablement:",
    `  Default state: enabled`,
    `  Current state: ${enabled ? "enabled" : "disabled by user settings"}`,
    `  Re-enable: /sf-pi enable sf-data360`,
    `  Disable: /sf-pi disable sf-data360`,
    "",
    "Tools when enabled:",
    ...DATA360_V2_TOOL_DEFS.map((tool) => `  ${tool.name.padEnd(24)} ${tool.description}`),
    "",
    "Recommended workflow:",
    "  1. Pick the lifecycle family: discover, connect, prepare, harmonize, segment, activate, query, semantic, observe, or orchestrate.",
    "  2. Use actions.search or action.describe inside that family when the exact action is unclear.",
    "  3. Use dry_run:true before confirmed/destructive actions and plan-first orchestrated journeys.",
    "  4. Use data360_api only as the raw REST escape hatch for endpoints not yet promoted to family actions.",
  ].join("\n");
}
