/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-data360 behavior contract
 *
 * Data Cloud / Data 360 direct REST helper for sf-pi.
 *
 * Design:
 * - No MCP server/client support.
 * - No 180 always-on generated operation tools.
 * - One deterministic `d360_api` tool for direct Salesforce REST calls via
 *   `sf api request rest`, one compact `d360_metadata` helper for common DMO/DLO
 *   discovery, plus an extension-owned skill for progressive disclosure.
 * - The skill is contributed only while this extension is enabled. Disabling
 *   sf-data360 removes both the tool and skill on reload/new sessions.
 *
 * Behavior matrix:
 *
 *   Event/Trigger       | Result
 *   --------------------|--------------------------------------------------
 *   extension load      | Register d360_api, d360_metadata, d360_probe, and /sf-data360
 *   resources_discover  | Contribute ./skills so sf-data360 skill is visible
 *   /sf-data360         | Show status/help
 *   d360_api dry_run    | Resolve path/org/safety without calling Salesforce
 *   d360_api read       | Call Data 360 REST endpoint via sf api request rest
 *   d360_api mutating   | Confirm dangerous calls according to safety policy
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import { buildExecFn } from "../../lib/common/exec-adapter.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../lib/common/sf-environment/shared-runtime.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { isSfPiExtensionEnabled } from "../../lib/common/sf-pi-extension-state.ts";
import { D360_TOOL_NAME, registerD360ApiTool } from "./lib/api-tool.ts";
import { D360_METADATA_TOOL_NAME, registerD360MetadataTool } from "./lib/metadata-tool.ts";
import { D360_PROBE_TOOL_NAME, registerD360ProbeTool } from "./lib/probe-tool.ts";

const COMMAND_NAME = "sf-data360";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function sfData360(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-data360")) return;

  let toolsRegistered = false;

  function ensureToolsRegistered(): void {
    if (toolsRegistered) return;
    registerD360ApiTool(pi);
    registerD360MetadataTool(pi);
    registerD360ProbeTool(pi);
    toolsRegistered = true;
  }

  pi.on("session_start", (_event, ctx) => {
    if (isSfPiExtensionEnabled(ctx.cwd, "sf-data360")) ensureToolsRegistered();
  });

  pi.on("resources_discover", (event) => {
    if (!isSfPiExtensionEnabled(event.cwd, "sf-data360")) return;
    return { skillPaths: [path.join(__dirname, "skills")] };
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "Show Data 360 direct REST helper status and usage",
    getArgumentCompletions: (prefix: string) => {
      const current = prefix.trim().split(/\s+/).at(-1)?.toLowerCase() ?? "";
      const options = ["status", "help"];
      const matches = options
        .filter((option) => option.startsWith(current))
        .map((option) => ({ value: option, label: option }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => handleCommand(pi, ctx, args || ""),
  });
}

async function handleCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string,
): Promise<void> {
  const enabled = isSfPiExtensionEnabled(ctx.cwd, "sf-data360");
  const subcommand = args.trim().split(/\s+/)[0] || "status";
  if (subcommand === "help") {
    showInfo(ctx, buildHelpText(enabled));
    return;
  }

  if (subcommand !== "status") {
    showInfo(
      ctx,
      `Unknown /${COMMAND_NAME} subcommand: ${subcommand}\n\n${buildHelpText(enabled)}`,
    );
    return;
  }

  const exec = buildExecFn(pi);
  const env = getCachedSfEnvironment(ctx.cwd) ?? (await getSharedSfEnvironment(exec, ctx.cwd));
  showInfo(
    ctx,
    [
      "SF Data 360 — status",
      "",
      `Enabled: ${enabled ? "yes (default)" : "no (re-enable with /sf-pi enable sf-data360)"}`,
      `Tools: ${enabled ? `${D360_TOOL_NAME}, ${D360_METADATA_TOOL_NAME}, ${D360_PROBE_TOOL_NAME}` : "not registered"}`,
      `Skill: ${enabled ? "sf-data360" : "not registered"} (extension-owned)`,
      `SF CLI: ${env.cli.installed ? (env.cli.version ?? "installed") : "not installed"}`,
      `Target org: ${env.config.targetOrg ?? "not configured"}`,
      `Org type: ${env.org.orgType}`,
      `API version: ${env.org.apiVersion ?? env.project.sourceApiVersion ?? "66.0"}`,
      "",
      "Use /skill:sf-data360 for workflow guidance, or call d360_api directly.",
    ].join("\n"),
  );
}

function showInfo(ctx: ExtensionCommandContext, text: string): void {
  if (ctx.hasUI) {
    ctx.ui.notify(text, "info");
    return;
  }
  // In non-interactive modes, a notification is a no-op. Keep the command
  // useful by printing to stdout.
  console.info(text);
}

function buildHelpText(enabled: boolean): string {
  return [
    "SF Data 360 — direct REST helper",
    "",
    "Commands:",
    `  /${COMMAND_NAME}          Show status`,
    `  /${COMMAND_NAME} help     Show this help`,
    "",
    "Enablement:",
    `  Default state: enabled`,
    `  Current state: ${enabled ? "enabled" : "disabled by user settings"}`,
    `  Re-enable: /sf-pi enable sf-data360`,
    `  Disable: /sf-pi disable sf-data360`,
    "",
    "Tools when enabled:",
    `  ${D360_TOOL_NAME}          Call /services/data/vXX.X Data 360 REST endpoints via sf api request rest`,
    `  ${D360_METADATA_TOOL_NAME}     Compact list/describe helpers for DMOs and DLOs`,
    `  ${D360_PROBE_TOOL_NAME}        Classify Data 360 readiness with read-only probes`,
    "",
    "Recommended workflow:",
    "  1. Use /skill:sf-data360 for workflow and examples.",
    "  2. Use d360_api dry_run:true before mutating calls.",
    "  3. Prefer metadata search and validation endpoints before create/update.",
  ].join("\n");
}
