/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-fin — connect SF Pi to a Fin (formerly Intercom) workspace.
 *
 * Behavior matrix:
 *
 *   Event/Trigger          | Result
 *   -----------------------|---------------------------------------------------------
 *   extension load         | Register auth-only Provider, `sf_fin`, `/sf-fin`
 *   session_start/shutdown | Bind/clear the masked credential prompt (no network)
 *   /sf-fin (no args)      | Open SF Pi Manager detail page when UI is available
 *   /sf-fin connect        | Prepare native `/login sf-fin` (region + masked token)
 *   /sf-fin disconnect     | Prefill native `/logout sf-fin`
 *   /sf-fin status         | Print cached credential/region/doctor status
 *   /sf-fin doctor         | Read-only `intercom --version` + `intercom me`
 *   sf_fin status/doctor   | Same as the commands, for the agent
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  getFirstTokenCompletionsFromActions,
  resolveAction,
} from "../../lib/common/command-actions.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import {
  registerManagerDetailActions,
  type ManagerDetailAction,
} from "../../lib/common/manager-actions.ts";
import { openExtensionInManager } from "../../lib/common/manager-deep-link.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { detectTokenSource, hasStoredFinCredential, sfFinAuthController } from "./lib/auth.ts";
import { SF_FIN_ACTIONS, renderHelp } from "./lib/command-surface.ts";
import { runDoctor } from "./lib/doctor.ts";
import { registerSfFinTool } from "./lib/sf_fin-tool.ts";
import { buildStatusText, createFinStatusStore } from "./lib/status.ts";
import { COMMAND_NAME, ENV_REGION, ENV_TOKEN, PROVIDER_NAME } from "./lib/types.ts";

export default function sfFin(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-fin")) return;

  pi.registerProvider(sfFinAuthController.provider);

  pi.on("session_start", async (_event, ctx) => {
    sfFinAuthController.bind(ctx.ui, ctx.mode);
  });
  pi.on("session_shutdown", async () => {
    sfFinAuthController.clear();
  });

  registerSfFinTool(pi);

  pi.registerCommand(COMMAND_NAME, {
    description: "Connect and check the Fin (formerly Intercom) workspace",
    getArgumentCompletions: (prefix: string) =>
      getFirstTokenCompletionsFromActions(SF_FIN_ACTIONS, prefix),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const trimmed = (args ?? "").trim();
        if (!trimmed && ctx.hasUI) {
          const opened = await openExtensionInManager(pi, ctx, {
            extensionId: COMMAND_NAME,
            view: "detail",
            actions: buildManagerActions(),
          });
          if (!opened)
            ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-fin.", "warning");
          return;
        }
        await handleCommand(ctx, trimmed, false);
      });
    },
  });

  registerManagerDetailActions(pi, COMMAND_NAME, buildManagerActions());
}

function buildManagerActions(): ManagerDetailAction[] {
  return SF_FIN_ACTIONS.map((action) => ({
    id: action.value,
    label: action.label,
    description: action.description,
    group: action.group,
    run: (ctx) => handleCommand(ctx, action.value, true),
  }));
}

async function handleCommand(
  ctx: ExtensionCommandContext,
  rawArgs: string,
  fromPanel: boolean,
): Promise<void> {
  const first = rawArgs.trim().split(/\s+/).filter(Boolean)[0];
  const sub = first ? (resolveAction(SF_FIN_ACTIONS, first) ?? first) : "status";
  const store = createFinStatusStore();

  if (sub === "status")
    return emit(ctx, "SF Fin status", buildStatusText(store.read()), "info", fromPanel);
  if (sub === "help") return emit(ctx, "SF Fin help", renderHelp(), "info", fromPanel);
  if (sub === "connect") return connect(ctx, fromPanel);
  if (sub === "disconnect") return disconnect(ctx, fromPanel);
  if (sub === "doctor") {
    const report = await runDoctor(ctx);
    store.write(report.snapshot);
    return emit(
      ctx,
      report.outcome === "ok" ? "SF Fin connected" : "SF Fin doctor",
      `${report.message}\n\n${buildStatusText(report.snapshot)}`,
      report.outcome === "ok" ? "info" : "warning",
      fromPanel,
    );
  }
  return emit(
    ctx,
    "SF Fin — unknown subcommand",
    `Unknown /${COMMAND_NAME} subcommand: ${sub}. Use connect, disconnect, status, doctor, or help.`,
    "warning",
    fromPanel,
  );
}

async function connect(ctx: ExtensionCommandContext, fromPanel: boolean): Promise<void> {
  if (ctx.mode !== "tui") {
    return emit(
      ctx,
      "SF Fin interactive login requires TUI mode",
      `Run /login ${PROVIDER_NAME} in interactive TUI mode, or set ${ENV_TOKEN} (and optionally ${ENV_REGION}) before starting Pi.`,
      "warning",
      fromPanel,
    );
  }
  ctx.ui.setEditorText(`/login ${PROVIDER_NAME}`);
  return emit(
    ctx,
    "SF Fin native login prepared",
    [
      `Prefilled /login ${PROVIDER_NAME}. Submit it, choose your region, then paste the personal API token into the masked prompt.`,
      "Create the token in Fin under Settings → Personal → API tokens. Pi owns persistence.",
    ].join("\n"),
    "info",
    fromPanel,
  );
}

async function disconnect(ctx: ExtensionCommandContext, fromPanel: boolean): Promise<void> {
  if (!hasStoredFinCredential()) {
    const message =
      detectTokenSource() === "env"
        ? `${ENV_TOKEN} is active. Native logout does not modify environment variables; unset it outside Pi and restart the session.`
        : "No SF Fin credential is saved.";
    return emit(ctx, "SF Fin disconnect", message, "info", fromPanel);
  }
  if (!ctx.hasUI) {
    return emit(
      ctx,
      "SF Fin disconnect",
      `Run \`/logout ${PROVIDER_NAME}\` in an interactive Pi session.`,
      "info",
      fromPanel,
    );
  }
  ctx.ui.setEditorText(`/logout ${PROVIDER_NAME}`);
  return emit(
    ctx,
    "SF Fin logout handoff",
    `Prefilled \`/logout ${PROVIDER_NAME}\`. Submit it to remove only the saved credential; environment variables are untouched.`,
    "info",
    fromPanel,
  );
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
