/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import {
  openExtensionInManager,
  type SfPiManagerOpenRoute,
} from "../../lib/common/manager-deep-link.ts";
import {
  registerManagerDetailActions,
  type ManagerDetailAction,
} from "../../lib/common/manager-actions.ts";
import {
  completeArgumentTail,
  parseArgumentCompletionPrefix,
  type SfPiArgumentCompletion,
  type SfPiCompletionOption,
} from "../../lib/common/command-actions.ts";
import { openInfoPanel } from "../../lib/common/info-panel.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { clearExplorerCache, cacheStatus } from "./lib/cache.ts";
import { buildHelpText, parseCommandArgs, type ParsedCommandArgs } from "./lib/command.ts";
import { readEffectiveDataExplorerSettings } from "./lib/settings.ts";
import { createData360SqlStrategy, type Data360ObjectMeta } from "./lib/modes/data360-sql.ts";
import { createSoqlStrategy, type CoreSObjectMeta } from "./lib/modes/soql.ts";
import { createSoslStrategy } from "./lib/modes/sosl.ts";
import {
  clearSfDataExplorerTransportCacheIfInitialized,
  getSfDataExplorerTransport,
  type SfDataExplorerTransport,
} from "./lib/transport.ts";
import { ExplorerSpa, type ExplorerSpaResult } from "./lib/ui/explorer-spa.ts";
import type { ExplorerMode, ExplorerStrategy } from "./lib/types.ts";

const COMMAND = "sf-data-explorer";

const DATA_EXPLORER_TOP_LEVEL_COMPLETIONS: readonly SfPiCompletionOption[] = [
  { value: "soql", label: "soql", description: "Open the SOQL Explorer", appendSpace: true },
  { value: "sosl", label: "sosl", description: "Open the SOSL Explorer", appendSpace: true },
  { value: "sql", label: "sql", description: "Open the Data 360 SQL Explorer", appendSpace: true },
  { value: "default", label: "default", description: "Open the configured default explorer" },
  { value: "refresh", label: "refresh", description: "Refresh explorer metadata" },
];

const DATA_EXPLORER_MODE_COMPLETIONS: readonly SfPiCompletionOption[] = [
  { value: "refresh", label: "refresh", description: "Refresh explorer metadata" },
];

export function getDataExplorerArgumentCompletions(
  prefix: string,
): SfPiArgumentCompletion[] | null {
  const context = parseArgumentCompletionPrefix(prefix);
  if (context.tokenIndex === 0)
    return completeArgumentTail(DATA_EXPLORER_TOP_LEVEL_COMPLETIONS, context);
  if (
    ["soql", "sosl", "sql"].includes(context.tokens[0]?.toLowerCase() ?? "") &&
    context.tokenIndex === 1
  ) {
    return completeArgumentTail(DATA_EXPLORER_MODE_COMPLETIONS, context);
  }
  return null;
}

export default function sfDataExplorer(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-data-explorer")) return;

  registerManagerDetailActions(pi, COMMAND, buildDataExplorerManagerActions(pi));

  pi.on("session_start", () => {
    clearExplorerCache();
    clearSfDataExplorerTransportCacheIfInitialized();
  });
  pi.on("session_shutdown", () => {
    clearExplorerCache();
    clearSfDataExplorerTransportCacheIfInitialized();
  });

  pi.registerCommand(COMMAND, {
    description: "Read-only interactive SOQL, SOSL, and Data 360 SQL explorer",
    getArgumentCompletions: getDataExplorerArgumentCompletions,
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND, async () => {
        if (!(args || "").trim() && ctx.hasUI) {
          await openDataExplorerInManager(pi, ctx, "detail");
          return;
        }
        await handleCommand(pi, ctx, args || "");
      });
    },
  });
}

