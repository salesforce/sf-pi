/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-lsp behavior contract
 *
 * Advisory LSP diagnostics after `write`/`edit` tool results, plus a layered
 * TUI presence so the user always knows whether the LSP actually fired and
 * what it found. The LLM-facing text contract is unchanged — see
 * `lib/feedback.ts`.
 *
 * Surfaces (all optional, all feature-gated by `ctx.hasUI`):
 *
 *   Surface                | Pi API                                 | Lifetime
 *   -----------------------|----------------------------------------|--------------------
 *   Working indicator      | ctx.ui.setWorkingIndicator             | streaming window
 *   Footer status segment  | ctx.ui.setStatus                       | persistent
 *   Compact HUD overlay    | ctx.ui.custom overlay nonCapturing     | active-only (auto-hide)
 *   Transcript row         | pi.sendMessage + registerMessageRenderer| per event
 *   Rich /sf-lsp panel     | ctx.ui.custom overlay + SelectList     | on-demand
 *   Ctrl+Shift+L toggle    | pi.registerShortcut                    | startup
 *   --no-sf-lsp-hud flag   | pi.registerFlag                        | startup
 *
 * The LLM-facing output (`LSP feedback: ...`) and the `details.sfPiDiagnostics`
 * metadata schema are produced by `lib/feedback.ts` and are shared with
 * `sf-agentscript-assist`. Every new surface reads only from the activity
 * store or the already-stamped metadata — `feedback.ts` and `lsp-client.ts`
 * stay unchanged.
 *
 * NOTE: sf-lsp intentionally does NOT override the built-in `edit`/`write`
 * tools to add an in-card panel. Pi's cross-extension conflict detector
 * refuses to load any extension that re-registers a tool name already
 * claimed by another extension (commonly `pi-tool-display` owns those).
 * The transcript row + HUD + footer carry the same user-facing signal.
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
import { formatFooterStatus } from "./lib/footer-status.ts";
import {
  HUD_OVERLAY_WIDTH,
  HUD_ICON_CATALOGUE,
  SfLspHudComponent,
  isLspHudActive,
  resolveHudIcon,
} from "./lib/hud-component.ts";
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

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const DIAGNOSTIC_TIMEOUT_MS = 6000;
const STATUS_KEY = "sf-lsp";
const FLAG_NAME = "no-sf-lsp-hud";
const TRANSCRIPT_PREVIEW_LIMIT = 3;
/** Re-check HUD visibility roughly every second while there's recent activity. */
const HUD_IDLE_CHECK_INTERVAL_MS = 1_000;

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export default function sfLspExtension(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-lsp")) return;

  // --- Module-scoped state -------------------------------------------------------------------
  const state = createState();
  const activity = createActivityStore();
  const workingIndicator = createWorkingIndicatorState();

  // Settings + per-session UI state
  let uiSettings: SfLspUiSettings = { hud: true, verbose: false, icon: "bolt" };
  let hudEnabledAtStartup = true;
  let hudOverlayDismiss: (() => void) | null = null;
  let hudComponent: SfLspHudComponent | null = null;
  let hudIdleTimer: ReturnType<typeof setInterval> | null = null;
  let hudCtxRef: ExtensionContext | null = null;
  const unavailableSeenByLanguage = new Set<SupportedLanguage>();

  // --- Register transcript message renderer -------------------------------------------------
  pi.registerMessageRenderer<LspTranscriptDetails>(
    LSP_TRANSCRIPT_CUSTOM_TYPE,
    createTranscriptRenderer(),
  );

  // --- CLI flag / shortcut --------------------------------------------------------------------
  pi.registerFlag(FLAG_NAME, {
    description: "Launch without the sf-lsp top-right HUD overlay",
    type: "boolean",
    default: false,
  });

  pi.registerShortcut("ctrl+shift+l", {
    description: "Toggle the sf-lsp HUD overlay",
    handler: async (ctx) => {
      await toggleHud(ctx);
    },
  });

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

      const effective = readEffectiveSfLspSettings(ctx.cwd);
      uiSettings = { hud: effective.hud, verbose: effective.verbose, icon: effective.icon };
      hudEnabledAtStartup = pi.getFlag(FLAG_NAME) === true ? false : uiSettings.hud;

      if (!ctx.hasUI) return;
      hudCtxRef = ctx;
      pushFooterStatus(ctx);

      // Probe doctor in the background so the footer + panel reflect
      // availability before any real check fires. Non-blocking.
      void doctorLsp(ctx.cwd)
        .then((statuses) => {
          seedFromDoctor(activity, statuses);
          pushFooterStatus(ctx);
          hudComponent?.setStore(activity);
        })
        .catch(() => {
          // doctor runs on a best-effort basis; silently ignore failures
        });

      if (hudEnabledAtStartup) {
        ensureHudMounted(ctx);
      }
    });

    pi.on("session_shutdown", async (event, ctx) => {
      stopHudIdleTimer();
      dismissHud();
      if (ctx) {
        resetLspIndicator(ctx, workingIndicator);
        if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
      }
      resetState(state);
      resetActivityStore(activity);
      unavailableSeenByLanguage.clear();
      hudCtxRef = null;
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

    // When sf-agentscript-assist is loaded it handles `.agent` files end-to-end
    // and stamps `details.sfPiDiagnostics` onto the event. We don't duplicate
    // that work, but we DO still want the HUD / footer / transcript row to
    // reflect the check. Load order is alphabetical, so the assist extension
    // runs before us and we can read its metadata off `event.details`.
    if (language === "agentscript" && isAgentScriptAssistInstalled(pi)) {
      observeExternalDiagnostics(pi, ctx, event, filePath, language);
      return undefined;
    }

    const previousFileStatus = state.lastStatusByFile.get(filePath);
    const fileName = basename(filePath);

    markChecking(activity, language, filePath, fileName);
    hudComponent?.setStore(activity);
    pushFooterStatus(ctx);
    ensureHudMounted(ctx);
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

    hudComponent?.setStore(activity);
    pushFooterStatus(ctx);
    startHudIdleTimer();

    maybeEmitTranscriptRow(pi, entry, metadata, language, fileName);

    if (entry.status === "unavailable") {
      unavailableSeenByLanguage.add(language);
    }

    return update;
  }

  /**
   * Mirror a peer extension's diagnostic metadata into our activity store
   * without touching the tool result. Used when sf-agentscript-assist
   * handles `.agent` files so our HUD/footer/transcript still reflect the
   * check.
   */
  function observeExternalDiagnostics(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    event: ToolResultEvent,
    filePath: string,
    language: SupportedLanguage,
  ): void {
    const metadata = extractDiagnosticsMetadata(event.details);
    if (!metadata) return;

    const previousFileStatus = state.lastStatusByFile.get(filePath);
    // Keep our own `lastStatusByFile` in sync so error→clean transitions
    // work across the two extensions.
    state.lastStatusByFile.set(filePath, metadata.status === "error" ? "error" : "clean");

    const fileName = basename(filePath);

    const now = Date.now();
    // Reconstruct minimal LspDiagnostic shapes so recordCheck's existing
    // "error count" logic keeps working identically.
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

    hudComponent?.setStore(activity);
    pushFooterStatus(ctx);
    ensureHudMounted(ctx);
    startHudIdleTimer();
    maybeEmitTranscriptRow(pi, entry, metadata, language, fileName);
    if (entry.status === "unavailable") {
      unavailableSeenByLanguage.add(language);
    }
  }

  // ==========================================================================================
  // UI surface helpers
  // ==========================================================================================

  function pushFooterStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, formatFooterStatus(activity, ctx.ui.theme));
  }

  /**
   * Mount the HUD overlay if it isn't up already. The overlay's own
   * `visible` predicate decides whether it actually draws this frame —
   * we mount it eagerly so subsequent activity bursts don't have to wait
   * for a ctx.ui.custom round-trip.
   */
  function ensureHudMounted(ctx: ExtensionContext): void {
    if (!ctx.hasUI || hudOverlayDismiss || !uiSettings.hud) return;
    hudCtxRef = ctx;

    void ctx.ui
      .custom<void>(
        (tui, theme, _kb, done) => {
          const component = new SfLspHudComponent(
            tui,
            theme,
            activity,
            resolveHudIcon(uiSettings.icon),
          );
          hudComponent = component;
          hudOverlayDismiss = () => {
            hudOverlayDismiss = null;
            hudComponent = null;
            done(undefined);
          };
          return component;
        },
        {
          overlay: true,
          overlayOptions: () => ({
            anchor: "top-right",
            // Fixed tight width. Without this Pi defaults to
            // min(80, available) which leaves a large empty gap
            // between the content and the terminal right edge.
            width: HUD_OVERLAY_WIDTH,
            margin: { top: 1, right: 1 },
            nonCapturing: true,
            visible: (termWidth, termHeight) =>
              uiSettings.hud && termWidth >= 80 && termHeight >= 10 && isLspHudActive(activity),
          }),
        },
      )
      .catch(() => {
        hudComponent = null;
        hudOverlayDismiss = null;
      });
  }

  function dismissHud(): void {
    hudOverlayDismiss?.();
    hudOverlayDismiss = null;
    hudComponent = null;
  }

  /**
   * While there's recent activity, re-poke the component every second so
   * the overlay's `visible` predicate reevaluates and the HUD hides itself
   * shortly after the last update (`HUD_IDLE_HIDE_MS`).
   */
  function startHudIdleTimer(): void {
    if (hudIdleTimer) return;
    hudIdleTimer = setInterval(() => {
      if (!hudCtxRef?.hasUI || !hudComponent) {
        stopHudIdleTimer();
        return;
      }
      hudComponent.setStore(activity);
      if (!isLspHudActive(activity)) stopHudIdleTimer();
    }, HUD_IDLE_CHECK_INTERVAL_MS);
    hudIdleTimer.unref?.();
  }

  function stopHudIdleTimer(): void {
    if (hudIdleTimer) {
      clearInterval(hudIdleTimer);
      hudIdleTimer = null;
    }
  }

  async function toggleHud(ctx: ExtensionContext): Promise<void> {
    uiSettings = { ...uiSettings, hud: !uiSettings.hud };
    writeScopedSfLspSettings(ctx.cwd, "global", { hud: uiSettings.hud });
    if (uiSettings.hud) {
      ensureHudMounted(ctx);
      hudComponent?.setStore(activity);
      if (ctx.hasUI) ctx.ui.notify("sf-lsp HUD enabled", "info");
    } else {
      dismissHud();
      stopHudIdleTimer();
      if (ctx.hasUI) ctx.ui.notify("sf-lsp HUD disabled", "info");
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
          pushFooterStatus(ctx);
          hudComponent?.setStore(activity);

          const action = await openSfLspPanel(ctx, {
            store: activity,
            doctorStatuses: statuses,
            hudEnabled: uiSettings.hud,
            verboseEnabled: uiSettings.verbose,
          });

          await handlePanelAction(action, ctx);
          return;
        }

        if (subcommand === "doctor") {
          const statuses = await doctorLsp(ctx.cwd);
          seedFromDoctor(activity, statuses);
          pushFooterStatus(ctx);
          hudComponent?.setStore(activity);
          const hasUnavailable = statuses.some((status) => !status.available);
          const severity = hasUnavailable ? "warning" : "info";
          if (ctx.hasUI) ctx.ui.notify(renderDoctorReport(statuses), severity);
          return;
        }

        if (subcommand === "hud") {
          const arg = (tokens[1] ?? "").toLowerCase();
          if (arg === "on" || arg === "off" || arg === "toggle" || arg === "") {
            const desired = arg === "on" ? true : arg === "off" ? false : !uiSettings.hud;
            if (desired === uiSettings.hud && arg !== "toggle" && arg !== "") {
              if (ctx.hasUI) {
                ctx.ui.notify(`sf-lsp HUD already ${desired ? "on" : "off"}`, "info");
              }
              return;
            }
            uiSettings = { ...uiSettings, hud: desired };
            writeScopedSfLspSettings(ctx.cwd, "global", { hud: desired });
            if (desired) ensureHudMounted(ctx);
            else {
              dismissHud();
              stopHudIdleTimer();
            }
            if (ctx.hasUI) ctx.ui.notify(`sf-lsp HUD ${desired ? "enabled" : "disabled"}`, "info");
            return;
          }
          if (ctx.hasUI) ctx.ui.notify("Usage: /sf-lsp hud [on|off|toggle]", "warning");
          return;
        }

        if (subcommand === "icon") {
          const arg = (tokens[1] ?? "").trim();
          if (arg === "" || arg === "list") {
            const keys = Object.entries(HUD_ICON_CATALOGUE)
              .map(([k, v]) => `  ${v.glyph}  ${k}`)
              .join("\n");
            if (ctx.hasUI) {
              ctx.ui.notify(
                [
                  "sf-lsp icon — HUD brand icon",
                  "",
                  `Current: ${uiSettings.icon}`,
                  "",
                  "Builtin icons (pass the key):",
                  keys,
                  "",
                  "Or any custom glyph: /sf-lsp icon 🧪",
                ].join("\n"),
                "info",
              );
            }
            return;
          }
          uiSettings = { ...uiSettings, icon: arg };
          writeScopedSfLspSettings(ctx.cwd, "global", { icon: arg });
          hudComponent?.setIcon(resolveHudIcon(arg));
          if (ctx.hasUI) ctx.ui.notify(`sf-lsp HUD icon set to "${arg}"`, "info");
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
              "  /sf-lsp hud on|off     Toggle the top-right HUD overlay",
              "  /sf-lsp verbose on|off Toggle transcript row for every check",
              "  /sf-lsp icon [key]     Change HUD brand icon (list with no arg)",

              "",
              "Shortcut: Ctrl+Shift+L (toggle HUD)",
              "CLI flag: --no-sf-lsp-hud (start with HUD suppressed)",
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
      pushFooterStatus(ctx);
      hudComponent?.setStore(activity);
      if (ctx.hasUI) ctx.ui.notify("sf-lsp: doctor refreshed", "info");
      return;
    }

    if (action === "toggle-hud") {
      await toggleHud(ctx);
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

/**
 * True when sf-agentscript-assist is loaded and owns `.agent` feedback.
 * Probed per-call so enabling/disabling the peer extension mid-session
 * works without a reload.
 */
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

/**
 * Reconstruct an LSP-shape diagnostic from a peer extension's metadata.
 * Only the fields that `recordCheck` inspects are material (severity, range).
 */
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
