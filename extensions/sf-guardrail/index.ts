/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-guardrail behavior contract
 *
 * A Salesforce-aware safety layer for pi. Distills the best patterns from
 * @aliou/pi-guardrails (file-protection policies, AST command matching,
 * config layering, strongest-wins conflict resolution) but re-implemented
 * from scratch and layered with org-aware confirmation tuned for Salesforce
 * workflows (prod deploys, apex run, data mutations, destructive REST calls).
 *
 * Three feature tiers, all toggleable via features.* in the config:
 *
 *   1. policies        — file-protection rules with three levels
 *                        (noAccess, readOnly, none). Strongest wins.
 *                        Ships with rules for destructiveChanges*.xml,
 *                        .forceignore, .sf/**, .sfdx/**, and .env files.
 *
 *   2. commandGate     — dangerous-command patterns matched against the
 *                        tokenized form of the bash command. Ships with
 *                        rm -rf, sudo, sf org delete, git push --force.
 *                        Prompts user confirmation.
 *
 *   3. orgAwareGate    — bash rules that fire only when the resolved
 *                        target-org type matches (e.g. production). Ships
 *                        with deploy / apex run / data mutate / destructive
 *                        HTTP-method REST calls on production. Prompts.
 *
 * Plus:
 *   - promptInjection  — once-per-session sf-brain-style kernel so the LLM
 *                        knows the gating categories and recommended
 *                        workflow (validate, check-only, Savepoint rollback).
 *   - session memory   — "Allow for this session" persists via pi.appendEntry.
 *   - audit trail      — every decision persisted; rendered by /sf-guardrail
 *                        audit.
 *   - headless gate    — fail-closed by default; SF_GUARDRAIL_ALLOW_HEADLESS=1
 *                        opens the escape hatch.
 *
 * Behavior matrix:
 *
 *   Event              | Condition                         | Result
 *   -------------------|-----------------------------------|--------------------------------------
 *   session_start      | —                                 | Hydrate allow-memory from entries; notify loaded
 *   before_agent_start | prompt entry already in session   | Skip
 *   before_agent_start | first call, features.promptInj on | Inject rule-derived hidden guidance
 *   tool_call          | guardrail disabled                | Pass through
 *   tool_call          | classifies to block               | { block: true, reason }, audit
 *   tool_call          | classifies to confirm, allowed    | Pass through, audit as allow_session
 *   tool_call          | classifies to confirm, user picks | Allow once / Allow session / Block, audit
 *   tool_call          | classifies to confirm, headless   | Fail closed unless env opt-in, audit
 *   /sf-guardrail      | no args                           | status notification
 *   /sf-guardrail list | —                                 | rules notification
 *   /sf-guardrail audit| —                                 | decisions notification
 *   /sf-guardrail forget | —                               | clear session allow-memory
 *   /sf-guardrail install-preset | —                       | write/merge override file with bundled
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  type CommandPanelAction,
  type CommandPanelState,
  openCommandPanel,
} from "../../lib/common/command-panel.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import {
  buildToggleExtensionAction,
  isLifecycleToggleAction,
  LIFECYCLE_GROUP,
  performToggleExtension,
  type LifecycleActionId,
} from "../../lib/common/extension-toggle.ts";
import { registerExtensionDoctor } from "../../lib/common/doctor/registry.ts";
import { runExtensionDoctor as runGuardrailExtensionDoctor } from "./lib/extension-doctor.ts";
import { openInfoPanel } from "../../lib/common/info-panel.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { shouldInjectOnce } from "../../lib/common/session/inject-once.ts";
import {
  clearProjectApprovals,
  forgetSessionApprovals,
  grantSessionApproval,
  hasSessionApproval,
  readRecentDecisions,
  recordDecision,
  renderProjectApprovals,
  restoreApprovalLedger,
} from "./lib/approval-ledger.ts";
import { renderApprovalDetail } from "./lib/approval-detail.ts";
import { evaluateSafety } from "./lib/safety-kernel.ts";
import { loadConfig } from "./lib/config.ts";
import { confirmDecision } from "./lib/hitl.ts";
import { installPreset } from "./lib/install-preset.ts";
import { loadPrompt } from "./lib/prompt-injection.ts";
import { applyGuardrailPreset } from "./lib/preferences.ts";
import { openGuardrailPreferencesPanel } from "./lib/preferences-panel.ts";
import { openProductionAliasesEditor } from "./lib/production-aliases-panel.ts";
import { renderAudit, renderRules, renderStatus } from "./lib/status.ts";
import { COMMAND_NAME, INJECTION_ENTRY_TYPE, type GuardrailConfig } from "./lib/types.ts";

export default function sfGuardrail(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-guardrail")) return;

  // Config is loaded lazily per event. Reading the override file on every
  // tool_call keeps edits in `<globalAgentDir>/sf-guardrail/rules.json`
  // effective without a /reload, matching sf-brain's override ergonomics.
  // The I/O cost is one JSON.parse per tool call on a file under ~10KB —
  // acceptable for a safety layer; we'd revisit if it shows up in profiles.
  function getConfig(): { config: GuardrailConfig; source: "bundled" | "override" } {
    return loadConfig();
  }

  // Contribute Guardrail config readiness to the aggregated `/sf-pi doctor`
  // view. Recent decisions stay in /sf-guardrail audit (which has access to
  // the ExtensionContext); this provider is cwd-only by design.
  registerExtensionDoctor("sf-guardrail", () => runGuardrailExtensionDoctor());

  // ─── session_start: hydrate allow-memory ──────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    restoreApprovalLedger(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    // /tree navigation rewrites the active branch — allowances on the old
    // branch should not leak. Rehydrate from the new branch only.
    restoreApprovalLedger(ctx);
  });

  // ─── before_agent_start: inject guardrail prompt once per live session ──
  // Uses the shared inject-once helper. The pre-fix predicate matched on
  // `type === "custom"` (state-only marker shape) instead of the
  // `"custom_message"` shape pi actually persists for
  // BeforeAgentStartEventResult.message, so dedup never matched a real
  // injection and the guardrail prompt was re-injected on every turn.
  pi.on("before_agent_start", async (_event, ctx) => {
    const { config } = getConfig();
    if (!config.enabled) return;
    if (!config.features.promptInjection) return;
    if (!shouldInjectOnce(ctx.sessionManager.getEntries(), INJECTION_ENTRY_TYPE)) return;

    const prompt = loadPrompt(config);
    return {
      message: {
        customType: INJECTION_ENTRY_TYPE,
        content: prompt,
        display: false,
      },
    };
  });

  // ─── tool_call: the main enforcement seam ─────────────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    const { config } = getConfig();
    if (!config.enabled) return undefined;

    const decision = await evaluateSafety({
      toolName: event.toolName,
      input: (event.input ?? {}) as Record<string, unknown>,
      cwd: ctx.cwd,
      config,
    });
    if (!decision) return undefined;

    // Audited auto-allow → no prompt.
    if (decision.action === "allow") {
      recordDecision(pi, decision, "allow_auto", event.toolName);
      return undefined;
    }

    // Hard block → no prompt.
    if (decision.action === "block") {
      recordDecision(pi, decision, "hard_block", event.toolName);
      if (ctx.hasUI) ctx.ui.notify(decision.reason, "warning");
      return { block: true, reason: decision.reason };
    }

    // Previously granted for this session?
    if (hasSessionApproval(decision)) {
      recordDecision(pi, decision, "allow_session", event.toolName);
      return undefined;
    }

    // Confirmation required.
    const result = await confirmDecision(ctx, {
      title: decision.promptTitle ?? "sf-guardrail",
      detail: renderApprovalDetail(decision),
      timeoutMs: config.confirmTimeoutMs,
      escapeHatchEnv: config.headlessEscapeHatchEnv,
      signal: ctx.signal,
    });

    switch (result.outcome) {
      case "allow_once":
        recordDecision(pi, decision, "allow_once", event.toolName);
        return undefined;
      case "allow_session":
        grantSessionApproval(pi, decision);
        recordDecision(pi, decision, "allow_session", event.toolName);
        return undefined;
      case "headless_pass":
        recordDecision(pi, decision, "headless_pass", event.toolName);
        return undefined;
      case "headless_block":
        recordDecision(pi, decision, "headless_block", event.toolName);
        return { block: true, reason: result.reason };
      case "timeout":
        recordDecision(pi, decision, "timeout", event.toolName);
        return { block: true, reason: result.reason };
      case "cancel":
        recordDecision(pi, decision, "cancel", event.toolName);
        return { block: true, reason: result.reason };
      case "block":
      default:
        recordDecision(pi, decision, "block", event.toolName);
        return { block: true, reason: result.reason };
    }
  });

  // ─── /sf-guardrail command ────────────────────────────────────────────────
  pi.registerCommand(COMMAND_NAME, {
    description: "Inspect and manage sf-guardrail — status, settings, rules, audit",
    getArgumentCompletions: (prefix) => {
      const lower = prefix.toLowerCase();
      const items = GUARDRAIL_ACTIONS.filter((action) => action.value !== "close")
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
        const sub = (args ?? "").trim().toLowerCase();
        if (sub === "" && ctx.hasUI) {
          await handleGuardrailPanel(pi, ctx);
          return;
        }
        await handleGuardrailCommand(pi, ctx, sub === "" ? "status" : sub);
      });
    },
  });
}

type GuardrailAction =
  | "status"
  | "list"
  | "audit"
  | "grants"
  | "settings"
  | "aliases"
  | "preset-power-tool"
  | "preset-strict"
  | "forget"
  | "install-preset"
  | "help"
  | "close"
  | LifecycleActionId;

const GUARDRAIL_ACTIONS: CommandPanelAction<GuardrailAction>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Show active features, config source, headless behavior, and recent decisions.",
    group: "Status",
  },
  {
    value: "list",
    label: "List active rules",
    description: "Print the full file-protection, dangerous-command, and org-aware rule set.",
    group: "Rules",
  },
  {
    value: "audit",
    label: "Show audit trail",
    description: "List recent allow/block decisions recorded in the current session branch.",
    group: "Troubleshooting",
  },
  {
    value: "grants",
    label: "Show approval grants",
    description: "List active persisted approval grants for this project.",
    group: "Troubleshooting",
  },
  {
    value: "settings",
    label: "Open settings",
    description: "Edit common guardrail preferences with Pi's SettingsList UI.",
    group: "Controls",
  },
  {
    value: "aliases",
    label: "Edit production aliases",
    description: "Add or remove aliases that sf-guardrail should treat as production.",
    group: "Controls",
  },
  {
    value: "preset-power-tool",
    label: "Apply Power Tool preset",
    description: "Set every rule to confirm so risky actions stay human-overridable.",
    group: "Controls",
  },
  {
    value: "preset-strict",
    label: "Apply Strict preset",
    description: "Hard-block secret/credential/internal-state rules and confirm the rest.",
    group: "Controls",
  },
  {
    value: "forget",
    label: "Forget active approvals",
    description: "Clear session allows and active persisted approval grants for this project.",
    group: "Controls",
  },
  {
    value: "install-preset",
    label: "Install bundled preset",
    description: "Write or reconcile the bundled guardrail defaults into the user override file.",
    group: "Controls",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command usage and explain which troubleshooting command to run.",
    group: "Reference",
  },
  {
    value: "close",
    label: "Close",
    description: "Dismiss this panel.",
    group: LIFECYCLE_GROUP,
  },
];

// Compose the live action list so the lifecycle toggle row reflects the
// current enablement state on every panel open.
function buildGuardrailActions(cwd: string): CommandPanelAction<GuardrailAction>[] {
  const toggle = buildToggleExtensionAction({ extensionId: "sf-guardrail", cwd });
  return toggle ? [...GUARDRAIL_ACTIONS, toggle] : GUARDRAIL_ACTIONS;
}

async function handleGuardrailPanel(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const panelState: CommandPanelState<GuardrailAction> = {};
  await openCommandPanel(ctx, {
    title: "🛡 SF Guardrail — status & controls",
    subtitle: "Inspect safety rules, audit decisions, and session overrides.",
    statusLines: () => {
      const { config, source } = loadConfig();
      return buildGuardrailPanelStatus(ctx, config, source);
    },
    actions: () => buildGuardrailActions(ctx.cwd),
    closeValue: "close",
    state: panelState,
    onAction: (action) => handleGuardrailCommand(pi, ctx, action, true),
    // Lifecycle toggle calls ctx.reload() — must close panel first so the
    // ctx.ui.custom() promise resolves before the runtime is invalidated.
    closeBeforeAction: isLifecycleToggleAction,
  });
}

async function handleGuardrailCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  sub: string,
  fromPanel = false,
): Promise<void> {
  if (sub === "lifecycle.toggle") {
    await performToggleExtension(ctx, "sf-guardrail");
    return;
  }

  const { config, source } = loadConfig();

  if (sub === "status" || sub === "help") {
    const text =
      sub === "help"
        ? renderGuardrailHelp()
        : renderStatus({
            config,
            configSource: source,
            recent: readRecentDecisions(ctx, 5),
            hasUI: ctx.hasUI,
            headlessEnabled: !!process.env[config.headlessEscapeHatchEnv],
          });
    await emitGuardrailOutput(
      ctx,
      sub === "help" ? "SF Guardrail help" : "SF Guardrail status",
      text,
      "info",
      fromPanel,
    );
    return;
  }

  if (sub === "list") {
    await emitGuardrailOutput(ctx, "SF Guardrail rules", renderRules(config), "info", fromPanel);
    return;
  }

  if (sub === "audit") {
    await emitGuardrailOutput(
      ctx,
      "SF Guardrail audit",
      renderAudit(readRecentDecisions(ctx, 50)),
      "info",
      fromPanel,
    );
    return;
  }

  if (sub === "grants") {
    await emitGuardrailOutput(
      ctx,
      "SF Guardrail approval grants",
      renderProjectApprovals(ctx.cwd),
      "info",
      fromPanel,
    );
    return;
  }

  if (sub === "settings") {
    await openGuardrailPreferencesPanel(ctx, config);
    return;
  }

  if (sub === "aliases") {
    await openProductionAliasesEditor(ctx, config);
    return;
  }

  if (sub === "preset-power-tool" || sub === "power-tool") {
    applyGuardrailPreset("powerTool", config);
    await emitGuardrailOutput(
      ctx,
      "SF Guardrail preset applied",
      "Power Tool preset applied: risky rules are set to confirm.",
      "info",
      fromPanel,
    );
    return;
  }

  if (sub === "preset-strict" || sub === "strict") {
    applyGuardrailPreset("strict", config);
    await emitGuardrailOutput(
      ctx,
      "SF Guardrail preset applied",
      "Strict preset applied: secret, credential, and CLI-state rules are hard-blocked; other rules confirm.",
      "info",
      fromPanel,
    );
    return;
  }

  if (sub === "forget") {
    forgetSessionApprovals(pi);
    const removed = clearProjectApprovals(ctx.cwd);
    await emitGuardrailOutput(
      ctx,
      "SF Guardrail active approvals cleared",
      `Session allows are revoked for this branch. Cleared ${removed} persisted approval grant(s) for this project.`,
      "info",
      fromPanel,
    );
    return;
  }

  if (sub === "install-preset") {
    await installPreset(ctx);
    return;
  }

  await emitGuardrailOutput(
    ctx,
    "Unknown command",
    `Unknown /sf-guardrail subcommand: ${sub}. Use status, list, audit, grants, settings, aliases, power-tool, strict, forget, install-preset, help.`,
    "warning",
    fromPanel,
  );
}

async function emitGuardrailOutput(
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

function buildGuardrailPanelStatus(
  ctx: ExtensionCommandContext,
  config: GuardrailConfig,
  source: string,
): string[] {
  const recent = readRecentDecisions(ctx, 5);
  return [
    `✓ Config        ${source}`,
    `${config.enabled ? "✓" : "○"} Guardrail     ${config.enabled ? "enabled" : "disabled"}`,
    `${config.features.policies ? "✓" : "○"} Policies      ${config.policies.rules.length} rule(s)`,
    `${config.features.commandGate ? "✓" : "○"} Commands      ${config.commandGate.patterns.length} dangerous pattern(s)`,
    `${config.features.orgAwareGate ? "✓" : "○"} Org-aware     ${config.orgAwareGate.rules.length} production-aware rule(s)`,
    `${process.env[config.headlessEscapeHatchEnv] ? "◐" : "✓"} Headless      ${process.env[config.headlessEscapeHatchEnv] ? "escape hatch enabled" : "fail-closed"}`,
    `• Recent audit  ${recent.length} decision(s) in this branch`,
  ];
}

function renderGuardrailHelp(): string {
  return [
    "sf-guardrail — Salesforce-aware safety layer",
    "",
    "Commands:",
    `  /${COMMAND_NAME}                 Open status & controls panel`,
    `  /${COMMAND_NAME} status          Show active features and recent decisions`,
    `  /${COMMAND_NAME} list            List active file/command/org-aware rules`,
    `  /${COMMAND_NAME} audit           Show recent decisions in this session branch`,
    `  /${COMMAND_NAME} grants          Show active persisted approval grants`,
    `  /${COMMAND_NAME} settings        Edit common guardrail preferences`,
    `  /${COMMAND_NAME} aliases         Edit production aliases`,
    `  /${COMMAND_NAME} power-tool      Apply confirm-by-default preset`,
    `  /${COMMAND_NAME} strict          Apply strict hard-block preset`,
    `  /${COMMAND_NAME} forget          Clear session allows and project approval grants`,
    `  /${COMMAND_NAME} install-preset  Write/reconcile bundled defaults to user config`,
    `  /${COMMAND_NAME} help            Show this help`,
  ].join("\n");
}
