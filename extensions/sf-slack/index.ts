/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-slack behavior contract
 *
 * Full Slack integration: search messages, read threads, browse channel history,
 * look up channels/users/files, read/create/edit canvases.
 *
 * Token resolution chain (checked in order):
 *   1. Pi auth store (~/.pi/agent/auth.json via /login sf-slack)
 *   2. macOS Keychain (hardware-backed)
 *   3. Environment variable (SLACK_USER_TOKEN)
 *
 * Registration model (Option B — conditional registration):
 *   Slack tools are registered only after a token resolves on session_start.
 *   Without a token, no slack* tools, snippets, or guidelines appear in the
 *   system prompt. `/sf-slack refresh` triggers the same gate again, so logging
 *   in mid-session adds the full tool set on the next turn.
 *
 *   Scope probing (channels:read / files:read) runs *before* session_start
 *   resolves, so the first turn already ships the final gated tool set.
 *   This keeps the system prompt stable and prompt-cache friendly.
 *
 * Behavior matrix:
 *
 *   Event/Trigger          | Condition            | Result
 *   -----------------------|----------------------|--------------------------------------------
 *   session_start          | token available      | Register tools, detect identity, probe scopes, cache users, set footer
 *   session_start          | no token             | Skip tool registration entirely, keep footer hidden
 *   session_shutdown       | —                    | Clear footer status
 *   before_agent_start     | identity + slack tools active | Inject workspace context into system prompt
 *   before_agent_start     | no identity or no slack tools | Skip injection
 *   /sf-slack              | no args              | Show auth status notification
 *   /sf-slack refresh      | —                    | Re-detect identity, re-probe, (re)register tools
 *   any tool call          | no auth              | Return setup instructions (defensive; should not occur with Option B)
 *
 * Security:
 *   - NEVER exposes full tokens — always masked in display
 *   - Read-only except slack_canvas create/edit
 *   - Supports Pi auth storage by default, with optional Keychain / env fallbacks
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  PROVIDER_NAME,
  COMMAND_NAME,
  WIDGET_KEY,
  ENV_TOKEN,
  SEND_ENTRY_TYPE,
  type SlackIdentity,
  type AuthTestResponse,
  type ApiErr,
  type SlackSendAuditEntry,
} from "./lib/types.ts";
import { getSlackToken, loginSlack, oauthScopes, refreshSlackToken } from "./lib/auth.ts";
import {
  slackApi,
  prewarmUserCache,
  prewarmChannelCache,
  setDetectedTeamId,
  detectTokenType,
  getGrantedScopes,
  type SlackTokenType,
} from "./lib/api.ts";
import { buildAuthStatus } from "./lib/format.ts";
import { glyph, resolveGlyphMode } from "../../lib/common/glyph-policy.ts";
import { registerSlackTool } from "./lib/tools.ts";
import { registerChannelTool } from "./lib/channel-tool.ts";
import { registerUserTool } from "./lib/user-tool.ts";
import { registerFileTool } from "./lib/file-tool.ts";
import { registerCanvasTool } from "./lib/canvas-tool.ts";
import { registerResolveTool } from "./lib/resolve-tool.ts";
import { registerResearchTool } from "./lib/research-tool.ts";
import { registerSendTool } from "./lib/send-tool.ts";
import { registerTimeRangeTool } from "./lib/time-range-tool.ts";
import { probeAndGateTools } from "./lib/scope-probe.ts";
import {
  DEFAULT_PREFERENCES,
  PREFS_ENTRY_TYPE,
  getPreferences,
  sanitize,
  setPreferences,
  type SlackPreferences,
} from "./lib/preferences.ts";
import { openSettingsPanel } from "./lib/settings-panel.ts";
import { renderStatsLines, resetStats, setStatsListener } from "./lib/stats.ts";
import { classifySlackStatus, slackStatusLabel } from "./lib/status.ts";
import { clearSlackStatus, setSlackStatus } from "../../lib/common/slack-status/store.ts";
import {
  type CommandPanelAction,
  type CommandPanelState,
  openCommandPanel,
} from "../../lib/common/command-panel.ts";
import { openInfoPanel } from "../../lib/common/info-panel.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";

const RESEARCH_WIDGET_KEY = "sf-slack-research";

