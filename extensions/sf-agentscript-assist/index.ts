/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-agentscript-assist behavior contract
 *
 * - Runs after successful `write` and `edit` tool results on `.agent` files.
 * - Uses the vendored `@agentscript/agentforce` SDK to parse + compile the
 *   file in-process. No subprocess, no LSP, no VS Code dependency.
 * - Appends:
 *     `LSP feedback: <file>` when parse/compile produces actionable findings,
 *     `LSP now clean: <file>` only when a previously broken file goes green,
 *     `LSP setup note: ...` once per session when the SDK can't load.
 * - Stays silent when a file has no findings and has never been broken.
 * - On the first feedback per file per session, the feedback includes a
 *   one-line dialect banner (`agentforce 2.5`) so the agent knows what it's
 *   working with.
 *
 * Behavior matrix:
 *
 *   Event/Trigger         | Condition                            | Result
 *   ----------------------|--------------------------------------|-----------------------------------------
 *   session_start         | always                               | Reset state
 *   session_shutdown      | always                               | Reset state
 *   tool_result (write)   | .agent file + SDK ok + findings      | Append LSP feedback block (with fixes)
 *   tool_result (edit)    | .agent file + SDK ok + findings      | Append LSP feedback block (with fixes)
 *   tool_result (*)       | .agent file + was broken, now clean  | Append LSP now clean note
 *   tool_result (*)       | .agent file + SDK fails (first time) | Append LSP setup note
 *   tool_result (*)       | unsupported file                     | Silent
 *   tool_result (error)   | any                                  | Silent (don't diagnose failed writes)
 *   /sf-agentscript-assist| no args or "doctor"                  | Show SDK doctor report
 *   /sf-agentscript-assist| "check" or "check <path>"            | Manually diagnose a file
 *   /sf-agentscript-assist| unknown subcommand                   | Show usage hint
 *
 * Precedence with sf-lsp: this extension handles `.agent` files entirely.
 * The sf-lsp extension reads `pi.getCommands()` to check whether
 * `/sf-agentscript-assist` is registered and, when it is, skips its own
 * `.agent` LSP subprocess path. If a user disables this extension, sf-lsp
 * falls back to the old subprocess behavior with no configuration required.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolResultEvent,
} from "@mariozechner/pi-coding-agent";
import { isEditToolResult, isWriteToolResult } from "@mariozechner/pi-coding-agent";
import { checkAgentScriptFile } from "./lib/diagnostics.ts";
import { isAgentScriptFile, resolveToolPath } from "./lib/file-classify.ts";
import {
  buildToolResultUpdate,
  createState,
  renderErrorFeedback,
  resetState,
  type AgentScriptAssistState,
  type ToolResultContentPart,
} from "./lib/feedback.ts";
import { probeDoctor, renderDoctorReport } from "./lib/doctor.ts";
import { type CommandPanelAction, openCommandPanel } from "../../lib/common/command-panel.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";

// -------------------------------------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------------------------------------

export default function sfAgentScriptAssistExtension(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-agentscript-assist")) return;

  const state = createState();

  registerCommand(pi, state);
  registerSessionHooks(pi, state);
  registerToolResultHook(pi, state);
}

// -------------------------------------------------------------------------------------------------
// /sf-agentscript-assist
// -------------------------------------------------------------------------------------------------

