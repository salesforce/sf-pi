/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-fin — connect, install, diagnose, and debug a Fin (formerly Intercom)
 * workspace connection.
 *
 * Behavior matrix:
 *
 *   Event/Trigger            | Result
 *   -------------------------|---------------------------------------------------------
 *   extension load           | Register auth-only Provider, `sf_fin`, `/sf-fin`, doctor
 *   session_start/shutdown   | Bind/clear the masked credential prompt (no network)
 *   /sf-fin (no args)        | Open SF Pi Manager detail page when UI is available
 *   /sf-fin connect          | Prepare native `/login sf-fin` (region + masked token)
 *   /sf-fin disconnect       | Prefill native `/logout sf-fin`
 *   /sf-fin status           | Print cached credential/region/CLI/doctor status
 *   /sf-fin install [ver]    | Plan → confirm → `npm install -g @intercom/cli@<ver>` → verify
 *   /sf-fin doctor           | Live read-only checks (Node, CLI, version, credential, workspace)
 *   /sf-fin debug [on|off]   | Redacted bundle, or arm/disarm a one-shot verbose trace
 *   /sf-fin sdk [manifest|download] | Fin-as-code reads; enables the Fin SDK on first use
 *   /sf-pi doctor            | Cached sf-fin checks (no network, no credential)
 *   sf_fin <action>          | Same actions for the agent; install execution is Guardrail-mediated
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  getFirstTokenCompletionsFromActions,
  resolveAction,
} from "../../lib/common/command-actions.ts";
import { registerExtensionDoctor } from "../../lib/common/doctor/registry.ts";
import { buildExecFn } from "../../lib/common/exec-adapter.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import {
  registerManagerDetailActions,
  type ManagerDetailAction,
} from "../../lib/common/manager-actions.ts";
import { openExtensionInManager } from "../../lib/common/manager-deep-link.ts";
import { getInstalledPiVersion, requirePiVersion } from "../../lib/common/pi-compat.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { detectTokenSource, hasStoredFinCredential, sfFinAuthController } from "./lib/auth.ts";
import { SF_FIN_ACTIONS, renderHelp } from "./lib/command-surface.ts";
import { createFinConfirmPanel } from "./lib/manager-action-panels.ts";
import { createFinService, statusText, type FinService } from "./lib/service.ts";
import { registerSfFinTool } from "./lib/sf_fin-tool.ts";
import { COMMAND_NAME, ENV_REGION, ENV_TOKEN, PROVIDER_NAME } from "./lib/types.ts";

export default function sfFin(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-fin")) return;

  const service = createFinService({ exec: buildExecFn(pi) });

  pi.registerProvider(sfFinAuthController.provider);

  pi.on("session_start", async (_event, ctx) => {
    sfFinAuthController.bind(ctx.ui, ctx.mode);
  });
  pi.on("session_shutdown", async () => {
    sfFinAuthController.clear();
  });

  registerSfFinTool(pi, service, runtimeMeta);
  // Cached-only contribution to `/sf-pi doctor`: no network, no credential.
  registerExtensionDoctor("sf-fin", async () => service.cachedDoctorReport());

  pi.registerCommand(COMMAND_NAME, {
    description: "Connect, install, diagnose, and debug the Fin (formerly Intercom) workspace",
    getArgumentCompletions: (prefix: string) =>
      getFirstTokenCompletionsFromActions(SF_FIN_ACTIONS, prefix, {
        excludeValues: ["debug-on", "debug-off"],
      }),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const trimmed = (args ?? "").trim();
        if (!trimmed && ctx.hasUI) {
          const opened = await openExtensionInManager(pi, ctx, {
            extensionId: COMMAND_NAME,
            view: "detail",
            actions: buildManagerActions(service),
          });
          if (!opened)
            ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-fin.", "warning");
          return;
        }
        await handleCommand(service, ctx, trimmed, false);
      });
    },
  });

  registerManagerDetailActions(pi, COMMAND_NAME, buildManagerActions(service));
}

function buildManagerActions(service: FinService): ManagerDetailAction[] {
  return SF_FIN_ACTIONS.map((action) => ({
    id: action.value,
    label: action.label,
    description: action.description,
    group: action.group,
    run: (ctx) => handleCommand(service, ctx, actionArgs(action.value), true),
    ...(action.value === "install"
      ? {
          // Same plan → confirm → run → verify path as `/sf-fin install`, inside the Manager.
          createPanel: (theme, _cwd, _scope, done) =>
            createFinConfirmPanel({
              theme,
              title: "Install or update Fin CLI",
              loadDetail: async () => {
                const plan = await service.planInstall();
                if (plan.kind === "install" || plan.kind === "update") {
                  return {
                    detail: `${plan.reason}\n\nThis runs:\n${plan.command}\n\nIt changes your global npm packages.`,
                    canConfirm: true,
                    confirm: async () => (await service.install(plan)).text,
                  };
                }
                return {
                  detail: [plan.reason, plan.kind === "refused" ? plan.manual : undefined]
                    .filter(Boolean)
                    .join("\n"),
                  canConfirm: false,
                };
              },
              confirmLabel: "Install",
              done,
            }),
        }
      : {}),
  }));
}

