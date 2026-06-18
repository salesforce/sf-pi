/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-herdr behavior contract
 *
 * SF Herdr owns Salesforce-aware Herdr lane planning, preferences, and status.
 * It does not replace the upstream `herdr` tool from npm:@ogulcancelik/pi-herdr
 * and does not perform pane mutations itself. The only LLM tool registered here
 * is non-mutating: sf_herdr_plan returns a phased plan that the agent executes
 * through explicit herdr calls.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

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
import { isSfPiExtensionEnabled } from "../../lib/common/sf-pi-extension-state.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { registerExtensionDoctor } from "../../lib/common/doctor/registry.ts";
import {
  DEFAULT_SF_HERDR_PREFERENCES,
  herdrPreferencesPath,
  readSfHerdrPreferences,
  writeSfHerdrPreferences,
} from "../../lib/common/herdr-profile/store.ts";
import { createHerdrSignalState } from "./lib/signal-state.ts";
import { registerSfHerdrPlanTool } from "./lib/sf_herdr_plan-tool.ts";
import { renderDoctor, renderStatus } from "./lib/status.ts";

const EXTENSION_ID = "sf-herdr";
const COMMAND_NAME = "sf-herdr";

type SfHerdrAction = "status" | "doctor" | "profiles" | "reset" | "settings" | "help";

const COMMAND_ACTIONS: Array<{
  value: SfHerdrAction;
  label: string;
  description: string;
}> = [
  {
    value: "status",
    label: "Show status",
    description: "Show Herdr runtime state, preferences path, and inferred workflow signals.",
  },
  {
    value: "doctor",
    label: "Run doctor",
    description:
      "Show readiness notes for upstream Herdr control, passive bridge, and planner state.",
  },
  {
    value: "profiles",
    label: "Show workflow profiles",
    description: "Print the effective managed workflow preferences used by sf_herdr_plan.",
  },
  {
    value: "reset",
    label: "Reset profiles",
    description: "Reset managed Herdr workflow preferences to bundled defaults.",
  },
  {
    value: "settings",
    label: "Open settings",
    description: "Open the SF Herdr settings page in the SF Pi Manager.",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print usage and v1 boundaries.",
  },
];

export default function sfHerdr(pi: ExtensionAPI): void {
  if (!requirePiVersion(pi, "sf-herdr")) return;

  const signalState = createHerdrSignalState();
  let planToolRegistered = false;

  function ensureToolRegistered(): void {
    if (planToolRegistered) return;
    registerSfHerdrPlanTool(pi, signalState);
    planToolRegistered = true;
  }

  registerExtensionDoctor(EXTENSION_ID, async () => ({
    extensionId: EXTENSION_ID,
    title: "SF Herdr",
    summary: "Herdr lane planning and workflow signal inference",
    checks: renderDoctor(signalState)
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line, index) => ({
        id: `sf-herdr.${index}`,
        severity: line.startsWith("○") ? ("info" as const) : ("ok" as const),
        title: line.replace(/^[✓○]\s*/, ""),
        detail: line,
      })),
  }));
  registerManagerDetailActions(pi, EXTENSION_ID, buildHerdrManagerActions());

  pi.on("session_start", async (event, ctx) => {
    if (event.reason === "reload") planToolRegistered = false;
    signalState.reconstruct(ctx);
    if (isSfPiExtensionEnabled(ctx.cwd, EXTENSION_ID)) ensureToolRegistered();
  });
  pi.on("session_tree", async (_event, ctx) => {
    signalState.reconstruct(ctx);
  });
  pi.on("session_shutdown", async () => {
    signalState.reset();
    planToolRegistered = false;
  });
  pi.on("tool_execution_end", async (event) => {
    signalState.observeToolExecutionEnd({
      toolName: event.toolName,
      args: "args" in event ? event.args : undefined,
      isError: event.isError,
    });
  });
  pi.on("tool_result", async (event, ctx) => {
    signalState.observeToolResult(event, ctx.cwd);
  });
  pi.on("resources_discover", (event) => {
    if (!isSfPiExtensionEnabled(event.cwd, EXTENSION_ID)) return;
    if (event.reason === "reload") planToolRegistered = false;
    ensureToolRegistered();
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "SF Herdr — dynamic Herdr lane planning, profiles, and status",
    getArgumentCompletions: (prefix) => {
      const lower = prefix.toLowerCase();
      const items = COMMAND_ACTIONS.filter((action) => action.value.startsWith(lower)).map(
        (action) => ({
          value: action.value,
          label: action.value,
          description: action.description,
        }),
      );
      return items.length > 0 ? items : null;
    },
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
        "Open settings from the interactive manager: /sf-pi open sf-herdr settings",
        "info",
        fromPanel,
      );
      return;
    }
    if (action === "status") {
      await emit(ctx, "SF Herdr status", renderStatus(signalState), "info", fromPanel);
      return;
    }
    if (action === "doctor") {
      await emit(ctx, "SF Herdr doctor", renderDoctor(signalState), "info", fromPanel);
      return;
    }
    if (action === "profiles") {
      await emit(ctx, "SF Herdr profiles", renderProfiles(), "info", fromPanel);
      return;
    }
    if (action === "reset") {
      writeSfHerdrPreferences(DEFAULT_SF_HERDR_PREFERENCES);
      await emit(
        ctx,
        "SF Herdr reset",
        "Herdr workflow preferences reset to bundled defaults.",
        "success",
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

function renderProfiles(): string {
  const preferences = readSfHerdrPreferences();
  return [
    "SF Herdr workflow profiles",
    `Path: ${herdrPreferencesPath()}`,
    `Mode: ${preferences.workflowMode}`,
    `Default lane style: ${preferences.defaults.laneStyle ?? "split"}`,
    `Default split direction: ${preferences.defaults.splitDirection ?? "right"}`,
    `Preserve focus: ${preferences.defaults.preserveFocus ?? true}`,
    "",
    "Workflow overrides:",
    ...Object.entries(preferences.workflows).map(([workflow, profile]) => {
      const laneNames = Object.entries(profile?.lanes ?? {})
        .filter(([, lane]) => lane?.enabled !== false)
        .map(([laneId, lane]) => `${laneId}=${lane?.alias ?? laneId}`)
        .join(", ");
      return `- ${workflow}: ${laneNames || "inherits defaults"}`;
    }),
  ].join("\n");
}

function renderHelp(): string {
  return [
    "Usage: /sf-herdr [status|doctor|profiles|reset|settings|help]",
    "",
    "SF Herdr owns dynamic Herdr lane planning for Salesforce workflows.",
    "It does not call Herdr directly and does not generate shell commands.",
    "Use sf_herdr_plan for a non-mutating lane plan, then execute visible herdr actions.",
  ].join("\n");
}
