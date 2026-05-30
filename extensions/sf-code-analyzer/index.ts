/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-code-analyzer behavior contract
 *
 * Salesforce Code Analyzer workflow surface for pi. V1 exposes a standard
 * command panel, a single `code_analyzer` family tool, report artifacts, and a
 * `/sf-pi doctor` contribution. Automatic deferred scans and ApexGuru auto
 * insights are planned next and documented in ADRs 0021/0026.
 *
 * Behavior matrix:
 *
 *   Event/Trigger             | Result
 *   --------------------------|-------------------------------------------------
 *   extension load            | Register /sf-code-analyzer and doctor provider
 *   session_start             | Register code_analyzer tool when enabled
 *   session_shutdown          | Clear tool registration latch
 *   /sf-code-analyzer         | Open standardized command panel
 *   /sf-code-analyzer status  | Print readiness and tool status
 *   /sf-code-analyzer doctor  | Probe sf/plugin/Java/Python setup
 *   code_analyzer action=run  | Run sf code-analyzer run, parse JSON artifact
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type CommandPanelState, openCommandPanel } from "../../lib/common/command-panel.ts";
import {
  type SfPiCommandAction,
  formatHelpFromActions,
  getCompletionsFromActions,
  resolveAction,
} from "../../lib/common/command-actions.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import {
  buildToggleExtensionAction,
  isLifecycleToggleAction,
  LIFECYCLE_GROUP,
  performToggleExtension,
  type LifecycleActionId,
} from "../../lib/common/extension-toggle.ts";
import { buildExecFn } from "../../lib/common/exec-adapter.ts";
import { registerExtensionDoctor } from "../../lib/common/doctor/registry.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { isSfPiExtensionEnabled } from "../../lib/common/sf-pi-extension-state.ts";
import { refreshApexGuruReadiness } from "./lib/apexguru-readiness.ts";
import { registerDeferredCodeAnalyzerAutoScan } from "./lib/auto-scan.ts";
import { registerCodeAnalyzerTool } from "./lib/code_analyzer-tool.ts";
import { runCodeAnalyzerDoctor } from "./lib/cli.ts";
import { renderDoctor } from "./lib/display.ts";
import { buildCodeAnalyzerDoctor } from "./lib/extension-doctor.ts";
import { formatReadinessLine, refreshCodeAnalyzerReadiness } from "./lib/readiness.ts";
import { readEffectiveCodeAnalyzerSettings, writeCodeAnalyzerSetting } from "./lib/settings.ts";
import { registerCodeAnalyzerTranscriptRenderer } from "./lib/transcript.ts";

const COMMAND_NAME = "sf-code-analyzer";

type CodeAnalyzerPanelAction =
  | "status"
  | "doctor"
  | "auto-scan-on"
  | "auto-scan-off"
  | "apexguru-auto-on"
  | "apexguru-auto-off"
  | "help"
  | "close"
  | LifecycleActionId;

const CODE_ANALYZER_ACTIONS: SfPiCommandAction<CodeAnalyzerPanelAction>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Print enablement, tool registration, and setup summary.",
    group: "Diagnostics",
  },
  {
    value: "doctor",
    label: "Run doctor",
    description: "Check Salesforce CLI, Code Analyzer plugin, Java, and Python prerequisites.",
    group: "Diagnostics",
  },
  {
    value: "auto-scan-on",
    label: "Enable deferred auto-scan",
    description: "Turn on post-agent Code Analyzer scans for this project.",
    group: "Automation",
  },
  {
    value: "auto-scan-off",
    label: "Disable deferred auto-scan",
    description: "Turn off post-agent Code Analyzer scans for this project.",
    group: "Automation",
  },
  {
    value: "apexguru-auto-on",
    label: "Enable ApexGuru auto insights",
    description:
      "Turn on automatic ApexGuru insights for this project when cached org readiness is enabled.",
    group: "Automation",
  },
  {
    value: "apexguru-auto-off",
    label: "Disable ApexGuru auto insights",
    description: "Turn off automatic ApexGuru insights for this project.",
    group: "Automation",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command usage and Code Analyzer workflow guidance.",
    group: "Reference",
  },
  {
    value: "close",
    label: "Close",
    description: "Dismiss this panel.",
    group: LIFECYCLE_GROUP,
  },
];

export default function sfCodeAnalyzer(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-code-analyzer")) return;

  let toolsRegistered = false;
  const exec = buildExecFn(pi);

  function ensureToolsRegistered(): void {
    if (toolsRegistered) return;
    registerCodeAnalyzerTool(pi);
    toolsRegistered = true;
  }

  registerCodeAnalyzerTranscriptRenderer(pi);
  registerDeferredCodeAnalyzerAutoScan(pi, exec);

  pi.on("session_start", (event, ctx) => {
    if (event.reason === "reload") toolsRegistered = false;
    if (isSfPiExtensionEnabled(ctx.cwd, "sf-code-analyzer")) ensureToolsRegistered();
    if (ctx.hasUI && isSfPiExtensionEnabled(ctx.cwd, "sf-code-analyzer")) {
      const timer = setTimeout(() => {
        void refreshCodeAnalyzerReadiness(exec).catch(() => {
          // Cache refresh is best-effort. Doctor surfaces the error when requested.
        });
        void refreshApexGuruReadiness().catch(() => {
          // ApexGuru readiness is optional and must not affect startup.
        });
      }, 6_000);
      timer.unref?.();
    }
  });

  pi.on("session_shutdown", () => {
    toolsRegistered = false;
  });

  registerExtensionDoctor("sf-code-analyzer", buildCodeAnalyzerDoctor(pi));

  pi.registerCommand(COMMAND_NAME, {
    description: "Show Salesforce Code Analyzer status and controls",
    getArgumentCompletions: (prefix: string) =>
      getCompletionsFromActions(CODE_ANALYZER_ACTIONS, prefix.trim().split(/\s+/).at(-1) ?? "", {
        excludeValues: ["close", "lifecycle.toggle"],
      }),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, () => handleCommand(pi, ctx, args ?? ""));
    },
  });
}

