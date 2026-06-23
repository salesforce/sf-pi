/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-docs — Salesforce documentation lookup for agents and humans.
 *
 * Behavior matrix:
 *
 *   Event/Trigger          | Result
 *   -----------------------|---------------------------------------------------------
 *   extension load         | Register provider auth entry, `sf_docs`, `/sf-docs`
 *   /sf-docs (no args)     | Open SF Pi Manager detail page when UI is available
 *   /sf-docs connect       | Prompt for token and store it in Pi auth store
 *   /sf-docs status        | Print connection/default/cache status
 *   sf_docs search/fetch   | Call docs service via direct HTTP JSON-RPC/SSE transport
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import path from "node:path";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { getCompletionsFromActions, resolveAction } from "../../lib/common/command-actions.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import {
  openExtensionInManager,
  type SfPiManagerOpenRoute,
} from "../../lib/common/manager-deep-link.ts";
import {
  registerManagerDetailActions,
  type ManagerDetailAction,
} from "../../lib/common/manager-actions.ts";
import {
  detectTokenSource,
  getDocsToken,
  loginSfDocs,
  refreshSfDocsToken,
  resolveEndpoint,
} from "./lib/auth.ts";
import { DocsClient } from "./lib/client.ts";
import { formatCacheAge, readCatalogCache, writeCatalogCache } from "./lib/catalog-cache.ts";
import { readEffectiveDocsPreferences } from "./lib/preferences.ts";
import { formatCollections } from "./lib/render.ts";
import { registerSfDocsTool } from "./lib/sf_docs-tool.ts";
import { buildStatus } from "./lib/status.ts";
import {
  COMMAND_NAME,
  ENV_TOKEN,
  LONG_LIVED_EXPIRY_MS,
  MANUAL_REFRESH_SENTINEL,
  PROVIDER_NAME,
} from "./lib/types.ts";
import { SF_DOCS_ACTIONS, renderHelp } from "./lib/command-surface.ts";
import {
  createSfDocsConnectPanel,
  createSfDocsDisconnectPanel,
} from "./lib/manager-action-panels.ts";

export default function sfDocs(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-docs")) return;

  pi.registerProvider(PROVIDER_NAME, {
    apiKey: `$${ENV_TOKEN}`,
    oauth: {
      name: "SF Docs",
      login: loginSfDocs,
      refreshToken: refreshSfDocsToken,
      getApiKey: (credentials) => credentials.access,
    },
  });

  registerSfDocsTool(pi);

  pi.registerCommand(COMMAND_NAME, {
    description: "Search and configure Salesforce documentation lookup",
    getArgumentCompletions: (prefix: string) =>
      getCompletionsFromActions(SF_DOCS_ACTIONS, prefix.trim().split(/\s+/).at(-1) ?? ""),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const trimmed = (args ?? "").trim();
        if (!trimmed && ctx.hasUI) {
          await openDocsInManager(pi, ctx, "detail");
          return;
        }
        await handleCommand(pi, ctx, trimmed, false);
      });
    },
  });

  registerManagerDetailActions(pi, COMMAND_NAME, buildManagerActions(pi));
}

function buildManagerActions(pi: ExtensionAPI): ManagerDetailAction[] {
  return SF_DOCS_ACTIONS.map((action) => ({
    id: action.value,
    label: action.label,
    description: action.description,
    group: action.group,
    run: (ctx) => handleCommand(pi, ctx, action.value, true),
    ...(action.value === "connect"
      ? {
          createPanel: (theme, _cwd, _scope, done, ctx) =>
            createSfDocsConnectPanel({
              theme,
              done,
              connect: (token) => connectWithToken(ctx, token),
            }),
        }
      : {}),
    ...(action.value === "disconnect"
      ? {
          createPanel: (theme, _cwd, _scope, done, ctx) =>
            createSfDocsDisconnectPanel({
              theme,
              tokenSourceLabel: detectTokenSource(),
              done,
              disconnect: () => disconnectSavedToken(ctx),
            }),
        }
      : {}),
  }));
}

async function openDocsInManager(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  view: NonNullable<SfPiManagerOpenRoute["view"]>,
): Promise<void> {
  const opened = await openExtensionInManager(pi, ctx, {
    extensionId: COMMAND_NAME,
    view,
    actions: buildManagerActions(pi),
  });
  if (!opened) ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-docs.", "warning");
}

async function handleCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  rawArgs: string,
  fromPanel: boolean,
): Promise<void> {
  const parts = rawArgs.trim().split(/\s+/).filter(Boolean);
  const sub = parts[0] ? (resolveAction(SF_DOCS_ACTIONS, parts[0]) ?? parts[0]) : "status";

  if (sub === "connect") return connect(ctx, fromPanel);
  if (sub === "disconnect") return disconnect(ctx, fromPanel);
  if (sub === "status") return emit(ctx, "SF Docs status", buildStatus(ctx.cwd), "info", fromPanel);
  if (sub === "help") return emit(ctx, "SF Docs help", renderHelp(), "info", fromPanel);
  if (sub === "cheatsheet")
    return emit(ctx, "SF Docs cheatsheet", readCheatsheet(), "info", fromPanel);
  if (sub === "collections" || sub === "refresh") {
    // Reuse the public tool path so command behavior stays aligned with agent behavior.
    const refresh = sub === "refresh";
    const result = await listCollections(ctx, refresh);
    return emit(
      ctx,
      refresh ? "SF Docs catalog refreshed" : "SF Docs collections",
      result,
      "info",
      fromPanel,
    );
  }

  return emit(
    ctx,
    "SF Docs — unknown subcommand",
    `Unknown /sf-docs subcommand: ${sub}. Use status, connect, disconnect, collections, refresh, cheatsheet, or help.`,
    "warning",
    fromPanel,
  );
}

