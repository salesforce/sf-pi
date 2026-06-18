/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-agentscript behavior contract — the single plugin that owns the entire
 * Agent Script lifecycle: authoring assist (compile-on-save), first-class
 * compile tool, multi-turn eval/regression testing against the Salesforce
 * Evaluation API, and a placeholder for the future Agent Script LSP.
 *
 * Behavior matrix:
 *
 *   Event/Trigger             | Result
 *   --------------------------|------------------------------------------------------------
 *   session_start             | Reset assist state
 *   session_shutdown          | Reset assist state
 *   tool_result (write/edit)  | Compile `.agent` files in-process; append LSP feedback
 *   /sf-agentscript           | Open status & controls panel (or run subcommand)
 *   /sf-agentscript doctor    | Show official SDK package status + readiness
 *   /sf-agentscript check     | Manually compile a `.agent` file
 *   /sf-agentscript eval      | Run a multi-turn regression spec
 *   /sf-agentscript help      | Print command usage
 *
 * Tools registered:
 *   - agentscript_authoring   — create, compile, inspect, review, mutate
 *   - agentscript_preview     — live-org preview sessions and traces
 *   - agentscript_eval        — eval specs, regression runs, failure drilldown
 *   - agentscript_lifecycle   — publish, activate, list, and provision
 *
 * Precedence with sf-lsp: this extension owns `.agent` diagnostics. sf-lsp
 * checks `pi.getCommands()` for `sf-agentscript` and yields when present.
 * Disabling sf-agentscript falls sf-lsp back to its subprocess `.agent` LSP path.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { isEditToolResult, isWriteToolResult } from "@earendil-works/pi-coding-agent";
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
import { probeDoctor, renderDoctorReport, runExtensionDoctor } from "./lib/doctor.ts";
import { registerExtensionDoctor } from "../../lib/common/doctor/registry.ts";
import {
  openExtensionInManager,
  type SfPiManagerOpenRoute,
} from "../../lib/common/manager-deep-link.ts";
import {
  registerManagerDetailActions,
  type ManagerDetailAction,
} from "../../lib/common/manager-actions.ts";
import { type SfPiCommandAction } from "../../lib/common/command-actions.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { openInfoPanel } from "../../lib/common/info-panel.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { createAgentScriptInputActionPanel } from "./lib/manager-action-panels.ts";

import { registerAuthoringTool } from "./lib/authoring-tool.ts";
import { registerEvalTool } from "./lib/eval-tool.ts";
import { registerLifecycleTool } from "./lib/lifecycle-tool.ts";
import { registerPreviewTool } from "./lib/preview-tool.ts";
import { handleEvalAction } from "./lib/command/eval-action.ts";
import { handleReportAction } from "./lib/command/report-action.ts";
import { clearConnectionCache } from "../../lib/common/sf-conn/connection.ts";
import { clearAgentApiAuthCache } from "./lib/agent-api-auth.ts";
import {
  clearAgentScriptAnalysisCache,
  invalidateAgentScriptAnalysis,
} from "./lib/analysis-snapshot.ts";
import { clearSfapEndpointCache } from "./lib/eval/sfap.ts";

const EXTENSION_ID = "sf-agentscript";
const COMMAND_NAME = "sf-agentscript";

// -------------------------------------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------------------------------------

export default function sfAgentScriptExtension(pi: ExtensionAPI): void {
  if (!requirePiVersion(pi, "sf-agentscript")) return;

  const state = createState();

  registerCommand(pi, state);
  registerManagerDetailActions(pi, EXTENSION_ID, buildAgentScriptManagerActions(pi, state));
  registerSessionHooks(pi, state);
  registerToolResultHook(pi, state);

  // LLM-callable tools — four family surfaces for the Agent Script lifecycle.
  registerAuthoringTool(pi);
  registerPreviewTool(pi);
  registerEvalTool(pi);
  registerLifecycleTool(pi);

  registerExtensionDoctor(EXTENSION_ID, (cwd) => runExtensionDoctor(cwd));
}

// -------------------------------------------------------------------------------------------------
// /sf-agentscript
// -------------------------------------------------------------------------------------------------

type AgentScriptAction = "doctor" | "check" | "eval" | "report" | "help";

const AGENTSCRIPT_ACTIONS: SfPiCommandAction<AgentScriptAction>[] = [
  {
    value: "doctor",
    label: "Run doctor",
    description: "Show SDK package load status and current Agent Script readiness.",
    group: "Diagnostics",
  },
  {
    value: "check",
    label: "Check a file",
    description:
      "Prompt for a `.agent` file path and run one manual parse/compile diagnostic pass.",
    group: "Diagnostics",
  },
  {
    value: "eval",
    label: "Run an eval suite",
    description:
      "Run a multi-turn regression spec against the Salesforce Evaluation API. Usage: /sf-agentscript eval <spec.json>",
    group: "Testing",
  },
  {
    value: "report",
    label: "Render saved report",
    description:
      "Render a Markdown report from a past eval run. Usage: /sf-agentscript report eval <run_id> [--save] [--test-id <id>]",
    group: "Testing",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command usage and explain when to use each subcommand.",
    group: "Reference",
  },
];