async function handleCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string,
): Promise<void> {
  const settings = readEffectiveDataExplorerSettings(ctx.cwd);
  const parsed = parseCommandArgs(args, settings.defaultOrg);
  if (parsed.help) {
    ctx.ui.setEditorText(buildHelpText());
    ctx.ui.notify("SF Data Explorer help copied to editor.", "info");
    return;
  }
  if (ctx.mode !== "tui") {
    const message = "/sf-data-explorer requires interactive pi TUI mode.";
    if (ctx.hasUI) ctx.ui.notify(message, "error");
    else console.info(message);
    return;
  }
  if (!parsed.mode && !args.trim()) {
    const pickedMode = await pickMode(ctx);
    if (!pickedMode) return;
    parsed.mode = pickedMode;
  }
  const mode = parsed.mode ?? settings.defaultMode ?? (await pickMode(ctx));
  if (!mode) return;
  let current: ParsedCommandArgs & { mode: ExplorerMode } = { ...parsed, mode };
  for (;;) {
    const result = await launchExplorer(pi, ctx, current);
    if (result?.kind !== "switchMode") break;
    current = { ...current, mode: result.mode, object: undefined, forceRefresh: false };
  }
}

type DataExplorerManagerActionId = "open.soql" | "open.sosl" | "open.sql" | "help";

const DATA_EXPLORER_MANAGER_ACTIONS: Array<{
  id: DataExplorerManagerActionId;
  label: string;
  description: string;
  args: string;
}> = [
  {
    id: "open.soql",
    label: "Open SOQL Explorer",
    description: "Browse queryable core Salesforce sObjects, select fields, edit/run SOQL.",
    args: "soql",
  },
  {
    id: "open.sosl",
    label: "Open SOSL Explorer",
    description: "Browse searchable sObjects, build/edit/run SOSL searches.",
    args: "sosl",
  },
  {
    id: "open.sql",
    label: "Open Data 360 SQL Explorer",
    description: "Browse Data 360 DMO/DLO metadata, select fields, edit/run Data 360 SQL.",
    args: "sql",
  },
  {
    id: "help",
    label: "Show help",
    description: "Show command examples, keybindings, and read-only safety notes.",
    args: "help",
  },
];

function buildDataExplorerManagerActions(pi: ExtensionAPI): ManagerDetailAction[] {
  return DATA_EXPLORER_MANAGER_ACTIONS.map((action) => ({
    id: action.id,
    label: action.label,
    description: action.description,
    run: (ctx) =>
      action.id === "help" ? openDataExplorerHelp(ctx) : handleCommand(pi, ctx, action.args),
    closeBeforeRun: action.id !== "help",
  }));
}

async function openDataExplorerHelp(ctx: ExtensionCommandContext): Promise<void> {
  await openInfoPanel(ctx, {
    title: "SF Data Explorer help",
    body: buildHelpText(),
    severity: "info",
  });
}

async function openDataExplorerInManager(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  view: NonNullable<SfPiManagerOpenRoute["view"]>,
): Promise<void> {
  const opened = await openExtensionInManager(pi, ctx, {
    extensionId: COMMAND,
    view,
    actions: buildDataExplorerManagerActions(pi),
  });

  if (!opened) {
    ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-data-explorer.", "warning");
  }
}

async function pickMode(ctx: ExtensionCommandContext): Promise<ExplorerMode | undefined> {
  const picked = await ctx.ui.select("SF Data Explorer mode", [
    "SOQL Explorer",
    "SOSL Explorer",
    "Data 360 SQL Explorer",
    "Cancel",
  ]);
  if (!picked || picked === "Cancel") return undefined;
  if (picked.startsWith("SOQL")) return "soql";
  if (picked.startsWith("SOSL")) return "sosl";
  return "sql";
}