function actionArgs(value: string): string {
  if (value === "debug-on") return "debug on";
  if (value === "debug-off") return "debug off";
  return value;
}

async function handleCommand(
  service: FinService,
  ctx: ExtensionCommandContext,
  rawArgs: string,
  fromPanel: boolean,
): Promise<void> {
  const parts = rawArgs.trim().split(/\s+/).filter(Boolean);
  const sub = parts[0] ? (resolveAction(SF_FIN_ACTIONS, parts[0]) ?? parts[0]) : "status";

  if (sub === "status") return emit(ctx, "SF Fin status", statusText(), "info", fromPanel);
  if (sub === "help") return emit(ctx, "SF Fin help", renderHelp(), "info", fromPanel);
  if (sub === "connect") return connect(ctx, fromPanel);
  if (sub === "disconnect") return disconnect(ctx, fromPanel);
  if (sub === "doctor") {
    const result = await service.doctor(ctx);
    return emit(
      ctx,
      result.outcome === "ok" ? "SF Fin connected" : "SF Fin doctor",
      result.text,
      result.outcome === "ok" ? "info" : "warning",
      fromPanel,
    );
  }
  if (sub === "install") return install(service, ctx, parts[1], fromPanel);
  if (sub === "sdk") {
    const operation = parts[1] === "download" ? "download" : "manifest";
    const result = await service.sdk(ctx, operation);
    return emit(
      ctx,
      operation === "download" ? "SF Fin SDK download" : "SF Fin SDK manifest",
      result.text,
      result.ok ? "info" : "warning",
      fromPanel,
    );
  }
  if (sub === "debug" || sub === "debug-on" || sub === "debug-off") {
    const mode = sub === "debug-on" ? "on" : sub === "debug-off" ? "off" : parts[1];
    if (mode === "on" || mode === "off") {
      const runs = parts[2] ? Number(parts[2]) : undefined;
      return emit(
        ctx,
        "SF Fin verbose trace",
        service.setVerbose(mode === "on", runs),
        "info",
        fromPanel,
      );
    }
    return emit(ctx, "SF Fin debug bundle", service.debugBundle(runtimeMeta()), "info", fromPanel);
  }
  return emit(
    ctx,
    "SF Fin — unknown subcommand",
    `Unknown /${COMMAND_NAME} subcommand: ${sub}. Use connect, disconnect, status, install, doctor, debug, sdk, or help.`,
    "warning",
    fromPanel,
  );
}

async function install(
  service: FinService,
  ctx: ExtensionCommandContext,
  version: string | undefined,
  fromPanel: boolean,
): Promise<void> {
  const plan = await service.planInstall(version);
  if (plan.kind === "noop" || plan.kind === "refused") {
    const result = await service.install(plan);
    return emit(
      ctx,
      "SF Fin install",
      result.text,
      plan.kind === "noop" ? "info" : "warning",
      fromPanel,
    );
  }
  if (!ctx.hasUI) {
    return emit(
      ctx,
      "SF Fin install",
      `${plan.reason}\nRun manually:\n${plan.command}\nor use sf_fin action='install' with allow_mutation=true.`,
      "info",
      fromPanel,
    );
  }
  const confirmed = await ctx.ui.confirm(
    "Install or update the Fin CLI?",
    `${plan.reason}\n\nThis runs:\n${plan.command}\n\nIt changes your global npm packages. Continue?`,
  );
  if (!confirmed)
    return emit(ctx, "SF Fin install cancelled", "No changes were made.", "info", fromPanel);

  ctx.ui.setStatus?.("sf-fin", `Installing ${plan.command.split(" ")[3] ?? "Fin CLI"}…`);
  try {
    const result = await service.install(plan);
    return emit(
      ctx,
      result.ok ? "SF Fin install complete" : "SF Fin install failed",
      result.text,
      result.ok ? "success" : "warning",
      fromPanel,
    );
  } finally {
    ctx.ui.setStatus?.("sf-fin", undefined);
  }
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

function runtimeMeta(): { sfPiVersion?: string; piVersion?: string } {
  let sfPiVersion: string | undefined;
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, "..", "..", "package.json"), "utf8"),
    ) as { version?: string };
    sfPiVersion = pkg.version;
  } catch {
    sfPiVersion = undefined;
  }
  return { sfPiVersion, piVersion: getInstalledPiVersion() };
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