function registerCommand(pi: ExtensionAPI, state: AgentScriptAssistState): void {
  pi.registerCommand("sf-agentscript-assist", {
    description: "Agent Script in-process diagnostics and quick fixes",
    getArgumentCompletions: (prefix) => {
      const lower = prefix.toLowerCase();
      const items = AGENTSCRIPT_ACTIONS.filter((action) => action.value !== "close")
        .filter((action) => action.value.startsWith(lower))
        .map((action) => ({
          value: action.value,
          label: action.value,
          description: action.description,
        }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const subcommand = tokens[0] ?? "";

      if (subcommand === "" && ctx.hasUI) {
        await handleAgentScriptPanel(ctx, state);
        return;
      }

      await handleAgentScriptCommand(
        ctx,
        state,
        subcommand === "" ? "doctor" : subcommand,
        tokens.slice(1),
      );
    },
  });
}

type AgentScriptAction = "doctor" | "check" | "help" | "close";

const AGENTSCRIPT_ACTIONS: CommandPanelAction<AgentScriptAction>[] = [
  {
    value: "doctor",
    label: "Run doctor",
    description: "Show SDK load status, vendored bundle path, and current Agent Script readiness.",
    group: "Diagnostics",
  },
  {
    value: "check",
    label: "Check a file",
    description: "Prompt for a .agent file path and run one manual parse/compile diagnostic pass.",
    group: "Diagnostics",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command usage and explain when to use doctor versus check.",
    group: "Reference",
  },
  {
    value: "close",
    label: "Close",
    description: "Dismiss this panel.",
    group: "Reference",
  },
];

async function handleAgentScriptPanel(
  ctx: ExtensionCommandContext,
  state: AgentScriptAssistState,
): Promise<void> {
  for (;;) {
    const doctor = await probeDoctor(ctx.cwd);
    const action = await openCommandPanel(ctx, {
      title: "🧭 SF Agent Script Assist — status & controls",
      statusLines: [
        `${doctor.sdkLoaded ? "✓" : "✗"} SDK           ${doctor.sdkLoaded ? "loaded" : "unavailable"}`,
        `• Vendored path ${doctor.vendoredSdkPath}`,
        `• Session files ${state.lastStatusByFile.size} tracked file(s)`,
      ],
      actions: AGENTSCRIPT_ACTIONS,
      closeValue: "close",
    });

    if (!action || action === "close") return;
    await handleAgentScriptCommand(ctx, state, action, []);
  }
}

async function handleAgentScriptCommand(
  ctx: ExtensionCommandContext,
  state: AgentScriptAssistState,
  subcommand: string,
  args: string[],
): Promise<void> {
  if (subcommand === "doctor") {
    const status = await probeDoctor(ctx.cwd);
    if (ctx.hasUI) {
      ctx.ui.notify(renderDoctorReport(status), status.sdkLoaded ? "info" : "warning");
    }
    return;
  }

  if (subcommand === "check") {
    let inputPath = args.join(" ").trim();
    if (!inputPath && ctx.hasUI) {
      inputPath =
        (await ctx.ui.input("Agent Script file to check", "path/to/file.agent"))?.trim() ?? "";
    }
    await handleCheckSubcommand(inputPath, ctx, state);
    return;
  }

  if (subcommand === "help") {
    ctx.ui.notify(renderAgentScriptHelp(), "info");
    return;
  }

  if (ctx.hasUI) {
    ctx.ui.notify("Usage: /sf-agentscript-assist [doctor | check <file> | help]", "warning");
  }
}

function renderAgentScriptHelp(): string {
  return [
    "sf-agentscript-assist — in-process .agent diagnostics",
    "",
    "Commands:",
    "  /sf-agentscript-assist              Open status & controls panel",
    "  /sf-agentscript-assist doctor       Show SDK load status and vendored path",
    "  /sf-agentscript-assist check <file> Run one manual diagnostic pass",
    "  /sf-agentscript-assist help         Show this help",
  ].join("\n");
}

/**
 * Implement `/sf-agentscript-assist check [file]`.
 *
 * When no file is passed, we explain the usage. We intentionally do not
 * default to a glob or whole-workspace scan in this first version — this
 * command is for point-in-time verification, not full linting.
 */
async function handleCheckSubcommand(
  inputPath: string,
  ctx: ExtensionContext,
  state: AgentScriptAssistState,
): Promise<void> {
  if (!inputPath) {
    if (ctx.hasUI) {
      ctx.ui.notify("Usage: /sf-agentscript-assist check <path/to/file.agent>", "warning");
    }
    return;
  }

  const filePath = resolveToolPath(inputPath, ctx.cwd);
  if (!isAgentScriptFile(filePath)) {
    if (ctx.hasUI) {
      ctx.ui.notify(`Not an Agent Script file: ${filePath}`, "warning");
    }
    return;
  }

  const result = await checkAgentScriptFile(filePath);
  if (!result.ok) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        `Agent Script SDK unavailable: ${result.unavailableReason ?? "unknown reason"}`,
        "warning",
      );
    }
    return;
  }

  // Update session state so future writes get accurate "now clean" feedback.
  if (result.diagnostics.length > 0) {
    state.lastStatusByFile.set(filePath, "error");
  } else {
    state.lastStatusByFile.set(filePath, "clean");
  }
  state.dialectReportedByFile.add(filePath);

  if (!ctx.hasUI) return;

  if (result.diagnostics.length === 0) {
    ctx.ui.notify(`Agent Script check: ${filePath} is clean.`, "info");
    return;
  }

  // Build the same feedback block we would have appended to a tool_result,
  // minus the state mutation.
  const rendered = renderErrorFeedback(filePath, null, result.diagnostics, result.quickFixes);
  ctx.ui.notify(rendered, "warning");
}

// -------------------------------------------------------------------------------------------------
// Session lifecycle
// -------------------------------------------------------------------------------------------------

function registerSessionHooks(pi: ExtensionAPI, state: AgentScriptAssistState): void {
  pi.on("session_start", async () => {
    resetState(state);
  });

  pi.on("session_shutdown", async () => {
    resetState(state);
  });
}

// -------------------------------------------------------------------------------------------------
// tool_result hook
// -------------------------------------------------------------------------------------------------

function registerToolResultHook(pi: ExtensionAPI, state: AgentScriptAssistState): void {
  pi.on("tool_result", async (event, ctx) => {
    return await handleToolResult(event, ctx, state);
  });
}

async function handleToolResult(
  event: ToolResultEvent,
  ctx: ExtensionContext,
  state: AgentScriptAssistState,
) {
  if (event.isError) return undefined;
  if (!isEditToolResult(event) && !isWriteToolResult(event)) return undefined;

  const rawPath = event?.input?.path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") return undefined;

  const filePath = resolveToolPath(rawPath, ctx.cwd);
  if (!isAgentScriptFile(filePath)) return undefined;

  const checkResult = await checkAgentScriptFile(filePath);
  const existingContent: ToolResultContentPart[] = Array.isArray(event.content)
    ? event.content
    : [];

  return buildToolResultUpdate({
    filePath,
    existingContent,
    existingDetails: event.details,
    checkResult,
    state,
  });
}