async function launchExplorer(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  parsed: ParsedCommandArgs & { mode: ExplorerMode },
): Promise<ExplorerSpaResult> {
  const transport = await getSfDataExplorerTransport(pi);
  const strategy = await buildInitialStrategy(pi, ctx, transport, parsed);
  if (!strategy) return undefined;
  const result = await ctx.ui.custom<ExplorerSpaResult>((tui, theme, _keybindings, done) => {
    const spa = new ExplorerSpa({
      org: parsed.org,
      cwd: ctx.cwd,
      theme,
      strategy,
      transportInfo: transport.info,
      setEditorText: (text) => ctx.ui.setEditorText(text),
      notify: (message, level) => ctx.ui.notify(message, level),
      done: (result) => done(result),
      requestRender: () => tui.requestRender(),
    });
    if (parsed.object) void spa.selectObjectByName(parsed.object, parsed.forceRefresh);
    return spa;
  });
  if (result?.kind === "copyToEditor") {
    ctx.ui.setEditorText(result.text);
    ctx.ui.notify(`Copied ${result.label} to editor.`, "info");
  }
  return result;
}

async function buildInitialStrategy(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  transport: SfDataExplorerTransport,
  parsed: ParsedCommandArgs & { mode: ExplorerMode },
): Promise<ExplorerStrategy<unknown, unknown> | undefined> {
  if (parsed.mode === "soql") {
    const empty = createSoqlStrategy({
      transport,
      org: parsed.org,
      initial: { objects: [], cacheLine: "Loading SOQL catalog…" },
    });
    const loaded = await runWithLoader(
      ctx,
      `${parsed.forceRefresh ? "Refreshing" : "Loading"} SOQL sObject catalog for ${parsed.org}…`,
      () => empty.loadCatalog(parsed.forceRefresh),
    );
    if (!loaded) return undefined;
    const cacheLine = cacheStatus(loaded.kindLabel, loaded.cached, loaded.loadedAt);
    ctx.ui.notify(cacheLine, "info");
    return createSoqlStrategy({
      transport,
      org: parsed.org,
      initial: { objects: loaded.value as CoreSObjectMeta[], cacheLine },
    });
  }
  if (parsed.mode === "sosl") {
    const empty = createSoslStrategy({
      transport,
      org: parsed.org,
      initial: { objects: [], cacheLine: "Loading SOSL catalog…" },
    });
    const loaded = await runWithLoader(
      ctx,
      `${parsed.forceRefresh ? "Refreshing" : "Loading"} SOSL searchable catalog for ${parsed.org}…`,
      () => empty.loadCatalog(parsed.forceRefresh),
    );
    if (!loaded) return undefined;
    const cacheLine = cacheStatus(loaded.kindLabel, loaded.cached, loaded.loadedAt);
    ctx.ui.notify(cacheLine, "info");
    return createSoslStrategy({
      transport,
      org: parsed.org,
      initial: { objects: loaded.value as CoreSObjectMeta[], cacheLine },
    });
  }
  const empty = createData360SqlStrategy({
    transport,
    org: parsed.org,
    initial: { objects: [], cacheLine: "Loading Data 360 catalog…" },
    requestRender: () => {},
  });
  const loaded = await runWithLoader(
    ctx,
    `${parsed.forceRefresh ? "Refreshing" : "Loading"} Data 360 DMO+DLO catalog for ${parsed.org}…`,
    () => empty.loadCatalog(parsed.forceRefresh),
  );
  if (!loaded) return undefined;
  const cacheLine = cacheStatus(loaded.kindLabel, loaded.cached, loaded.loadedAt);
  ctx.ui.notify(cacheLine, "info");
  return createData360SqlStrategy({
    transport,
    org: parsed.org,
    initial: { objects: loaded.value as Data360ObjectMeta[], cacheLine },
    requestRender: () => {},
  });
}

async function runWithLoader<T>(
  ctx: ExtensionCommandContext,
  label: string,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  const result = await ctx.ui.custom<T | { error: string } | null>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(tui as never, theme, label);
    loader.onAbort = () => done(null);
    work(loader.signal)
      .then(done)
      .catch((error: unknown) =>
        done({ error: error instanceof Error ? error.message : String(error) }),
      );
    return loader;
  });
  if (result === null) {
    ctx.ui.notify("Cancelled", "info");
    return undefined;
  }
  if (typeof result === "object" && result && "error" in result) {
    ctx.ui.notify(String((result as { error: string }).error), "error");
    return undefined;
  }
  return result as T;
}
