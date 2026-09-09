/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-herdr behavior contract
 *
 * The command/status/settings surface is always registered when this extension
 * loads. The non-mutating planner is registered at session startup only when
 * the current split Herdr runtime is fully active.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { getFirstTokenCompletions } from "../../lib/common/command-actions.ts";
import { registerExtensionDoctor } from "../../lib/common/doctor/registry.ts";
import { getHerdrSplitToolReadiness } from "../../lib/common/herdr-runtime.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import {
  openExtensionInManager,
  type SfPiManagerOpenRoute,
} from "../../lib/common/manager-deep-link.ts";
import {
  registerManagerDetailActions,
  type ManagerDetailAction,
} from "../../lib/common/manager-actions.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { registerSfHerdrPlanTool } from "./lib/sf_herdr_plan-tool.ts";
import { readSfHerdrSettings } from "./lib/settings.ts";
import { renderDoctor, renderStatus } from "./lib/status.ts";
import { normalizeHerdrPaneToolResult } from "./lib/tool-result-normalizer.ts";

const EXTENSION_ID = "sf-herdr";
const COMMAND_NAME = "sf-herdr";

type SfHerdrAction = "status" | "doctor" | "settings" | "help";

const COMMAND_ACTIONS: Array<{
  value: SfHerdrAction;
  label: string;
  description: string;
}> = [
  {
    value: "status",
    label: "Show status",
    description: "Show current split-tool readiness and effective global settings.",
  },
  {
    value: "doctor",
    label: "Run doctor",
    description: "Check the Herdr environment and all three current upstream tools.",
  },
  {
    value: "settings",
    label: "Open settings",
    description: "Open the global SF Herdr settings page in the SF Pi Manager.",
  },
  { value: "help", label: "Show help", description: "Print usage and boundaries." },
];

export default function sfHerdr(pi: ExtensionAPI): void {
  if (!requirePiVersion(pi, "sf-herdr")) return;

  let planToolRegistered = false;

  pi.registerCommand(COMMAND_NAME, {
    description: "SF Herdr — current split-tool planning, status, and settings",
    getArgumentCompletions: (prefix) => getFirstTokenCompletions(COMMAND_ACTIONS, prefix),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const tokens = args.trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0 && ctx.hasUI) {
          await openHerdrInManager(ctx, "detail");
          return;
        }
        const action = (tokens[0] as SfHerdrAction | undefined) ?? "status";
        if (action === "settings" && ctx.hasUI) {
          await openHerdrInManager(ctx, "settings");
          return;
        }
        await handleAction(ctx, action, false);
      });
    },
  });

  registerExtensionDoctor(EXTENSION_ID, async (cwd) => ({
    extensionId: EXTENSION_ID,
    title: "SF Herdr",
    summary: "Current split Herdr runtime and planner readiness",
    checks: renderDoctor(pi.getActiveTools(), process.env, cwd)
      .split("\n")
      .filter((line) => /^[✓○✗]/.test(line))
      .map((line, index) => ({
        id: `sf-herdr.${index}`,
        severity: line.startsWith("✗")
          ? ("error" as const)
          : line.startsWith("○")
            ? ("info" as const)
            : ("ok" as const),
        title: line.replace(/^[✓○✗]\s*/, ""),
        detail: line,
      })),
  }));
  registerManagerDetailActions(pi, EXTENSION_ID, buildHerdrManagerActions());

  pi.on("session_start", async () => {
    if (planToolRegistered) return;
    const readiness = getHerdrSplitToolReadiness(pi.getActiveTools());
    if (!readiness.ready) return;
    registerSfHerdrPlanTool(pi);
    planToolRegistered = true;
  });
  pi.on("tool_result", (event) => normalizeHerdrPaneToolResult(event));

  function buildHerdrManagerActions(): ManagerDetailAction[] {
    return COMMAND_ACTIONS.filter((action) => action.value !== "settings").map((action) => ({
      id: action.value,
      label: action.label,
      description: action.description,
      run: (ctx) => handleAction(ctx, action.value, true),
    }));
  }

  async function openHerdrInManager(
    ctx: ExtensionCommandContext,
    view: NonNullable<SfPiManagerOpenRoute["view"]>,
  ): Promise<void> {
    const opened = await openExtensionInManager(pi, ctx, {
      extensionId: EXTENSION_ID,
      view,
      actions: buildHerdrManagerActions(),
    });
    if (!opened) {
      ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-herdr.", "warning");
    }
  }

  async function handleAction(
    ctx: ExtensionCommandContext,
    action: SfHerdrAction | string,
    fromPanel: boolean,
  ): Promise<void> {
    if (action === "settings") {
      await emit(
        ctx,
        "SF Herdr settings",
        "Open global settings from the interactive manager: /sf-pi open sf-herdr settings",
        "info",
        fromPanel,
      );
      return;
    }
    if (action === "status") {
      await emit(ctx, "SF Herdr status", renderStatus(pi.getActiveTools()), "info", fromPanel);
      return;
    }
    if (action === "doctor") {
      await emit(
        ctx,
        "SF Herdr doctor",
        renderDoctor(pi.getActiveTools(), process.env, ctx.cwd),
        "info",
        fromPanel,
      );
      return;
    }
    await emit(ctx, "SF Herdr help", renderHelp(), "info", fromPanel);
  }
}

async function emit(
  ctx: ExtensionCommandContext,
  title: string,
  body: string,
  severity: InfoPanelSeverity,
  fromPanel: boolean,
): Promise<void> {
  if (ctx.hasUI && (fromPanel || body.includes("\n"))) {
    await openInfoPanel(ctx, { title, body, severity });
    return;
  }
  if (ctx.hasUI) {
    ctx.ui.notify(body, severity === "success" ? "info" : severity);
    return;
  }
  console.info(body);
}

function renderHelp(): string {
  const settings = readSfHerdrSettings();
  return [
    "Usage: /sf-herdr [status|doctor|settings|help]",
    "",
    "sf_herdr_plan is non-mutating and is available only inside a current split Herdr runtime.",
    "Plans use herdr_layout, herdr_pane, and herdr_agent; they never generate shell commands.",
    `Current split direction: ${settings.splitDirection}.`,
  ].join("\n");
}
