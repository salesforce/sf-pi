/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-lsp behavior contract
 *
 * Advisory LSP diagnostics after `write`/`edit` tool results, plus a few
 * user-facing TUI surfaces. The LLM-facing text contract is unchanged —
 * see `lib/feedback.ts`.
 *
 * Surfaces (all optional, all feature-gated by `ctx.hasUI`):
 *
 *   Surface                | Pi API                                 | Lifetime
 *   -----------------------|----------------------------------------|--------------------
 *   Working indicator      | ctx.ui.setWorkingIndicator             | streaming window
 *   Top-bar LSP segment    | sf-lsp-health registry -> sf-devbar    | permanent
 *   Transcript row         | pi.sendMessage + registerMessageRenderer| per event
 *   Rich /sf-lsp panel     | ctx.ui.custom overlay + SelectList     | on-demand
 *
 * Earlier revisions shipped a separate HUD overlay; it was removed in
 * favor of rendering permanent per-language availability inside
 * sf-devbar's top bar via the shared `lib/common/sf-lsp-health` registry.
 * The transcript row, working indicator, and `/sf-lsp` panel all stay.
 *
 * NOTE: sf-lsp intentionally does NOT override the built-in `edit`/`write`
 * tools. Pi's cross-extension conflict detector refuses to load any
 * extension that re-registers a tool name already claimed by another
 * extension (commonly `pi-tool-display`).
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@mariozechner/pi-coding-agent";
import { isEditToolResult, isWriteToolResult } from "@mariozechner/pi-coding-agent";
import { getLspDiagnosticsForFile, doctorLsp, shutdownLspClients } from "./lib/lsp-client.ts";
import { getSfLspLanguageForFile, resolveToolPath } from "./lib/file-classify.ts";
import {
  createState,
  resetState,
  buildToolResultUpdate,
  renderDoctorReport,
  type ToolResultContentPart,
} from "./lib/feedback.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import {
  createActivityStore,
  recordCheck,
  resetActivityStore,
  seedFromDoctor,
  markChecking,
  type LspActivityEntry,
} from "./lib/activity.ts";
import {
  createWorkingIndicatorState,
  popLspIndicator,
  pushLspIndicator,
  resetLspIndicator,
} from "./lib/working-indicator.ts";
import {
  createTranscriptRenderer,
  emitTranscriptRow,
  shouldEmitTranscriptRow,
  LSP_TRANSCRIPT_CUSTOM_TYPE,
  type LspTranscriptDetails,
} from "./lib/transcript.ts";
import { openSfLspPanel, type SfLspPanelAction } from "./lib/panel.ts";
import {
  readEffectiveSfLspSettings,
  writeScopedSfLspSettings,
  type SfLspUiSettings,
} from "./lib/settings-io.ts";
import type {
  SfPiDiagnosticMetadataItem,
  SfPiDiagnosticsMetadata,
} from "../../lib/common/display/diagnostics.ts";
import { SF_PI_DIAGNOSTICS_DETAILS_KEY } from "../../lib/common/display/diagnostics.ts";
import type { LspDiagnostic, SupportedLanguage } from "./lib/types.ts";
import {
  resetSfLspHealth,
  setSfLspActivity,
  setSfLspHealthFromDoctor,
} from "../../lib/common/sf-lsp-health/index.ts";

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const DIAGNOSTIC_TIMEOUT_MS = 6000;
const TRANSCRIPT_PREVIEW_LIMIT = 3;

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export default function sfLspExtension(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-lsp")) return;

  // --- Module-scoped state -------------------------------------------------------------------
  const state = createState();
  const activity = createActivityStore();
  const workingIndicator = createWorkingIndicatorState();

  // Settings (user-tunable: just transcript verbosity now)
  let uiSettings: SfLspUiSettings = { verbose: false };
  const unavailableSeenByLanguage = new Set<SupportedLanguage>();

  // --- Register transcript message renderer -------------------------------------------------
  pi.registerMessageRenderer<LspTranscriptDetails>(
    LSP_TRANSCRIPT_CUSTOM_TYPE,
    createTranscriptRenderer(),
  );

  // --- Core hooks -----------------------------------------------------------------------------
  registerMainCommand(pi);
  registerSessionHooks(pi);
  registerToolResultHook(pi);

  // ==========================================================================================
  // Session lifecycle
  // ==========================================================================================

  function registerSessionHooks(pi: ExtensionAPI): void {
    pi.on("session_start", async (_event, ctx) => {
      resetState(state);
      resetActivityStore(activity);
      unavailableSeenByLanguage.clear();
      resetSfLspHealth();

      const effective = readEffectiveSfLspSettings(ctx.cwd);
      uiSettings = { verbose: effective.verbose };

      if (!ctx.hasUI) return;

      // Probe doctor in the background so the top-bar LSP segment fills in
      // with green/red availability before the first check fires.
      void doctorLsp(ctx.cwd)
        .then((statuses) => {
          seedFromDoctor(activity, statuses);
          setSfLspHealthFromDoctor(statuses);
        })
        .catch(() => {
          // doctor runs on a best-effort basis; leave health as "unknown"
        });
    });

    pi.on("session_shutdown", async (event, ctx) => {
      if (ctx) resetLspIndicator(ctx, workingIndicator);
      resetState(state);
      resetActivityStore(activity);
      unavailableSeenByLanguage.clear();
      resetSfLspHealth();
      if (event.reason !== "reload") {
        await shutdownLspClients();
      }
    });
  }

  // ==========================================================================================
  // tool_result hook
  // ==========================================================================================

  function registerToolResultHook(pi: ExtensionAPI): void {
    pi.on("tool_result", async (event, ctx) => {
      return await handleToolResult(pi, event, ctx);
    });
  }

  async function handleToolResult(pi: ExtensionAPI, event: ToolResultEvent, ctx: ExtensionContext) {
    if (event.isError) return undefined;
    if (!isEditToolResult(event) && !isWriteToolResult(event)) return undefined;

    const rawPath = event?.input?.path;
    if (typeof rawPath !== "string" || rawPath.trim() === "") return undefined;

    const filePath = resolveToolPath(rawPath, ctx.cwd);
    const language = getSfLspLanguageForFile(filePath);
    if (!language) return undefined;

    // When sf-agentscript-assist is loaded it handles `.agent` files. We
    // mirror the metadata it stamps onto `event.details` so the transcript
    // stays accurate for `.agent` edits. Load order is alphabetical, so the
    // assist extension always runs before us.
    if (language === "agentscript" && isAgentScriptAssistInstalled(pi)) {
      observeExternalDiagnostics(pi, event, filePath, language);
      return undefined;
    }

    const previousFileStatus = state.lastStatusByFile.get(filePath);
    const fileName = basename(filePath);

    markChecking(activity, language, filePath, fileName);
    setSfLspActivity(language, "checking", { fileName });
    pushLspIndicator(ctx, workingIndicator, language);

    const startedAt = Date.now();
    let lspResult;
    try {
      lspResult = await getLspDiagnosticsForFile(
        language,
        filePath,
        ctx.cwd,
        DIAGNOSTIC_TIMEOUT_MS,
      );
    } finally {
      popLspIndicator(ctx, workingIndicator);
    }
    const finishedAt = Date.now();

    const existingContent: ToolResultContentPart[] = Array.isArray(event.content)
      ? event.content
      : [];

    const update = buildToolResultUpdate({
      filePath,
      language,
      existingContent,
      existingDetails: event.details,
      lspResult,
      state,
    });

    const metadata = extractDiagnosticsMetadata(update?.details);

    const entry = recordCheck(activity, {
      language,
      filePath,
      startedAt,
      finishedAt,
      diagnostics: lspResult.diagnostics,
      unavailable: lspResult.unavailable,
      previousFileStatus,
      metadata,
    });

    publishActivityFromEntry(language, entry, fileName);

    maybeEmitTranscriptRow(pi, entry, metadata, language, fileName);

    if (entry.status === "unavailable") {
      unavailableSeenByLanguage.add(language);
    }

    return update;
  }

  /**
   * Mirror a peer extension's diagnostic metadata into our activity store
   * without touching the tool result. Used when sf-agentscript-assist
   * handles `.agent` files.
   */
  function observeExternalDiagnostics(
    pi: ExtensionAPI,
    event: ToolResultEvent,
    filePath: string,
    language: SupportedLanguage,
  ): void {
    const metadata = extractDiagnosticsMetadata(event.details);
    if (!metadata) return;

    const previousFileStatus = state.lastStatusByFile.get(filePath);
    state.lastStatusByFile.set(filePath, metadata.status === "error" ? "error" : "clean");

    const fileName = basename(filePath);
    const now = Date.now();
    const diagnostics: LspDiagnostic[] =
      metadata.status === "error" ? metadata.diagnostics.map(toLspDiagnostic) : [];

    const entry = recordCheck(activity, {
      language,
      filePath,
      startedAt: now,
      finishedAt: now,
      diagnostics,
      unavailable:
        metadata.status === "unavailable"
          ? {
              language,
              available: false,
              detail: metadata.unavailableReason ?? "unavailable",
            }
          : undefined,
      previousFileStatus,
      metadata,
    });

    publishActivityFromEntry(language, entry, fileName);

    maybeEmitTranscriptRow(pi, entry, metadata, language, fileName);
    if (entry.status === "unavailable") {
      unavailableSeenByLanguage.add(language);
    }
  }

  function publishActivityFromEntry(
    language: SupportedLanguage,
    entry: LspActivityEntry,
    fileName: string,
  ): void {
    switch (entry.status) {
      case "error":
        setSfLspActivity(language, "error", {
          fileName,
          errorCount: entry.diagnosticCount,
        });
        return;
      case "clean":
      case "transition-clean":
        setSfLspActivity(language, "clean", { fileName });
        return;
      case "unavailable":
        // Availability is updated via the doctor probe; don't stomp on it
        // from a single failed check. Leave activity as-is.
        return;
      case "checking":
        setSfLspActivity(language, "checking", { fileName });
        return;
      case "idle":
      default:
        return;
    }
  }

  // ==========================================================================================
  // Transcript row emission
  // ==========================================================================================

  function maybeEmitTranscriptRow(
    pi: ExtensionAPI,
    entry: LspActivityEntry,
    metadata: SfPiDiagnosticsMetadata | undefined,
    language: SupportedLanguage,
    fileName: string,
  ): void {
    const mode = uiSettings.verbose ? "verbose" : "balanced";
    const previousUnavailable = unavailableSeenByLanguage.has(language);

    const shouldEmit =
      entry.status === "unavailable"
        ? !previousUnavailable
        : shouldEmitTranscriptRow(entry.status, mode, previousUnavailable);

    if (!shouldEmit) return;

    const preview =
      metadata?.diagnostics?.slice(0, TRANSCRIPT_PREVIEW_LIMIT).map((d) => {
        const location = `L${d.line}`;
        const codePart = d.code ? ` [${d.code}]` : "";
        return `${location}${codePart}: ${d.message}`;
      }) ?? undefined;

    const details: LspTranscriptDetails = {
      language,
      fileName,
      status: entry.status,
      diagnosticCount: entry.diagnosticCount,
      durationMs: entry.durationMs,
      unavailableReason: entry.unavailableReason,
      previewLines: preview,
    };

    emitTranscriptRow(pi, details);
  }

  // ==========================================================================================
  // Commands
  // ==========================================================================================

  function registerMainCommand(pi: ExtensionAPI): void {
    pi.registerCommand("sf-lsp", {
      description: "Show Salesforce LSP status and controls",
      handler: async (args, ctx) => {
        const tokens = args.trim().split(/\s+/).filter(Boolean);
        const subcommand = (tokens[0] ?? "").toLowerCase();

        if (subcommand === "" || subcommand === "panel") {
          const statuses = await doctorLsp(ctx.cwd);
          seedFromDoctor(activity, statuses);
          setSfLspHealthFromDoctor(statuses);

          const action = await openSfLspPanel(ctx, {
            store: activity,
            doctorStatuses: statuses,
            // Retained fields for panel surface API stability. The HUD was
            // removed; pass false so the panel doesn't offer toggle actions
            // that no longer mean anything.
            hudEnabled: false,
            verboseEnabled: uiSettings.verbose,
          });

          await handlePanelAction(action, ctx);
          return;
        }

        if (subcommand === "doctor") {
          const statuses = await doctorLsp(ctx.cwd);
          seedFromDoctor(activity, statuses);
          setSfLspHealthFromDoctor(statuses);
          const hasUnavailable = statuses.some((status) => !status.available);
          const severity = hasUnavailable ? "warning" : "info";
          if (ctx.hasUI) ctx.ui.notify(renderDoctorReport(statuses), severity);
          return;
        }

        if (subcommand === "verbose") {
          const arg = (tokens[1] ?? "").toLowerCase();
          if (arg === "on" || arg === "off" || arg === "toggle" || arg === "") {
            const desired = arg === "on" ? true : arg === "off" ? false : !uiSettings.verbose;
            uiSettings = { ...uiSettings, verbose: desired };
            writeScopedSfLspSettings(ctx.cwd, "global", { verbose: desired });
            if (ctx.hasUI) {
              ctx.ui.notify(
                `sf-lsp verbose transcript ${desired ? "enabled" : "disabled"}`,
                "info",
              );
            }
            return;
          }
          if (ctx.hasUI) ctx.ui.notify("Usage: /sf-lsp verbose [on|off|toggle]", "warning");
          return;
        }

        if (ctx.hasUI) {
          ctx.ui.notify(
            [
              "sf-lsp — Salesforce LSP diagnostics",
              "",
              "Commands:",
              "  /sf-lsp                Open the rich status/controls panel",
              "  /sf-lsp doctor         Show a compact doctor report",
              "  /sf-lsp verbose on|off Toggle transcript row for every check",
              "",
              "Top-bar LSP status is always visible in the sf-devbar top bar.",
            ].join("\n"),
            "warning",
          );
        }
      },
    });
  }

  async function handlePanelAction(
    action: SfLspPanelAction | null,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (!action || action === "close") return;

    if (action === "refresh-doctor") {
      const statuses = await doctorLsp(ctx.cwd);
      seedFromDoctor(activity, statuses);
      setSfLspHealthFromDoctor(statuses);
      if (ctx.hasUI) ctx.ui.notify("sf-lsp: doctor refreshed", "info");
      return;
    }

    if (action === "toggle-hud") {
      // HUD was retired — redirect to the doctor refresh so the action
      // doesn't silently no-op.
      if (ctx.hasUI) {
        ctx.ui.notify("sf-lsp HUD was retired — use the sf-devbar top-bar LSP segment.", "info");
      }
      return;
    }

    if (action === "toggle-verbose") {
      uiSettings = { ...uiSettings, verbose: !uiSettings.verbose };
      writeScopedSfLspSettings(ctx.cwd, "global", { verbose: uiSettings.verbose });
      if (ctx.hasUI) {
        ctx.ui.notify(
          `sf-lsp verbose transcript ${uiSettings.verbose ? "enabled" : "disabled"}`,
          "info",
        );
      }
      return;
    }

    if (action === "shutdown-servers") {
      await shutdownLspClients();
      if (ctx.hasUI) ctx.ui.notify("sf-lsp: LSP servers shut down (will restart lazily)", "info");
      return;
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function isAgentScriptAssistInstalled(pi: ExtensionAPI): boolean {
  try {
    return pi.getCommands().some((command) => command.name === "sf-agentscript-assist");
  } catch {
    return false;
  }
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx === -1 ? p : p.slice(idx + 1);
}

function extractDiagnosticsMetadata(details: unknown): SfPiDiagnosticsMetadata | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const record = details as Record<string, unknown>;
  const candidate = record[SF_PI_DIAGNOSTICS_DETAILS_KEY];
  if (!candidate || typeof candidate !== "object") return undefined;
  return candidate as SfPiDiagnosticsMetadata;
}

function toLspDiagnostic(item: SfPiDiagnosticMetadataItem): LspDiagnostic {
  const severity: 1 | 2 | 3 | 4 =
    item.severity === "error"
      ? 1
      : item.severity === "warning"
        ? 2
        : item.severity === "info"
          ? 3
          : 4;
  return {
    severity,
    message: item.message,
    source: item.source,
    code: item.code,
    range: item.range,
  };
}
