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
import {
  buildApexGuruBrowserFollowUp,
  formatApexGuruSetupRunbook,
} from "./lib/apexguru-guidance.ts";
import { refreshApexGuruReadiness } from "./lib/apexguru-readiness.ts";
import { registerDeferredCodeAnalyzerAutoScan } from "./lib/auto-scan.ts";
import { registerCodeAnalyzerTool } from "./lib/code_analyzer-tool.ts";
import { runCodeAnalyzerDoctor } from "./lib/cli.ts";
import { renderDoctor } from "./lib/display.ts";
import { renderRecipes } from "./lib/recipes.ts";
import { buildCodeAnalyzerDoctor } from "./lib/extension-doctor.ts";
import { formatReadinessLine, refreshCodeAnalyzerReadiness } from "./lib/readiness.ts";
import {
  describeSetting,
  readEffectiveCodeAnalyzerSettings,
  resetProjectCodeAnalyzerSetting,
  writeCodeAnalyzerSetting,
  type CodeAnalyzerSettingKey,
  type EffectiveCodeAnalyzerSettings,
} from "./lib/settings.ts";
import { registerCodeAnalyzerTranscriptRenderer } from "./lib/transcript.ts";

const COMMAND_NAME = "sf-code-analyzer";

type CodeAnalyzerPanelAction =
  | "status"
  | "doctor"
  | "setup"
  | "recipes"
  | "auto-scan-on"
  | "auto-scan-off"
  | "auto-scan-reset"
  | "auto-scan-global-on"
  | "auto-scan-global-off"
  | "apexguru-auto-on"
  | "apexguru-auto-off"
  | "apexguru-auto-reset"
  | "apexguru-auto-global-on"
  | "apexguru-auto-global-off"
  | "apexguru-setup-help"
  | "apexguru-setup-start"
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
    value: "setup",
    label: "Install/update Code Analyzer plugin",
    description:
      "Ask for approval, then run `sf plugins install code-analyzer` and refresh readiness.",
    group: "Setup",
  },
  {
    value: "recipes",
    label: "Show scan recipes",
    description:
      "Show default automatic profiles, broader explicit scan presets, and Herdr handoff guidance.",
    group: "Reference",
  },
  {
    value: "auto-scan-on",
    label: "Enable deferred auto-scan for this project",
    description: "Set a project override that turns on post-agent Code Analyzer scans.",
    group: "Automation — project",
  },
  {
    value: "auto-scan-off",
    label: "Disable deferred auto-scan for this project",
    description: "Set a project override that turns off post-agent Code Analyzer scans.",
    group: "Automation — project",
  },
  {
    value: "auto-scan-reset",
    label: "Reset deferred auto-scan project override",
    description: "Remove the project override so global/default deferred auto-scan applies.",
    group: "Automation — project",
  },
  {
    value: "apexguru-auto-on",
    label: "Enable ApexGuru auto insights for this project",
    description:
      "Set a project override that turns on automatic ApexGuru insights when cached org readiness is enabled.",
    group: "Automation — project",
  },
  {
    value: "apexguru-auto-off",
    label: "Disable ApexGuru auto insights for this project",
    description: "Set a project override that turns off automatic ApexGuru insights.",
    group: "Automation — project",
  },
  {
    value: "apexguru-auto-reset",
    label: "Reset ApexGuru auto project override",
    description: "Remove the project override so global/default ApexGuru automation applies.",
    group: "Automation — project",
  },
  {
    value: "auto-scan-global-on",
    label: "Enable deferred auto-scan globally",
    description:
      "Set a global preference that turns on post-agent Code Analyzer scans unless a project overrides it.",
    group: "Automation — global",
  },
  {
    value: "auto-scan-global-off",
    label: "Disable deferred auto-scan globally",
    description:
      "Set a global preference that turns off post-agent Code Analyzer scans unless a project overrides it.",
    group: "Automation — global",
  },
  {
    value: "apexguru-auto-global-on",
    label: "Enable ApexGuru auto insights globally",
    description:
      "Set a global preference that turns on ApexGuru auto insights unless a project overrides it.",
    group: "Automation — global",
  },
  {
    value: "apexguru-auto-global-off",
    label: "Disable ApexGuru auto insights globally",
    description:
      "Set a global preference that turns off ApexGuru auto insights unless a project overrides it.",
    group: "Automation — global",
  },
  {
    value: "apexguru-setup-help",
    label: "Show ApexGuru SF Browser runbook",
    description:
      "Show the HIL-gated SF Browser runbook for checking Scale Center / ApexGuru Insights and enabling only if available.",
    group: "ApexGuru setup",
  },
  {
    value: "apexguru-setup-start",
    label: "Start ApexGuru setup check with SF Browser",
    description:
      "Ask for approval, then queue a visible agent follow-up that uses SF Browser tools according to the runbook.",
    group: "ApexGuru setup",
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
    `• Deferred auto-scan ${describeSetting(settings, "autoScan")}`,
    `• ApexGuru auto insights ${describeSetting(settings, "apexGuruAuto")}`,
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
    const settings = writeCodeAnalyzerSetting(ctx.cwd, "project", "autoScan", enabled);
    await emitOutput(
      ctx,
      "SF Code Analyzer automation updated",
      scopedSettingText("Deferred auto-scan", settings, "autoScan"),
      "success",
      fromPanel,
    );
    return;
  }

  if (action === "auto-scan-reset") {
    const settings = resetProjectCodeAnalyzerSetting(ctx.cwd, "autoScan");
    await emitOutput(
      ctx,
      "SF Code Analyzer automation updated",
      scopedSettingText("Deferred auto-scan", settings, "autoScan"),
      "success",
      fromPanel,
    );
    return;
  }

  if (action === "auto-scan-global-on" || action === "auto-scan-global-off") {
    const enabled = action === "auto-scan-global-on";
    const settings = writeCodeAnalyzerSetting(ctx.cwd, "global", "autoScan", enabled);
    await emitOutput(
      ctx,
      "SF Code Analyzer automation updated",
      scopedSettingText("Deferred auto-scan", settings, "autoScan"),
      "success",
      fromPanel,
    );
    return;
  }

  if (action === "apexguru-auto-on" || action === "apexguru-auto-off") {
    const enabled = action === "apexguru-auto-on";
    const settings = writeCodeAnalyzerSetting(ctx.cwd, "project", "apexGuruAuto", enabled);
    await emitOutput(
      ctx,
      "SF Code Analyzer automation updated",
      scopedSettingText("ApexGuru auto insights", settings, "apexGuruAuto"),
      "success",
      fromPanel,
    );
    return;
  }

  if (action === "apexguru-auto-reset") {
    const settings = resetProjectCodeAnalyzerSetting(ctx.cwd, "apexGuruAuto");
    await emitOutput(
      ctx,
      "SF Code Analyzer automation updated",
      scopedSettingText("ApexGuru auto insights", settings, "apexGuruAuto"),
      "success",
      fromPanel,
    );
    return;
  }

  if (action === "apexguru-auto-global-on" || action === "apexguru-auto-global-off") {
    const enabled = action === "apexguru-auto-global-on";
    const settings = writeCodeAnalyzerSetting(ctx.cwd, "global", "apexGuruAuto", enabled);
    await emitOutput(
      ctx,
      "SF Code Analyzer automation updated",
      scopedSettingText("ApexGuru auto insights", settings, "apexGuruAuto"),
      "success",
      fromPanel,
    );
    return;
  }

  if (action === "apexguru-setup-help") {
    await emitOutput(
      ctx,
      "ApexGuru setup check with SF Browser",
      formatApexGuruSetupRunbook(),
      "info",
      fromPanel,
    );
    return;
  }

  if (action === "recipes") {
    await emitOutput(
      ctx,
      "SF Code Analyzer scan recipes",
      renderRecipes({ inline: true }),
      "info",
      fromPanel,
    );
    return;
  }

  if (action === "setup") {
    await runSetupAction(pi, ctx, fromPanel);
    return;
  }

  if (action === "help") {
    await emitOutput(ctx, "SF Code Analyzer help", buildHelpText(), "info", fromPanel);
    return;
  }

  if (action === "apexguru-setup-start") {
    await startApexGuruBrowserSetup(pi, ctx, fromPanel);
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

async function runSetupAction(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  fromPanel: boolean,
): Promise<void> {
  const command = "sf plugins install code-analyzer";
  if (!ctx.hasUI) {
    await emitOutput(
      ctx,
      "SF Code Analyzer setup",
      `Run this command manually to install or update the Code Analyzer plugin:\n${command}`,
      "info",
      fromPanel,
    );
    return;
  }

  const confirmed = await ctx.ui.confirm(
    "Install/update Code Analyzer plugin?",
    `This runs:\n${command}\n\nIt changes your local Salesforce CLI plugin state. Continue?`,
  );
  if (!confirmed) {
    await emitOutput(
      ctx,
      "SF Code Analyzer setup cancelled",
      "No changes were made.",
      "info",
      fromPanel,
    );
    return;
  }

  ctx.ui.setStatus("sf-code-analyzer", "Code Analyzer setup: installing plugin…");
  try {
    const result = await pi.exec("sf", ["plugins", "install", "code-analyzer"], {
      cwd: ctx.cwd,
      timeout: 180_000,
    });
    const exec = buildExecFn(pi, ctx.cwd);
    const readiness = await refreshCodeAnalyzerReadiness(exec).catch(() => undefined);
    await emitOutput(
      ctx,
      "SF Code Analyzer setup complete",
      [
        `Command: ${command}`,
        `Exit code: ${result.code}`,
        readiness ? `Readiness: ${readiness.summary}` : undefined,
        result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : undefined,
        result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : undefined,
      ]
        .filter(Boolean)
        .join("\n\n"),
      result.code === 0 ? "success" : "warning",
      fromPanel,
    );
  } finally {
    ctx.ui.setStatus("sf-code-analyzer", undefined);
  }
}

async function startApexGuruBrowserSetup(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  fromPanel: boolean,
): Promise<void> {
  const runbook = formatApexGuruSetupRunbook();
  if (!ctx.hasUI) {
    await emitOutput(ctx, "ApexGuru setup check with SF Browser", runbook, "info", fromPanel);
    return;
  }
  const confirmed = await ctx.ui.confirm(
    "Start ApexGuru setup check with SF Browser?",
    `${runbook}\n\nThis queues a normal agent follow-up that uses sf_browser tools visibly. No Setup enable/accept/save click should happen without a second explicit approval.`,
  );
  if (!confirmed) {
    await emitOutput(
      ctx,
      "ApexGuru setup check cancelled",
      "No browser workflow was started.",
      "info",
      fromPanel,
    );
    return;
  }
  pi.sendUserMessage(buildApexGuruBrowserFollowUp(), { deliverAs: "followUp" });
  await emitOutput(
    ctx,
    "ApexGuru setup check queued",
    "Queued a visible agent follow-up to use SF Browser according to the ApexGuru setup runbook.",
    "success",
    fromPanel,
  );
}

function scopedSettingText(
  label: string,
  settings: EffectiveCodeAnalyzerSettings,
  key: CodeAnalyzerSettingKey,
): string {
  return `${label}: ${describeSetting(settings, key)}.`;
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
    "  code_analyzer action='recipes'      Show scan recipes and Herdr handoff guidance.",
    "  code_analyzer action='rules'        Preview rule selectors.",
    "  code_analyzer action='run'          Run a scan and parse JSON output.",
    "  code_analyzer action='config'       Write effective Code Analyzer config.",
    "  code_analyzer action='apexguru'     Run explicit ApexGuru analysis for one Apex file.",
    "  /sf-code-analyzer setup     Install/update the Code Analyzer CLI plugin after approval.",
    "  code_analyzer action='apexguru_setup_help'  Show the HIL-gated SF Browser runbook.",
    "  code_analyzer action='last_report'  Summarize the latest report on this branch.",
    "",
    "Output modes: summary (default), inline, file_only.",
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
