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

import {
  type CommandPanelAction,
  type CommandPanelState,
  openCommandPanel,
} from "../../lib/common/command-panel.ts";
import {
  buildToggleExtensionAction,
  isLifecycleToggleAction,
  LIFECYCLE_GROUP,
  performToggleExtension,
  type LifecycleActionId,
} from "../../lib/common/extension-toggle.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
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

type SfHerdrAction =
  | "status"
  | "doctor"
  | "profiles"
  | "reset"
  | "help"
  | "close"
  | LifecycleActionId;

const ACTIONS: CommandPanelAction<SfHerdrAction>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Show Herdr runtime state, preferences path, and inferred workflow signals.",
    group: "Status",
  },
  {
    value: "doctor",
    label: "Run doctor",
    description:
      "Show readiness notes for upstream Herdr control, passive bridge, and planner state.",
    group: "Diagnostics",
  },
  {
    value: "profiles",
    label: "Show workflow profiles",
    description: "Print the effective managed workflow preferences used by sf_herdr_plan.",
    group: "Profiles",
  },
  {
    value: "reset",
    label: "Reset profiles",
    description: "Reset managed Herdr workflow preferences to bundled defaults.",
    group: "Profiles",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print usage and v1 boundaries.",
    group: "Reference",
  },
  { value: "close", label: "Close", description: "Dismiss this panel.", group: LIFECYCLE_GROUP },
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
      const items = ACTIONS.filter((action) => action.value !== "close")
        .filter((action) => action.value.startsWith(lower))
        .map((action) => ({
          value: action.value,
          label: action.value,
          description: action.description,
        }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const tokens = args.trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0 && ctx.hasUI) {
          await openPanel(ctx);
          return;
        }
        await handleAction(ctx, (tokens[0] as SfHerdrAction | undefined) ?? "status", false);
      });
    },
  });

  async function openPanel(ctx: ExtensionCommandContext): Promise<void> {
    const state: CommandPanelState<SfHerdrAction> = {};
    await openCommandPanel(ctx, {
      title: "🐑 SF Herdr — lane planning",
      subtitle: "Dynamic Herdr profiles, signals, and non-mutating plans.",
      statusLines: () => renderStatus(signalState).split("\n"),
      actions: () => buildActions(ctx.cwd),
      closeValue: "close",
      state,
      onAction: (action) => handleAction(ctx, action, true),
      closeBeforeAction: isLifecycleToggleAction,
    });
  }

  async function handleAction(
    ctx: ExtensionCommandContext,
    action: SfHerdrAction | string,
    fromPanel: boolean,
  ): Promise<void> {
    if (action === "lifecycle.toggle") {
      await performToggleExtension(ctx, EXTENSION_ID);
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

function buildActions(cwd: string): CommandPanelAction<SfHerdrAction>[] {
  const toggle = buildToggleExtensionAction({ extensionId: EXTENSION_ID, cwd });
  return toggle ? [...ACTIONS, toggle] : ACTIONS;
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
    "Usage: /sf-herdr [status|doctor|profiles|reset|help]",
    "",
    "SF Herdr owns dynamic Herdr lane planning for Salesforce workflows.",
    "It does not call Herdr directly and does not generate shell commands.",
    "Use sf_herdr_plan for a non-mutating lane plan, then execute visible herdr actions.",
  ].join("\n");
}