async function connect(ctx: ExtensionCommandContext, fromPanel: boolean): Promise<void> {
  if (!ctx.hasUI) {
    return emit(
      ctx,
      "SF Docs connect requires UI",
      `Run /sf-docs connect in interactive mode, or set ${ENV_TOKEN} for automation.`,
      "warning",
      fromPanel,
    );
  }
  try {
    await ctx.modelRegistry.authStorage.login(PROVIDER_NAME, {
      onAuth: (info) =>
        ctx.ui.notify(`${info.instructions ?? "Authenticate SF Docs"}\n${info.url ?? ""}`, "info"),
      onPrompt: async (prompt) => {
        const value = await ctx.ui.editor(prompt.message, "");
        if (value == null || !value.trim()) throw new Error("SF Docs connect cancelled.");
        return value.trim();
      },
      onProgress: (message) => ctx.ui.notify(message, "info"),
      onDeviceCode: (info) =>
        ctx.ui.notify(`Open ${info.verificationUri}\nCode: ${info.userCode}`, "info"),
      onSelect: async () => {
        throw new Error("SF Docs connect does not support selection prompts.");
      },
    });
    return emit(
      ctx,
      "SF Docs connected",
      "Saved SF Docs token in Pi's local auth store.",
      "success",
      fromPanel,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return emit(
      ctx,
      "SF Docs connect failed",
      message,
      message.includes("cancelled") ? "info" : "error",
      fromPanel,
    );
  }
}

function connectWithToken(ctx: ExtensionCommandContext, token: string): string {
  ctx.modelRegistry.authStorage.set(PROVIDER_NAME, {
    type: "oauth",
    refresh: MANUAL_REFRESH_SENTINEL,
    access: token,
    expires: Date.now() + LONG_LIVED_EXPIRY_MS,
  });
  return "Saved SF Docs token in Pi's local auth store.";
}

async function disconnect(ctx: ExtensionCommandContext, fromPanel: boolean): Promise<void> {
  if (ctx.hasUI) {
    const confirmed = await ctx.ui.confirm(
      "Disconnect SF Docs?",
      `This clears the saved ${PROVIDER_NAME} credential. ${ENV_TOKEN} is left untouched.`,
    );
    if (!confirmed)
      return emit(
        ctx,
        "Disconnect cancelled",
        "SF Docs credential left in place.",
        "info",
        fromPanel,
      );
  }
  return emit(ctx, "SF Docs disconnected", disconnectSavedToken(ctx), "success", fromPanel);
}

function disconnectSavedToken(ctx: ExtensionCommandContext): string {
  ctx.modelRegistry.authStorage.set(PROVIDER_NAME, {
    type: "oauth",
    refresh: MANUAL_REFRESH_SENTINEL,
    access: "",
    expires: Date.now() + LONG_LIVED_EXPIRY_MS,
  });
  ctx.modelRegistry.authStorage.logout(PROVIDER_NAME);
  return `Cleared saved ${PROVIDER_NAME} credential.`;
}

async function listCollections(ctx: ExtensionCommandContext, refresh: boolean): Promise<string> {
  const prefs = readEffectiveDocsPreferences(ctx.cwd);
  const cache = readCatalogCache();
  if (prefs.cacheCatalog && !refresh && cache.hit && !cache.stale && cache.collections) {
    return formatCollections({
      collections: cache.collections,
      cache: `hit · ${formatCacheAge(cache.fetchedAt)}`,
    });
  }

  const auth = await getDocsToken(ctx);
  if (auth.ok === false) return auth.message;
  const endpoint = resolveEndpoint();
  const client = new DocsClient({ endpoint: endpoint.endpoint, token: auth.token });
  const response = (await client.callTool("list", {}, ctx.signal)) as { collections?: unknown[] };
  const collections = Array.isArray(response.collections) ? response.collections : [];
  if (prefs.cacheCatalog) writeCatalogCache(collections as never[]);
  return formatCollections({ collections, cache: refresh ? "refreshed" : "miss/refreshed" });
}

function readCheatsheet(): string {
  // Lazy file read so the cheatsheet is not loaded into context unless requested.
  return readFileSync(path.join(import.meta.dirname, "docs", "cheatsheet.md"), "utf8");
}

async function emit(
  ctx: ExtensionCommandContext,
  title: string,
  body: string,
  severity: InfoPanelSeverity | "success",
  fromPanel: boolean,
): Promise<void> {
  const panelSeverity: InfoPanelSeverity = severity === "success" ? "info" : severity;
  if (fromPanel && ctx.hasUI) {
    await openInfoPanel(ctx, { title, body, severity: panelSeverity });
    return;
  }
  if (ctx.hasUI) {
    ctx.ui.notify(body, panelSeverity);
    return;
  }
  console.info(body);
}
