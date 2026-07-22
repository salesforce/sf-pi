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
 *   /sf-docs connect       | Explain temporary credential-entry containment
 *   /sf-docs status        | Print connection/default/cache status
 *   sf_docs search/fetch   | Call docs service via direct HTTP JSON-RPC/SSE transport
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import path from "node:path";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import {
  getFirstTokenCompletionsFromActions,
  resolveAction,
} from "../../lib/common/command-actions.ts";
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
import { COMMAND_NAME, ENV_TOKEN, PROVIDER_NAME } from "./lib/types.ts";
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
      getFirstTokenCompletionsFromActions(SF_DOCS_ACTIONS, prefix),
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
          createPanel: (theme, _cwd, _scope, done, _ctx) =>
            createSfDocsConnectPanel({ theme, done }),
        }
      : {}),
    ...(action.value === "disconnect"
      ? {
          createPanel: (theme, _cwd, _scope, done, ctx) =>
            createSfDocsDisconnectPanel({
              theme,
              tokenSourceLabel: detectTokenSource(),
              done,
              disconnect: () => prepareDocsLogout(ctx),
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
  return emit(
    ctx,
    "SF Docs credential entry temporarily unavailable",
    [
      "Credential entry is temporarily unavailable because Pi's current native prompt can echo submitted secret values.",
      "Existing saved credentials remain active.",
      `Set ${ENV_TOKEN} before starting Pi for new automation or CI sessions.`,
      "If you entered a token through the previous visible input, rotate it with the credential issuer.",
    ].join("\n"),
    "warning",
    fromPanel,
  );
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
  return emit(ctx, "SF Docs logout handoff", prepareDocsLogout(ctx), "info", fromPanel);
}

function prepareDocsLogout(ctx: ExtensionCommandContext): string {
  const source = detectTokenSource();
  if (source === "none") return "No SF Docs credential is configured.";
  if (source === "env") {
    return `${ENV_TOKEN} is active. Native logout does not modify environment variables; unset it outside Pi and restart the session.`;
  }
  if (!ctx.hasUI) {
    return `Run \`/logout ${PROVIDER_NAME}\` in an interactive Pi session. ${ENV_TOKEN} is left untouched.`;
  }
  ctx.ui.setEditorText(`/logout ${PROVIDER_NAME}`);
  return `Prefilled \`/logout ${PROVIDER_NAME}\` in the editor. Review and submit it to clear only the saved credential; ${ENV_TOKEN} is left untouched.`;
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