type SlackCommandAction = "status" | "refresh" | "settings" | "sent" | "help" | "close";

const SLACK_COMMAND_ACTIONS: CommandPanelAction<SlackCommandAction>[] = [
  {
    value: "status",
    label: "Show auth status",
    description: "Print token source, identity, granted/requested scopes, and setup guidance.",
    group: "Status",
  },
  {
    value: "refresh",
    label: "Refresh identity + scopes",
    description:
      "Re-detect identity, re-probe scopes, refresh caches, and register tools if newly authenticated.",
    group: "Diagnostics",
  },
  {
    value: "settings",
    label: "Open preferences",
    description:
      "Edit search detail level, research widget visibility, and permalink rendering preferences.",
    group: "Settings",
  },
  {
    value: "sent",
    label: "Show send audit",
    description: "List recent slack_send activity recorded in the current session branch.",
    group: "Audit",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command usage and authentication setup options.",
    group: "Reference",
  },
  {
    value: "close",
    label: "Close",
    description: "Dismiss this panel.",
    group: "Reference",
  },
];

// ─── Extension entry point ──────────────────────────────────────────────────────

export default function sfSlack(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-slack")) return;

  let identity: SlackIdentity | null = null;
  // Count of scopes we asked for at OAuth time that Slack did NOT actually
  // grant this token. Populated by the header-driven scope probe. Surfaced in
  // the footer so users immediately see scope drift (the "auth.test reports
  // scopes the token doesn't actually have" problem we designed P1+P4 to solve).
  let missingGrantedScopeCount = 0;
  // Scope counts + token type fuel the sf-devbar Slack pill. Token type
  // (user/bot/app/unknown) is decoded from the xox*- prefix so the pill
  // can color-code risk; count drives the `granted/requested scopes` chip.
  let grantedScopeCount = 0;
  let requestedScopeCount = 0;
  let tokenType: SlackTokenType = "unknown";
  let widgetCtx: ExtensionContext | null = null;
  let widgetGeneration = 0;

  // Option B: Slack tools are registered conditionally. Tracking this flag
  // prevents duplicate register calls across session_start → /sf-slack refresh
  // cycles and gives a clear source of truth for the "is Slack enabled?"
  // check inside before_agent_start.
  //
  // Note: pi.registerTool() is idempotent on name — calling it twice simply
  // overwrites the previous definition — but tracking the flag keeps the
  // control flow readable and prevents unnecessary refreshTools() churn.
  let slackToolsRegistered = false;

  // Guard async Slack callbacks against /reload, session switches, and shutdown.
  // Pi 0.70+ surfaces stale context usage more clearly, so every delayed UI
  // update checks the session_start generation that created it.
  let activeSessionGeneration = 0;
  let activeSessionKey: string | null = null;

  function sessionKey(ctx: ExtensionContext): string {
    return `${ctx.sessionManager.getSessionId()}::${ctx.cwd}`;
  }

  function beginActiveSession(ctx: ExtensionContext): number {
    activeSessionGeneration += 1;
    activeSessionKey = sessionKey(ctx);
    return activeSessionGeneration;
  }

  function endActiveSession(ctx: ExtensionContext): void {
    if (activeSessionKey === sessionKey(ctx)) {
      activeSessionGeneration += 1;
      activeSessionKey = null;
    }
  }

  function isActiveSession(ctx: ExtensionContext, generation = activeSessionGeneration): boolean {
    return generation === activeSessionGeneration && activeSessionKey === sessionKey(ctx);
  }

  function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }

  // ─── Preferences (P3) ───────────────────────────────────────────────
  //
  // Prefs are persisted with pi.appendEntry so they survive reloads and
  // follow branch navigation. Readers (render.ts, tools.ts, format.ts) access
  // them through the in-memory singleton in preferences.ts, so we only need
  // to repopulate that singleton on session_start / session_tree.

  function restorePreferences(ctx: ExtensionContext): SlackPreferences {
    let latest: SlackPreferences = { ...DEFAULT_PREFERENCES };
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === PREFS_ENTRY_TYPE) {
        const data = entry.data as Partial<SlackPreferences> | undefined;
        if (data) latest = sanitize({ ...latest, ...data });
      }
    }
    return setPreferences(latest);
  }

  function persistPreferences(next: SlackPreferences): void {
    setPreferences(next);
    pi.appendEntry<SlackPreferences>(PREFS_ENTRY_TYPE, next);
    renderResearchWidget();
  }

  // ─── Research activity widget (P4) ──────────────────────────────────────
  //
  // Shows a one-line "Slack research" summary above the editor so the user
  // knows how much Slack data has flowed into the current conversation. Cleared
  // on session_shutdown. Disabled when the user flips showWidget off.

  function renderResearchWidget(): void {
    const ctx = widgetCtx;
    if (!ctx || !ctx.hasUI || !isActiveSession(ctx, widgetGeneration)) return;
    const prefs = getPreferences();
    if (prefs.showWidget === "off") {
      ctx.ui.setWidget(RESEARCH_WIDGET_KEY, undefined);
      return;
    }
    ctx.ui.setWidget(RESEARCH_WIDGET_KEY, (_tui, theme) => {
      const lines = renderStatsLines({
        dim: (s) => theme.fg("dim", s),
        muted: (s) => theme.fg("muted", s),
        accent: (s) => theme.fg("accent", s),
      });
      return {
        render: () => lines,
        invalidate: () => {},
      };
    });
  }

  // ─── Slack tool registration gate (Option B) ────────────────────────────
  //
  // Register tools only once, and only after we know a token is available.
  // This is what keeps slack* snippets, guidelines, and declarations out of
  // the system prompt entirely when Slack is not configured.
  //
  // Rationale for the list of tools registered here:
  //   - slack:            always needed once we have a token
  //   - slack_time_range: pure-function helper, cheap, useful whenever slack exists
  //   - slack_resolve:    needed to turn fuzzy refs into IDs for other tools
  //   - slack_research:   natural-language research path
  //   - slack_channel:    may be scope-gated off by probeAndGateTools()
  //   - slack_user:       directory lookup
  //   - slack_file:       may be scope-gated off by probeAndGateTools()
  //   - slack_canvas:     read/write canvases
  //   - slack_send:       post messages (the ONE high blast-radius write
  //                       surface; every call confirms via ctx.ui.confirm)
  function ensureSlackToolsRegistered(): void {
    if (slackToolsRegistered) return;
    registerSlackTool(pi);
    registerTimeRangeTool(pi);
    registerResolveTool(pi);
    registerResearchTool(pi);
    registerChannelTool(pi);
    registerUserTool(pi);
    registerFileTool(pi);
    registerCanvasTool(pi);
    registerSendTool(pi);
    slackToolsRegistered = true;
  }

  // ─── Auth provider registration ─────────────────────────────────────────────
  pi.registerProvider(PROVIDER_NAME, {
    apiKey: ENV_TOKEN,
    oauth: {
      name: "SF Slack",
      login: loginSlack,
      refreshToken: refreshSlackToken,
      getApiKey: (credentials) => credentials.access,
    },
  });

  // ─── Helper: update footer status ───────────────────────────────────────────
  function updateStatus(
    ctx: ExtensionContext,
    state: "loading" | "connected" | "disconnected" | "error",
    generation: number = activeSessionGeneration,
  ) {
    if (!ctx.hasUI || !isActiveSession(ctx, generation)) return;
    const t = ctx.ui.theme;
    // Resolve glyph mode per render so a settings/terminal switch takes
    // effect without a restart — mirrors sf-llm-gateway-internal's status line.
    const icon = glyph("slack", resolveGlyphMode({ cwd: ctx.cwd }));
    const kind = classifySlackStatus({
      state,
      grantedScopeCount,
      requestedScopeCount,
      missingGrantedScopeCount,
    });
    setSlackStatus({
      kind,
      userName: identity?.userName,
      tokenType,
      grantedScopes: requestedScopeCount > 0 ? grantedScopeCount : undefined,
      requestedScopes: requestedScopeCount > 0 ? requestedScopeCount : undefined,
      missingScopes: missingGrantedScopeCount > 0 ? missingGrantedScopeCount : undefined,
    });

    switch (state) {
      case "loading":
        ctx.ui.setStatus(WIDGET_KEY, t.fg("dim", `${icon} Slack: connecting…`));
        break;
      case "connected": {
        // Pill format (surfaced on sf-devbar's right side):
        //   💬 Slack ✓ Ready @handle [user] 16/23 scopes
        //       └dim    └─success      └accent └─token-type    └─scope-count
        //                                    color depends on             color depends on
        //                                    token risk:                  granted-vs-requested:
        //                                      success → xoxp- user         success  → full grant
        //                                      warning → xoxb- bot          warning  → drift (missing scopes)
        //                                      error   → xoxa-/xapp-/?     dim      → count unknown yet
        //
        // The explicit green `✓ Ready` label exists because the chat
        // icon alone isn't obvious — users asked for an unambiguous status
        // word, and in ASCII-fallback mode the icon degrades to `>` which
        // is even less clear on its own.
        const handle = identity?.userName ? `@${identity.userName}` : "";
        const tokenColor: "success" | "warning" | "error" =
          tokenType === "user" ? "success" : tokenType === "bot" ? "warning" : "error";
        const tokenBracket = t.fg(tokenColor, `[${tokenType}]`);
        const scopeColor: "success" | "warning" | "dim" =
          missingGrantedScopeCount > 0
            ? "warning"
            : requestedScopeCount > 0 && grantedScopeCount >= requestedScopeCount
              ? "success"
              : "dim";
        const scopeText =
          requestedScopeCount > 0
            ? `${grantedScopeCount}/${requestedScopeCount} scopes`
            : grantedScopeCount > 0
              ? `${grantedScopeCount} scopes`
              : "";
        const scopeSegment = scopeText ? ` ${t.fg(scopeColor, scopeText)}` : "";
        const handleSegment = handle ? ` ${t.fg("accent", handle)}` : "";
        const labelColor: "success" | "warning" | "dim" =
          kind === "ready" ? "success" : kind === "scope-drift" ? "warning" : "dim";
        const pill =
          `${icon} ${t.fg("dim", "Slack")} ${t.fg(labelColor, slackStatusLabel(kind))}` +
          `${handleSegment} ${tokenBracket}${scopeSegment}`;
        ctx.ui.setStatus(WIDGET_KEY, pill);
        break;
      }
      case "disconnected":
        // Optional integration: keep the devbar quiet until Slack is configured.
        // /sf-slack remains the explicit place to see setup guidance.
        ctx.ui.setStatus(WIDGET_KEY, undefined);
        break;
      case "error":
        ctx.ui.setStatus(
          WIDGET_KEY,
          `${icon} ${t.fg("dim", "Slack")} ${t.fg("error", "✗ Auth error")}`,
        );
        break;
    }
  }

  // ─── Session start: resolve token, conditionally register tools, probe scopes ───
  //
  // Ordering matters for system-prompt stability:
  //   1. Resolve token. No token → do NOT register Slack tools; nothing about
  //      Slack appears in the system prompt for this session.
  //   2. Register Slack tools (adds them to the active set).
  //   3. Await identity detection + scope probing + cache warming in parallel.
  //      Probing must complete before session_start resolves so turn-1 ships
  //      the same gated tool set as turn-N. Otherwise turn-1 uses an all-tools
  //      prompt and turn-2 uses a gated prompt — guaranteed prompt-cache miss.
  pi.on("session_start", async (_event, ctx) => {
    const generation = beginActiveSession(ctx);
    identity = null;
    missingGrantedScopeCount = 0;
    grantedScopeCount = 0;
    requestedScopeCount = 0;
    tokenType = "unknown";
    widgetCtx = ctx;
    widgetGeneration = generation;
    resetStats();
    setStatsListener(() => renderResearchWidget());
    restorePreferences(ctx);
    renderResearchWidget();

    const auth = await getSlackToken(ctx);
    if (!isActiveSession(ctx, generation)) return;
    if (!auth.ok) {
      // No token → no tool registration. System prompt stays Slack-free.
      setDetectedTeamId("");
      updateStatus(ctx, "disconnected", generation);
      return;
    }

    ensureSlackToolsRegistered();
    const token = auth.token;
    tokenType = detectTokenType(token);
    updateStatus(ctx, "loading", generation);

    // Awaited (not fire-and-forget) so the first user turn already sees the
    // final tool set after probing. Errors are swallowed per-branch so one
    // failure (e.g. users.list rate-limit) does not cancel the others.
    try {
      const authResult = await slackApi<AuthTestResponse>("auth.test", token, {}, ctx.signal);
      if (!isActiveSession(ctx, generation)) return;
      if (authResult.ok) {
        identity = {
          userId: authResult.data?.user_id || "",
          userName: authResult.data?.user || "",
          teamId: authResult.data?.team_id || authResult.data?.enterprise_id || "",
        };
        setDetectedTeamId(authResult.data?.team_id);
      }

      const requestedScopes = oauthScopes()
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean);
      requestedScopeCount = requestedScopes.length;
      const [probeResult] = await Promise.all([
        probeAndGateTools(pi, token, ctx.signal, requestedScopes),
        prewarmUserCache(token, ctx.signal),
        prewarmChannelCache(token, ctx.signal),
      ]);
      if (!isActiveSession(ctx, generation)) return;
      missingGrantedScopeCount = probeResult.missingGrantedScopes.length;
      grantedScopeCount = getGrantedScopes()?.size ?? 0;

      updateStatus(ctx, "connected", generation);
    } catch (error) {
      if (isAbortError(error)) return;
      updateStatus(ctx, "error", generation);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const wasActive = isActiveSession(ctx);
    endActiveSession(ctx);
    if (!wasActive) return;

    identity = null;
    clearSlackStatus();
    setDetectedTeamId("");
    missingGrantedScopeCount = 0;
    grantedScopeCount = 0;
    requestedScopeCount = 0;
    tokenType = "unknown";
    if (ctx.hasUI) {
      ctx.ui.setStatus(WIDGET_KEY, undefined);
      ctx.ui.setWidget(RESEARCH_WIDGET_KEY, undefined);
    }
    setStatsListener(undefined);
    widgetCtx = null;
    widgetGeneration = 0;
  });

  // ─── Before agent start: inject workspace context ───────────────────────────
  // Uses systemPromptOptions to check whether Slack tools are actually active.
  // Skips injection when no Slack tools are loaded, avoiding wasted context tokens.
  //
  // The injected block intentionally stays small and stable across turns.
  // Only identity anchors (User, Team) are injected because the LLM needs them
  // to interpret from:me / with:@user style references correctly. Cache sizes
  // and gated-tool counts are deliberately NOT injected — they drift turn-to-turn
  // and would invalidate prompt cache on every call. Those metrics live in the
  // footer/widget where drift is cheap.
  pi.on("before_agent_start", async (event, _ctx) => {
    if (!identity) return;

    // Only inject Slack context if at least one Slack tool is active in this session
    const { systemPromptOptions } = event;
    const hasSlackTool = systemPromptOptions.selectedTools?.some((t) => t.startsWith("slack"));
    if (!hasSlackTool) return;

    const lines = [
      "[Slack Workspace]",
      `User: @${identity.userName} (${identity.userId})`,
      `Team: ${identity.teamId}`,
    ];

    return {
      message: {
        customType: "sf-slack-context",
        content: lines.join("\n"),
        display: false,
      },
    };
  });

  async function handleSlackPanel(ctx: ExtensionCommandContext): Promise<void> {
    const panelState: CommandPanelState<SlackCommandAction> = {};
    for (;;) {
      const action = await openCommandPanel(ctx, {
        title: "💬 SF Slack — status & controls",
        subtitle: "Inspect auth, refresh granted scopes, and tune Slack result rendering.",
        statusLines: buildSlackPanelStatus(),
        actions: SLACK_COMMAND_ACTIONS,
        closeValue: "close",
        state: panelState,
      });
      if (!action || action === "close") return;
      await handleSlackCommand(action, ctx, true);
    }
  }

  async function handleSlackCommand(
    sub: string,
    ctx: ExtensionCommandContext,
    fromPanel = false,
  ): Promise<void> {
    if (sub === "status") {
      await emitSlackOutput(
        ctx,
        "SF Slack auth status",
        await buildAuthStatus(ctx),
        "info",
        fromPanel,
      );
      return;
    }

    if (sub === "refresh") {
      const generation = activeSessionGeneration;
      ctx.ui.setStatus(`-command`, "Slack: re-detecting identity and scopes…");
      updateStatus(ctx, "loading", generation);

      const auth = await getSlackToken(ctx);
      if (!isActiveSession(ctx, generation)) return;

      if (!auth.ok) {
        updateStatus(ctx, "disconnected", generation);
        ctx.ui.setStatus(`-command`, undefined);
        await emitSlackOutput(
          ctx,
          "Slack token not found",
          "No Slack token found. Run /login sf-slack, use macOS Keychain, or set SLACK_USER_TOKEN.",
          "warning",
          fromPanel,
        );
        return;
      }

      ensureSlackToolsRegistered();
      const token = auth.token;
      tokenType = detectTokenType(token);

      try {
        const authResult = await slackApi<AuthTestResponse>("auth.test", token, {}, ctx.signal);
        if (!isActiveSession(ctx, generation)) return;
        if (authResult.ok) {
          identity = {
            userId: authResult.data?.user_id || "",
            userName: authResult.data?.user || "",
            teamId: authResult.data?.team_id || authResult.data?.enterprise_id || "",
          };
          setDetectedTeamId(authResult.data?.team_id);
          const requestedScopes = oauthScopes()
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean);
          requestedScopeCount = requestedScopes.length;
          const [probeResult] = await Promise.all([
            probeAndGateTools(pi, token, ctx.signal, requestedScopes),
            prewarmUserCache(token, ctx.signal),
            prewarmChannelCache(token, ctx.signal),
          ]);
          if (!isActiveSession(ctx, generation)) return;
          missingGrantedScopeCount = probeResult.missingGrantedScopes.length;
          grantedScopeCount = getGrantedScopes()?.size ?? 0;
          updateStatus(ctx, "connected", generation);
          const status = await buildAuthStatus(ctx);
          if (!isActiveSession(ctx, generation)) return;
          ctx.ui.setStatus(`-command`, undefined);
          const scopeNote =
            probeResult.missingGrantedScopes.length > 0
              ? `\n\nSlack granted ${probeResult.missingGrantedScopes.length} fewer scope(s) than requested. Missing: ${probeResult.missingGrantedScopes.slice(0, 6).join(", ")}${probeResult.missingGrantedScopes.length > 6 ? ", …" : ""}.`
              : "";
          await emitSlackOutput(
            ctx,
            "SF Slack refreshed",
            `${status}${scopeNote}`,
            probeResult.missingGrantedScopes.length > 0 ? "warning" : "success",
            fromPanel,
          );
        } else {
          updateStatus(ctx, "error", generation);
          ctx.ui.setStatus(`-command`, undefined);
          await emitSlackOutput(
            ctx,
            "Slack auth.test failed",
            (authResult as ApiErr).error,
            "error",
            fromPanel,
          );
        }
      } catch (err) {
        if (isAbortError(err)) return;
        updateStatus(ctx, "error", generation);
        ctx.ui.setStatus(`-command`, undefined);
        await emitSlackOutput(ctx, "Slack detection failed", String(err), "error", fromPanel);
      }
      return;
    }

    if (sub === "settings") {
      if (!ctx.hasUI) {
        ctx.ui.notify("/sf-slack settings requires interactive mode.", "warning");
        return;
      }
      await openSettingsPanel(
        ctx,
        { ...getPreferences() },
        {
          onChange: (next) => persistPreferences(next),
        },
      );
      return;
    }

    if (sub === "sent") {
      const entries = collectSendHistory(ctx);
      if (entries.length === 0) {
        await emitSlackOutput(
          ctx,
          "SF Slack send history",
          "No slack_send activity in this session branch yet.",
          "info",
          fromPanel,
        );
        return;
      }
      const lines = [
        `sf-slack — recent sends (${entries.length} in this branch):`,
        "",
        ...entries.slice(-10).map(formatSendHistoryLine),
      ];
      await emitSlackOutput(ctx, "SF Slack send history", lines.join("\n"), "info", fromPanel);
      return;
    }

    if (sub === "help") {
      await emitSlackOutput(ctx, "SF Slack help", renderSlackHelp(), "info", fromPanel);
      return;
    }

    await emitSlackOutput(
      ctx,
      "Unknown command",
      `Unknown /sf-slack subcommand: ${sub}. Use status, refresh, settings, sent, help.`,
      "warning",
      fromPanel,
    );
  }

  async function emitSlackOutput(
    ctx: ExtensionCommandContext,
    title: string,
    body: string,
    level: "info" | "warning" | "error" | "success",
    fromPanel: boolean,
  ): Promise<void> {
    if (fromPanel && ctx.hasUI) {
      await openInfoPanel(ctx, { title, body, severity: level });
      return;
    }
    ctx.ui.notify(body ? `${title}\n\n${body}` : title, level === "success" ? "info" : level);
  }

  function buildSlackPanelStatus(): string[] {
    const kind = classifySlackStatus({
      state: identity ? "connected" : "disconnected",
      grantedScopeCount,
      requestedScopeCount,
      missingGrantedScopeCount,
    });
    const prefs = getPreferences();
    return [
      `${identity ? "✓" : "○"} Identity      ${identity ? `@${identity.userName} (${identity.teamId})` : "not detected"}`,
      `${slackToolsRegistered ? "✓" : "○"} Tools         ${slackToolsRegistered ? "registered" : "not registered"}`,
      `${kind === "ready" ? "✓" : kind === "scope-drift" ? "◐" : "○"} Status        ${slackStatusLabel(kind)}`,
      `• Scopes        ${grantedScopeCount}/${requestedScopeCount || "?"} granted${missingGrantedScopeCount ? ` (${missingGrantedScopeCount} missing)` : ""}`,
      `• Token         ${tokenType}`,
      `• Preferences   fields=${prefs.defaultFields}, widget=${prefs.showWidget}`,
    ];
  }

  function renderSlackHelp(): string {
    return [
      "sf-slack — Slack integration status",
      "",
      "Commands:",
      `  /${COMMAND_NAME}            Open status & controls panel`,
      `  /${COMMAND_NAME} status     Show current auth status`,
      `  /${COMMAND_NAME} refresh    Re-detect identity, re-probe scopes, refresh cache`,
      `  /${COMMAND_NAME} settings   Open preferences (search detail, widget, permalinks)`,
      `  /${COMMAND_NAME} sent       List slack_send activity in this session branch`,
      `  /${COMMAND_NAME} help       Show this help`,
    ].join("\n");
  }

  // ─── /sf-slack command ──────────────────────────────────────────────────────
  pi.registerCommand(COMMAND_NAME, {
    description: "Show Slack integration status and auth info",
    getArgumentCompletions: (prefix) => {
      const lower = prefix.toLowerCase();
      const items = SLACK_COMMAND_ACTIONS.filter((action) => action.value !== "close")
        .filter((action) => action.value.startsWith(lower))
        .map((action) => ({
          value: action.value,
          label: action.value,
          description: action.description,
        }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const sub = (args ?? "").trim().toLowerCase();
      if (sub === "" && ctx.hasUI) {
        await handleSlackPanel(ctx);
        return;
      }
      await handleSlackCommand(sub === "" ? "status" : sub, ctx);
    },
  });
  // Slack tools are NOT registered at extension load. Registration is gated on
  // session_start via ensureSlackToolsRegistered() once a token resolves, or on
  // /sf-slack refresh after a successful login. This keeps the system prompt free
  // of slack* snippets and guidelines when Slack is not configured.
}

// ─── /sf-slack sent helpers ──────────────────────────────────────────────────────────────
//
// Walk the session branch and collect slack_send audit entries appended by
// send-tool.ts. This is local-only — no Slack API call — so it's safe to
// call on every `/sf-slack sent` invocation. Kept at module scope (not inside
// sfSlack) because it has no captured state.

function collectSendHistory(ctx: ExtensionContext): SlackSendAuditEntry[] {
  const entries: SlackSendAuditEntry[] = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === SEND_ENTRY_TYPE) {
      const data = entry.data as SlackSendAuditEntry | undefined;
      if (data && typeof data.text === "string") entries.push(data);
    }
  }
  // Chronological order — appendEntry appends monotonically, but sort defensively
  // in case branch navigation delivers them out of order.
  entries.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return entries;
}

function formatSendHistoryLine(entry: SlackSendAuditEntry): string {
  const when = new Date(entry.ts || 0).toISOString();
  const dest = entry.channel_name
    ? entry.action === "dm"
      ? entry.channel_name
      : `#${entry.channel_name}`
    : entry.channel;
  const preview = entry.text.replace(/\s+/g, " ").slice(0, 60);
  const tag = entry.dry_run ? " [dry-run]" : "";
  return `  ${when}  ${entry.action}→${dest}${tag}  "${preview}${entry.text.length > 60 ? "…" : ""}"`;
}