function registerCommand(pi: ExtensionAPI, state: AgentScriptAssistState): void {
  pi.registerCommand(COMMAND_NAME, {
    description: "Agent Script lifecycle — compile-on-save diagnostics, eval, and tools",
    getArgumentCompletions: (prefix) => {
      const lower = prefix.toLowerCase();
      const items = AGENTSCRIPT_ACTIONS.filter((a) => a.value.startsWith(lower)).map((a) => ({
        value: a.value,
        label: a.value,
        description: a.description,
      }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const tokens = args.trim().split(/\s+/).filter(Boolean);
        const subcommand = tokens[0] ?? "";

        if (subcommand === "" && ctx.hasUI) {
          await openAgentScriptInManager(pi, ctx, "detail", state);
          return;
        }
        await handleAgentScriptCommand(
          pi,
          ctx,
          state,
          subcommand === "" ? "doctor" : subcommand,
          tokens.slice(1),
        );
      });
    },
  });
}

function buildAgentScriptManagerActions(
  pi: ExtensionAPI,
  state: AgentScriptAssistState,
): ManagerDetailAction[] {
  return AGENTSCRIPT_ACTIONS.map((action) => ({
    id: action.value,
    label: action.label,
    description: action.description,
    group: action.group,
    run: (ctx) => handleAgentScriptCommand(pi, ctx, state, action.value, [], true),
    ...(action.value === "check"
      ? {
          createPanel: (theme, _cwd, _scope, done, ctx) =>
            createAgentScriptInputActionPanel({
              theme,
              title: "Check Agent Script file",
              help: "Enter a .agent file path to run one manual parse/compile diagnostic pass.",
              placeholder: "path/to/file.agent",
              done,
              run: (filePath) => handleCheckSubcommand(filePath, ctx, state),
            }),
        }
      : {}),
    ...(action.value === "eval"
      ? {
          createPanel: (theme, _cwd, _scope, done, ctx) =>
            createAgentScriptInputActionPanel({
              theme,
              title: "Run Agent Script eval suite",
              help: "Enter an eval spec JSON path. Advanced flags remain available through the direct slash command.",
              placeholder: "scripts/eval/spec.json",
              done,
              run: (specPath) => handleEvalAction(pi, ctx, [specPath]),
            }),
        }
      : {}),
    ...(action.value === "report"
      ? {
          createPanel: (theme, _cwd, _scope, done, ctx) =>
            createAgentScriptInputActionPanel({
              theme,
              title: "Render Agent Script eval report",
              help: "Enter an eval run id to render the saved Markdown report.",
              placeholder: "<run_id>",
              done,
              run: (runId) => handleReportAction(ctx, ["eval", runId]),
            }),
        }
      : {}),
  }));
}

async function openAgentScriptInManager(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  view: NonNullable<SfPiManagerOpenRoute["view"]>,
  state: AgentScriptAssistState,
): Promise<void> {
  const opened = await openExtensionInManager(pi, ctx, {
    extensionId: EXTENSION_ID,
    view,
    actions: buildAgentScriptManagerActions(pi, state),
  });
  if (!opened) {
    ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-agentscript.", "warning");
  }
}

