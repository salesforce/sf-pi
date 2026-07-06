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
 * Three rule families, each controlled by per-rule behavior:
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
 *   - rule guidance    — once-per-session sf-brain-style kernel so the LLM
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
 *   before_agent_start | first call                       | Inject rule-derived hidden guidance
 *   tool_call          | guardrail disabled                | Pass through
 *   tool_call          | classifies to block               | { block: true, reason }, audit
 *   tool_call          | classifies to confirm, allowed    | Pass through, audit as allow_session
 *   tool_call          | classifies to confirm, user picks | Allow once / Allow session / Block, audit
 *   tool_call          | classifies to confirm, headless   | Fail closed unless env opt-in, audit
 *   /sf-guardrail      | UI available                     | open Manager detail page
 *   /sf-guardrail      | no UI                            | status notification
 *   /sf-guardrail settings | UI available                  | open Manager settings page
 *   /sf-guardrail list | —                                 | rules notification
 *   /sf-guardrail audit| —                                 | decisions notification
 *   /sf-guardrail forget | —                               | clear session allow-memory
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  registerManagerDetailActions,
  type ManagerDetailAction,
} from "../../lib/common/manager-actions.ts";
import {
  openExtensionInManager,
  type SfPiManagerOpenRoute,
} from "../../lib/common/manager-deep-link.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
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
import { type GuardrailConfigSource, loadConfig } from "./lib/config.ts";
import { confirmDecision } from "./lib/hitl.ts";
import { loadPrompt } from "./lib/prompt-injection.ts";
import { openProductionAliasesEditor } from "./lib/production-aliases-panel.ts";
import {
  createForgetApprovalsActionPanel,
  createProtectedAliasesActionPanel,
} from "./lib/manager-action-panels.ts";
import { renderAudit, renderRules, renderStatus } from "./lib/status.ts";
import { COMMAND_NAME, INJECTION_ENTRY_TYPE, type GuardrailConfig } from "./lib/types.ts";

export default function sfGuardrail(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-guardrail")) return;

  // Config is loaded lazily per event. Reading Pi settings plus the advanced
  // override file on every tool_call keeps `/sf-pi` settings edits and expert
  // JSON overrides effective without a /reload. The I/O cost is two small
  // JSON parses per tool call — acceptable for a safety layer; we'd revisit if
  // it shows up in profiles.
  function getConfig(): { config: GuardrailConfig; source: GuardrailConfigSource } {
    return loadConfig();
  }

  // Contribute Guardrail config readiness to the aggregated `/sf-pi doctor`
  // view. Recent decisions stay in /sf-guardrail audit (which has access to
  // the ExtensionContext); this provider is cwd-only by design.
  registerExtensionDoctor("sf-guardrail", () => runGuardrailExtensionDoctor());

  registerManagerDetailActions(pi, "sf-guardrail", buildGuardrailManagerActions(pi));

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

    const decision = await evaluateSafety({
      toolName: event.toolName,
      input: (event.input ?? {}) as Record<string, unknown>,
      cwd: ctx.cwd,
      config,
      sessionId: ctx.sessionManager.getSessionId(),
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
      allowSession: decision.approvalScope?.allowSession !== false,
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
      const items = GUARDRAIL_SUBCOMMANDS.filter((action) => action.value.startsWith(lower)).map(
        (action) => ({
          value: action.value,
          label: action.value,
          description: action.description,
        }),
      );
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const sub = (args ?? "").trim().toLowerCase();
        if (sub === "" && ctx.hasUI) {
          await openGuardrailInManager(pi, ctx, "detail");
          return;
        }
        await handleGuardrailCommand(pi, ctx, sub === "" ? "status" : sub);
      });
    },
  });
}

