/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-lsp behavior contract
 *
 * - Runs after successful `write` and `edit` tool results
 * - Supports `.agent`, `.cls`, `.trigger`, and LWC bundle `.js` / `.html` files
 * - Appends `LSP feedback: ...` when a supported file has LSP errors
 * - Appends `LSP now clean: ...` only when a previously failing file becomes clean
 * - Appends `LSP setup note: ...` only once per language per session
 * - Stays advisory only: no blocking and no `isError: true`
 * - Defers `.agent` files to `sf-agentscript-assist` when that extension is
 *   installed (detected via `pi.getCommands()`). When it is not installed, the
 *   existing subprocess LSP path runs as a fallback.
 *
 * Behavior matrix:
 *
 *   Event/Trigger         | Condition                             | Result
 *   ----------------------|---------------------------------------|-------------------------------------------
 *   session_start         | always                                | Reset LSP session state
 *   session_shutdown      | always                                | Reset state, shut down LSP servers
 *   tool_result (write)   | supported SF file                     | Append LSP diagnostics or clean note
 *   tool_result (edit)    | supported SF file                     | Append LSP diagnostics or clean note
 *   tool_result (*)       | .agent file AND assist is installed   | Silent (sf-agentscript-assist handles it)
 *   tool_result (other)   | —                                     | Ignored
 *   tool_result (error)   | any                                   | Ignored (don't diagnose failed writes)
 *   /sf-lsp               | no args or "doctor"                   | Show LSP availability report
 *   /sf-lsp               | unknown subcommand                    | Show usage hint
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@mariozechner/pi-coding-agent";
import { isEditToolResult, isWriteToolResult } from "@mariozechner/pi-coding-agent";
import { getLspDiagnosticsForFile, doctorLsp, shutdownLspClients } from "./lib/lsp-client.ts";
import { getSfLspLanguageForFile, resolveToolPath } from "./lib/file-classify.ts";
import {
  createState,
  resetState,
  buildToolResultUpdate,
  renderDoctorReport,
  type SfLspState,
  type ToolResultContentPart,
} from "./lib/feedback.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

/** How long to wait for LSP diagnostics before giving up. */
const DIAGNOSTIC_TIMEOUT_MS = 6000;

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export default function sfLspExtension(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-lsp")) return;

  const state = createState();

  registerDoctorCommand(pi);
  registerSessionHooks(pi, state);
  registerToolResultHook(pi, state);
}

// -------------------------------------------------------------------------------------------------
// /sf-lsp command
// -------------------------------------------------------------------------------------------------

function registerDoctorCommand(pi: ExtensionAPI): void {
  pi.registerCommand("sf-lsp", {
    description: "Show Salesforce LSP diagnostics",
    handler: async (args, ctx) => {
      const subcommand = args.trim();

      if (subcommand === "" || subcommand === "doctor") {
        const statuses = await doctorLsp(ctx.cwd);
        const hasUnavailable = statuses.some((status) => !status.available);
        const severity = hasUnavailable ? "warning" : "info";

        if (ctx.hasUI) {
          ctx.ui.notify(renderDoctorReport(statuses), severity);
        }

        return;
      }

      if (ctx.hasUI) {
        ctx.ui.notify("Usage: /sf-lsp [doctor]", "warning");
      }
    },
  });
}

// -------------------------------------------------------------------------------------------------
// Session lifecycle hooks
// -------------------------------------------------------------------------------------------------

function registerSessionHooks(pi: ExtensionAPI, state: SfLspState): void {
  pi.on("session_start", async () => {
    resetState(state);
  });

  pi.on("session_shutdown", async (event) => {
    resetState(state);
    // Skip expensive LSP server shutdown on reload — servers will be reused
    // in the new extension instance. Only tear down on actual session exit.
    if (event.reason !== "reload") {
      await shutdownLspClients();
    }
  });
}

// -------------------------------------------------------------------------------------------------
// Tool result hook
// -------------------------------------------------------------------------------------------------

function registerToolResultHook(pi: ExtensionAPI, state: SfLspState): void {
  pi.on("tool_result", async (event, ctx) => {
    return await handleToolResult(pi, event, ctx, state);
  });
}

/**
 * True when sf-agentscript-assist is loaded and owns `.agent` feedback. We
 * detect it by looking for its slash command in the session's command
 * registry. Using `pi.getCommands()` avoids any hardcoded peer-extension
 * contract and works even if the user renames or reorganizes extensions.
 */
function isAgentScriptAssistInstalled(pi: ExtensionAPI): boolean {
  try {
    return pi.getCommands().some((command) => command.name === "sf-agentscript-assist");
  } catch {
    return false;
  }
}

/**
 * Full runtime flow for one completed tool result.
 */
async function handleToolResult(
  pi: ExtensionAPI,
  event: ToolResultEvent,
  ctx: ExtensionContext,
  state: SfLspState,
) {
  // Only process successful write/edit results
  if (event.isError) return undefined;
  if (!isEditToolResult(event) && !isWriteToolResult(event)) return undefined;

  // Extract and validate the file path
  const rawPath = event?.input?.path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") return undefined;

  const filePath = resolveToolPath(rawPath, ctx.cwd);
  const language = getSfLspLanguageForFile(filePath);
  if (!language) return undefined;

  // Defer .agent files to sf-agentscript-assist when it's loaded. We probe
  // the command registry per-call (instead of caching) because extensions
  // can be enabled/disabled during a session without a reload.
  if (language === "agentscript" && isAgentScriptAssistInstalled(pi)) {
    return undefined;
  }

  // Get diagnostics from the LSP server
  const lspResult = await getLspDiagnosticsForFile(
    language,
    filePath,
    ctx.cwd,
    DIAGNOSTIC_TIMEOUT_MS,
  );

  // Get existing content to append to
  const existingContent: ToolResultContentPart[] = Array.isArray(event.content)
    ? event.content
    : [];

  // Build the tool result update (or undefined to leave it unchanged)
  return buildToolResultUpdate({
    filePath,
    language,
    existingContent,
    existingDetails: event.details,
    lspResult,
    state,
  });
}