function buildActions(cwd: string): SfPiCommandAction<CodeAnalyzerPanelAction>[] {
  const toggle = buildToggleExtensionAction({ extensionId: "sf-code-analyzer", cwd });
  return toggle ? [...CODE_ANALYZER_ACTIONS, toggle] : CODE_ANALYZER_ACTIONS;
}

async function handleCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string,
): Promise<void> {
  const subcommand = args.trim().split(/\s+/)[0] ?? "";
  if (subcommand === "" && ctx.hasUI) {
    await openPanel(pi, ctx);
    return;
  }
  const action =
    subcommand === "" ? "status" : (resolveAction(CODE_ANALYZER_ACTIONS, subcommand) ?? subcommand);
  await handleAction(pi, ctx, action, false);
}

async function openPanel(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const state: CommandPanelState<CodeAnalyzerPanelAction> = {};
  await openCommandPanel(ctx, {
    title: "🧪 SF Code Analyzer — status & controls",
    subtitle: "Run Salesforce Code Analyzer scans and inspect setup readiness.",
    statusLines: () => buildPanelStatus(ctx),
    actions: () => buildActions(ctx.cwd),
    closeValue: "close",
    state,
    onAction: (action) => handleAction(pi, ctx, action, true),
    closeBeforeAction: isLifecycleToggleAction,
  });
}

function buildPanelStatus(ctx: ExtensionCommandContext): string[] {
  const enabled = isSfPiExtensionEnabled(ctx.cwd, "sf-code-analyzer");
  const settings = readEffectiveCodeAnalyzerSettings(ctx.cwd);
  return [
    `${enabled ? "✓" : "○"} Extension ${enabled ? "enabled" : "disabled"}`,
    `${enabled ? "✓" : "○"} Tool code_analyzer ${enabled ? "available after session_start" : "not registered"}`,
    `• Readiness ${formatReadinessLine()}`,
    `• Deferred auto-scan ${settings.autoScan ? "on" : "off"}`,
    `• ApexGuru auto insights ${settings.apexGuruAuto ? "on when cached org readiness is enabled" : "off"}`,
  ];
}

async function handleAction(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  action: CodeAnalyzerPanelAction | string,
  fromPanel: boolean,
): Promise<void> {
  if (action === "lifecycle.toggle") {
    await performToggleExtension(ctx, "sf-code-analyzer");
    return;
  }

  if (action === "auto-scan-on" || action === "auto-scan-off") {
    const enabled = action === "auto-scan-on";
    writeCodeAnalyzerSetting(ctx.cwd, "project", "autoScan", enabled);
    await emitOutput(
      ctx,
      "SF Code Analyzer automation updated",
      `Deferred auto-scan is now ${enabled ? "on" : "off"} for this project.`,
      "success",
      fromPanel,
    );
    return;
  }

  if (action === "apexguru-auto-on" || action === "apexguru-auto-off") {
    const enabled = action === "apexguru-auto-on";
    writeCodeAnalyzerSetting(ctx.cwd, "project", "apexGuruAuto", enabled);
    await emitOutput(
      ctx,
      "SF Code Analyzer automation updated",
      `ApexGuru auto insights are now ${enabled ? "on when available" : "off"} for this project.`,
      "success",
      fromPanel,
    );
    return;
  }

  if (action === "help") {
    await emitOutput(ctx, "SF Code Analyzer help", buildHelpText(), "info", fromPanel);
    return;
  }

  if (action === "doctor") {
    const exec = buildExecFn(pi, ctx.cwd);
    const report = await runCodeAnalyzerDoctor(exec);
    await refreshCodeAnalyzerReadiness(exec).catch(() => undefined);
    await emitOutput(
      ctx,
      "SF Code Analyzer doctor",
      renderDoctor(report),
      report.plugin.ok ? "info" : "warning",
      fromPanel,
    );
    return;
  }

  if (action === "status") {
    await emitOutput(ctx, "SF Code Analyzer status", buildStatusText(ctx), "info", fromPanel);
    return;
  }

  await emitOutput(
    ctx,
    "SF Code Analyzer — unknown subcommand",
    `Unknown /${COMMAND_NAME} subcommand: ${action}. Use status, doctor, or help.`,
    "warning",
    fromPanel,
  );
}

function buildStatusText(ctx: ExtensionCommandContext): string {
  return [
    "SF Code Analyzer status",
    "",
    ...buildPanelStatus(ctx),
    "",
    "Run /sf-code-analyzer doctor for setup details.",
    "Use the code_analyzer tool for explicit scans, rule discovery, config generation, and report summaries.",
  ].join("\n");
}

function buildHelpText(): string {
  return [
    formatHelpFromActions(CODE_ANALYZER_ACTIONS, COMMAND_NAME),
    "",
    "LLM tool actions:",
    "  code_analyzer action='doctor'       Check setup prerequisites.",
    "  code_analyzer action='rules'        Preview rule selectors.",
    "  code_analyzer action='run'          Run a scan and parse JSON output.",
    "  code_analyzer action='config'       Write effective Code Analyzer config.",
    "  code_analyzer action='apexguru'     Run explicit ApexGuru analysis for one Apex file.",
    "  code_analyzer action='last_report'  Summarize the latest report on this branch.",
    "",
    "Default reports are written under the global SF Pi Code Analyzer artifact directory, outside the project tree.",
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