function buildGuardrailManagerActions(pi: ExtensionAPI): ManagerDetailAction[] {
  return [
    {
      id: "rules",
      label: "Effective rules",
      description: "Show resolved file, command, and org-aware rules.",
      run: (ctx) => handleGuardrailCommand(pi, ctx, "list", true),
    },
    {
      id: "audit",
      label: "Audit trail",
      description: "Show recent allow/block/timeout decisions.",
      run: (ctx) => handleGuardrailCommand(pi, ctx, "audit", true),
    },
    {
      id: "grants",
      label: "Approval grants",
      description: "Show legacy persisted approval grants.",
      run: (ctx) => handleGuardrailCommand(pi, ctx, "grants", true),
    },
    {
      id: "forget",
      label: "Forget approvals",
      description: "Clear session approvals and persisted project grants.",
      run: (ctx) => handleGuardrailCommand(pi, ctx, "forget", true),
      createPanel: (theme, _cwd, _scope, done, ctx) =>
        createForgetApprovalsActionPanel(pi, ctx, theme, done),
    },
    {
      id: "aliases",
      label: "Protected org aliases",
      description: "Treat aliases as production-level risk targets.",
      run: (ctx) => handleGuardrailCommand(pi, ctx, "aliases", true),
      createPanel: (theme, _cwd, _scope, done) => createProtectedAliasesActionPanel(theme, done),
    },
    {
      id: "help",
      label: "Help",
      description: "Show the sf-guardrail command reference.",
      run: (ctx) => handleGuardrailCommand(pi, ctx, "help", true),
    },
  ];
}

async function openGuardrailInManager(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  view: NonNullable<SfPiManagerOpenRoute["view"]>,
): Promise<void> {
  const opened = await openExtensionInManager(pi, ctx, {
    extensionId: "sf-guardrail",
    view,
    actions: buildGuardrailManagerActions(pi),
  });

  if (!opened) {
    ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-guardrail.", "warning");
    return;
  }
}

const GUARDRAIL_SUBCOMMANDS = [
  {
    value: "status",
    description: "Show active rules, config source, headless behavior, and recent decisions.",
  },
  { value: "list", description: "Print the effective guardrail rule set." },
  { value: "audit", description: "List recent guardrail decisions." },
  { value: "grants", description: "List active persisted approval grants." },
  { value: "settings", description: "Open SF Guardrail settings in the SF Pi Manager." },
  { value: "aliases", description: "Edit protected org aliases." },
  { value: "forget", description: "Clear session allows and persisted project grants." },
  { value: "help", description: "Show command usage." },
] as const;

async function handleGuardrailCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  sub: string,
  fromPanel = false,
): Promise<void> {
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
    if (ctx.hasUI) {
      await openGuardrailInManager(pi, ctx, "settings");
      return;
    }
    await emitGuardrailOutput(
      ctx,
      "SF Guardrail settings moved",
      renderSettingsMovedHelp(),
      "info",
      fromPanel,
    );
    return;
  }

  if (sub === "aliases") {
    await openProductionAliasesEditor(ctx, config);
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

  await emitGuardrailOutput(
    ctx,
    "Unknown command",
    `Unknown /sf-guardrail subcommand: ${sub}. Use status, list, audit, grants, settings, aliases, forget, help.`,
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

function renderSettingsMovedHelp(): string {
  return [
    "Routine Guardrail Preferences now live in Pi settings under sfPi.guardrail.",
    "",
    "Open them from:",
    "  /sf-pi → SF Guardrail → Settings",
    "",
    "Saved at:",
    "  ~/.pi/agent/settings.json",
    "",
    "Advanced custom rule overrides remain expert-only JSON:",
    "  ~/.pi/agent/sf-guardrail/rules.json",
    "",
    "Runtime safety decisions read the effective config on each tool call. Reload is recommended after changing settings so hidden agent guidance refreshes.",
  ].join("\n");
}

function renderGuardrailHelp(): string {
  return [
    "sf-guardrail — Salesforce-aware safety layer",
    "",
    "Commands:",
    `  /${COMMAND_NAME}                 Open SF Guardrail in the SF Pi Manager`,
    `  /${COMMAND_NAME} status          Show active rules and recent decisions`,
    `  /${COMMAND_NAME} list            List active file/command/org-aware rules`,
    `  /${COMMAND_NAME} audit           Show recent decisions in this session branch`,
    `  /${COMMAND_NAME} grants          Show active persisted approval grants`,
    `  /${COMMAND_NAME} settings        Show where Pi-backed guardrail preferences live`,
    `  /${COMMAND_NAME} aliases         Edit protected org aliases`,
    `  /${COMMAND_NAME} forget          Clear session allows and project approval grants`,
    `  /${COMMAND_NAME} help            Show this help`,
  ].join("\n");
}