async function handleAgentScriptCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: AgentScriptAssistState,
  subcommand: string,
  args: string[],
  fromPanel = false,
): Promise<void> {
  if (subcommand === "doctor") {
    const targetOrg = parseDoctorTargetOrg(args);
    const status = await probeDoctor(ctx.cwd, targetOrg, {
      includeFreshness: parseDoctorFreshness(args),
    });
    await emitOutput(
      ctx,
      "Agent Script doctor",
      renderDoctorReport(status),
      status.sdkLoaded ? "info" : "warning",
      fromPanel,
    );
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
  if (subcommand === "eval") {
    if (args.length === 0 && ctx.hasUI && fromPanel) {
      const path =
        (await ctx.ui.input("Path to eval spec JSON", "scripts/eval/...spec.json"))?.trim() ?? "";
      if (!path) return;
      args = [path];
    }
    await handleEvalAction(pi, ctx, args);
    return;
  }
  if (subcommand === "report") {
    if (args.length === 0 && ctx.hasUI && fromPanel) {
      const runId = (await ctx.ui.input("Run id (eval)", "<run_id>"))?.trim() ?? "";
      if (!runId) return;
      args = ["eval", runId];
    }
    await handleReportAction(ctx, args);
    return;
  }
  if (subcommand === "help") {
    await emitOutput(ctx, "SF Agent Script help", renderHelp(), "info", fromPanel);
    return;
  }
  await emitOutput(
    ctx,
    "SF Agent Script usage",
    "Usage: /sf-agentscript [doctor | check <file> | eval <spec.json> | help]",
    "warning",
    fromPanel,
  );
}

async function emitOutput(
  ctx: ExtensionCommandContext,
  title: string,
  body: string,
  level: "info" | "warning" | "error" | "success",
  fromPanel: boolean,
): Promise<void> {
  if (fromPanel && ctx.hasUI) {
    await openInfoPanel(ctx, { title, body, severity: level });
    return;
  }
  if (ctx.hasUI) {
    ctx.ui.notify(body ? `${title}\n\n${body}` : title, level === "success" ? "info" : level);
  }
}

function parseDoctorFreshness(args: string[]): boolean {
  return args.includes("--freshness") || args.includes("--packages");
}

function parseDoctorTargetOrg(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--org" || arg === "--target-org" || arg === "-o") && args[i + 1]) {
      return args[i + 1];
    }
    if (arg.startsWith("--org=")) return arg.slice("--org=".length);
    if (arg.startsWith("--target-org=")) return arg.slice("--target-org=".length);
  }
  return undefined;
}

function renderHelp(): string {
  return [
    "sf-agentscript — Agent Script lifecycle (authoring + compile + eval)",
    "",
    "Commands:",
    "  /sf-agentscript                  Open status & controls panel",
    "  /sf-agentscript doctor [--org A] [--freshness] Show SDK status + optional SFAP/package freshness",
    "  /sf-agentscript check <file>     Run one manual compile diagnostic pass",
    "  /sf-agentscript eval <spec.json> [--org A] [--agent N] [--traces failed|all|off]",
    "                                   [--concurrency N] [--prompt-chars N] [--verbose]",
    "  /sf-agentscript report eval <run_id> [--save] [--test-id <id>]",
    "                                   Render Markdown report from a past eval run",
    "  /sf-agentscript help             Show this help",
    "",
    "Tools (LLM-callable):",
    "  agentscript_authoring            Create, compile, inspect, review, and mutate .agent files",
    "  agentscript_preview              Start/send/end live preview sessions and fetch traces",
    "  agentscript_eval                 Generate/run eval specs, drill failures, fetch traces",
    "  agentscript_lifecycle            Publish/activate/list/provision Agentforce agents",
  ].join("\n");
}

async function handleCheckSubcommand(
  inputPath: string,
  ctx: ExtensionContext,
  state: AgentScriptAssistState,
): Promise<void> {
  if (!inputPath) {
    if (ctx.hasUI) ctx.ui.notify("Usage: /sf-agentscript check <path/to/file.agent>", "warning");
    return;
  }

  const filePath = resolveToolPath(inputPath, ctx.cwd);
  if (!isAgentScriptFile(filePath)) {
    if (ctx.hasUI) ctx.ui.notify(`Not an Agent Script file: ${filePath}`, "warning");
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
  if (result.diagnostics.length > 0) state.lastStatusByFile.set(filePath, "error");
  else state.lastStatusByFile.set(filePath, "clean");
  state.dialectReportedByFile.add(filePath);

  if (!ctx.hasUI) return;
  if (result.diagnostics.length === 0) {
    ctx.ui.notify(`Agent Script check: ${filePath} is clean.`, "info");
    return;
  }
  const rendered = renderErrorFeedback(filePath, null, result.diagnostics, result.quickFixes);
  ctx.ui.notify(rendered, "warning");
}

// -------------------------------------------------------------------------------------------------
// Session lifecycle
// -------------------------------------------------------------------------------------------------

function registerSessionHooks(pi: ExtensionAPI, state: AgentScriptAssistState): void {
  pi.on("session_start", async () => {
    resetState(state);
    clearConnectionCache();
    clearAgentApiAuthCache();
    clearAgentScriptAnalysisCache();
    clearSfapEndpointCache();
  });
  pi.on("session_shutdown", async () => {
    resetState(state);
    clearConnectionCache();
    clearAgentApiAuthCache();
    clearAgentScriptAnalysisCache();
    clearSfapEndpointCache();
  });
}

// -------------------------------------------------------------------------------------------------
// tool_result hook — compile-on-save
// -------------------------------------------------------------------------------------------------

function registerToolResultHook(pi: ExtensionAPI, state: AgentScriptAssistState): void {
  pi.on("tool_result", async (event, ctx) => handleToolResult(event, ctx, state));
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

  invalidateAgentScriptAnalysis(filePath);
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
