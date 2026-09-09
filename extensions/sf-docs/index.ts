/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-docs — Salesforce documentation lookup for agents and humans.
 *
 * Behavior matrix:
 *
 *   Event/Trigger          | Result
 *   -----------------------|---------------------------------------------------------
 *   extension load         | Register endpoint-only Provider, `sf_docs`, `/sf-docs`
 *   session_start          | Publish a cache-first DevBar pill
 *   /sf-docs (no args)     | Open SF Pi Manager detail page when UI is available
 *   /sf-docs connect       | Prepare native `/login sf-docs` (endpoint URL only)
 *   /sf-docs status        | Print endpoint/default/cache status
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
import { setDocsStatus } from "../../lib/common/docs-status/store.ts";
import { glyph, resolveGlyphMode } from "../../lib/common/glyph-policy.ts";
import { getDocsEndpoint, resolveEndpoint, sfDocsProvider } from "./lib/auth.ts";
import { classifyDocsFooterStatus, formatDocsFooterStatus } from "./lib/footer-status.ts";
import { DocsClient } from "./lib/client.ts";
import { formatCacheAge, readCatalogCache, writeCatalogCache } from "./lib/catalog-cache.ts";
import { readEffectiveDocsPreferences } from "./lib/preferences.ts";
import { parseListResponse } from "./lib/protocol.ts";
import { formatCollections } from "./lib/render.ts";
import { registerSfDocsTool, summarizeCollectionCapabilities } from "./lib/sf_docs-tool.ts";
import { buildStatus } from "./lib/status.ts";
import {
  COMMAND_NAME,
  ENV_ENDPOINT,
  PROVIDER_NAME,
  WIDGET_KEY,
  type DocsCollection,
} from "./lib/types.ts";
import { SF_DOCS_ACTIONS, renderHelp } from "./lib/command-surface.ts";
import {
  createSfDocsConnectPanel,
  createSfDocsDisconnectPanel,
} from "./lib/manager-action-panels.ts";

export default function sfDocs(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-docs")) return;

  pi.registerProvider(sfDocsProvider);
  publishDocsConnection();

  pi.on("session_start", async (_event, ctx) => {
    publishDocsConnection(ctx);
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
          createPanel: (theme, _cwd, _scope, done, ctx) =>
            createSfDocsConnectPanel({
              theme,
              done,
              prepareLogin: () =>
                prepareDocsLogin(ctx)
                  ? `Prepared /login ${PROVIDER_NAME} in Pi's editor.`
                  : `Run /login ${PROVIDER_NAME} in interactive TUI mode.`,
            }),
        }
      : {}),
    ...(action.value === "disconnect"
      ? {
          createPanel: (theme, _cwd, _scope, done, ctx) =>
            createSfDocsDisconnectPanel({
              theme,
              endpointSourceLabel: resolveEndpoint().source,
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
  publishDocsConnection(ctx);
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
  const prepared = prepareDocsLogin(ctx);
  return emit(
    ctx,
    prepared ? "SF Docs native login prepared" : "SF Docs interactive login requires TUI mode",
    prepared
      ? [
          `Prefilled /login ${PROVIDER_NAME}.`,
          "Native login collects and persists only an internally supplied docs endpoint URL. No access token is required or transmitted.",
          `${ENV_ENDPOINT} remains available for automation and is never modified.`,
        ].join("\n")
      : `Run /login ${PROVIDER_NAME} in interactive TUI mode, or set ${ENV_ENDPOINT} before starting Pi for automation.`,
    prepared ? "info" : "warning",
    fromPanel,
  );
}

function prepareDocsLogin(ctx: ExtensionCommandContext): boolean {
  if (ctx.mode !== "tui") return false;
  ctx.ui.setEditorText(`/login ${PROVIDER_NAME}`);
  return true;
}

function publishDocsConnection(ctx?: {
  hasUI?: boolean;
  cwd?: string;
  ui?: {
    setStatus?(key: string, value: string | undefined): void;
    theme?: { fg(color: string, text: string): string };
  };
}): void {
  const kind = classifyDocsFooterStatus(resolveEndpoint());
  setDocsStatus({ kind });
  if (!ctx?.hasUI || !ctx.ui?.setStatus || !ctx.ui.theme) return;
  const pill = formatDocsFooterStatus(
    { icon: glyph("docs", resolveGlyphMode({ cwd: ctx.cwd })), kind },
    ctx.ui.theme,
  );
  ctx.ui.setStatus(WIDGET_KEY, pill ?? undefined);
}

async function disconnect(ctx: ExtensionCommandContext, fromPanel: boolean): Promise<void> {
  if (ctx.hasUI) {
    const confirmed = await ctx.ui.confirm(
      "Disconnect SF Docs?",
      `This clears the endpoint saved by /login ${PROVIDER_NAME}. ${ENV_ENDPOINT} is left untouched.`,
    );
    if (!confirmed)
      return emit(
        ctx,
        "Disconnect cancelled",
        "SF Docs endpoint configuration left in place.",
        "info",
        fromPanel,
      );
  }
  return emit(ctx, "SF Docs logout handoff", prepareDocsLogout(ctx), "info", fromPanel);
}

function prepareDocsLogout(ctx: ExtensionCommandContext): string {
  const source = resolveEndpoint().source;
  if (source === "none") return "No SF Docs endpoint is configured.";
  if (source === "env") {
    return `${ENV_ENDPOINT} is active. Native logout does not modify environment variables; unset it outside Pi and restart the session.`;
  }
  if (!ctx.hasUI) {
    return `Run \`/logout ${PROVIDER_NAME}\` in an interactive Pi session. ${ENV_ENDPOINT} is left untouched.`;
  }
  ctx.ui.setEditorText(`/logout ${PROVIDER_NAME}`);
  return `Prefilled \`/logout ${PROVIDER_NAME}\` in the editor. Review and submit it to clear only the saved endpoint; ${ENV_ENDPOINT} is left untouched.`;
}

async function listCollections(ctx: ExtensionCommandContext, refresh: boolean): Promise<string> {
  const prefs = readEffectiveDocsPreferences(ctx.cwd);
  const endpoint = await getDocsEndpoint(ctx);
  if (endpoint.ok === false) return endpoint.message;
  const cache = readCatalogCache(Date.now(), endpoint.endpoint);
  if (prefs.cacheCatalog && !refresh && cache.hit && !cache.stale && cache.collections) {
    return formatCollectionCatalog(cache.collections, `hit · ${formatCacheAge(cache.fetchedAt)}`);
  }

  const client = new DocsClient({ endpoint: endpoint.endpoint });
  const response = parseListResponse(await client.callTool("list", {}, ctx.signal));
  if (response.error) return `Docs service error: ${response.error}`;
  const collections: DocsCollection[] = response.collections ?? [];
  if (prefs.cacheCatalog) writeCatalogCache(collections, Date.now(), endpoint.endpoint);
  return formatCollectionCatalog(collections, refresh ? "refreshed" : "miss/refreshed");
}

function formatCollectionCatalog(collections: DocsCollection[], cache: string): string {
  return formatCollections({
    collections,
    capabilitySummaries: collections.map(summarizeCollectionCapabilities),
    cache,
  });
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
