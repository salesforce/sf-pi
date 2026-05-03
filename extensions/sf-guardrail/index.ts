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
 *   before_agent_start | first call, features.promptInj on | Inject SF_GUARDRAIL_PROMPT as hidden msg
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
import type { CustomEntry, ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { record, readRecent } from "./lib/audit.ts";
import { forgetSession, grant, isAllowed, restore } from "./lib/allowlist.ts";
import { classify } from "./lib/classify.ts";
import { loadConfig } from "./lib/config.ts";
import { confirmDecision } from "./lib/hitl.ts";
import { installPreset } from "./lib/install-preset.ts";
import { loadPrompt } from "./lib/prompt-injection.ts";
import { renderAudit, renderRules, renderStatus } from "./lib/status.ts";
import { COMMAND_NAME, INJECTION_ENTRY_TYPE, type GuardrailConfig } from "./lib/types.ts";

function isInjectionEntry(entry: unknown): entry is CustomEntry<unknown> {
  if (!entry || typeof entry !== "object") return false;
  const c = entry as { type?: string; customType?: string };
  return c.type === "custom" && c.customType === INJECTION_ENTRY_TYPE;
}

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

  // ─── session_start: hydrate allow-memory ──────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    restore(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    // /tree navigation rewrites the active branch — allowances on the old
    // branch should not leak. Rehydrate from the new branch only.
    restore(ctx);
  });

  // ─── before_agent_start: inject kernel once ───────────────────────────────
  pi.on("before_agent_start", async (_event, ctx) => {
    const { config } = getConfig();
    if (!config.enabled) return;
    if (!config.features.promptInjection) return;
    const alreadyInjected = ctx.sessionManager.getEntries().some(isInjectionEntry);
    if (alreadyInjected) return;

    const prompt = loadPrompt();
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

    const decision = classify({
      toolName: event.toolName,
      input: (event.input ?? {}) as Record<string, unknown>,
      cwd: ctx.cwd,
      config,
    });
    if (!decision) return undefined;

    // Hard block → no prompt.
    if (decision.action === "block") {
      record(pi, decision, "hard_block", event.toolName);
      if (ctx.hasUI) ctx.ui.notify(decision.reason, "warning");
      return { block: true, reason: decision.reason };
    }

    // Previously granted for this session?
    if (isAllowed(decision.ruleId, decision.fingerprint)) {
      record(pi, decision, "allow_session", event.toolName);
      return undefined;
    }

    // Confirmation required.
    const result = await confirmDecision(ctx, {
      title: decision.promptTitle ?? "sf-guardrail",
      detail: decision.reason,
      timeoutMs: config.confirmTimeoutMs,
      escapeHatchEnv: config.headlessEscapeHatchEnv,
      signal: ctx.signal,
    });

    switch (result.outcome) {
      case "allow_once":
        record(pi, decision, "allow_once", event.toolName);
        return undefined;
      case "allow_session":
        grant(pi, decision.ruleId, decision.fingerprint);
        record(pi, decision, "allow_session", event.toolName);
        return undefined;
      case "headless_pass":
        record(pi, decision, "headless_pass", event.toolName);
        return undefined;
      case "headless_block":
        record(pi, decision, "headless_block", event.toolName);
        return { block: true, reason: result.reason };
      case "block":
      default:
        record(pi, decision, "block", event.toolName);
        return { block: true, reason: result.reason };
    }
  });

  // ─── /sf-guardrail command ────────────────────────────────────────────────
  pi.registerCommand(COMMAND_NAME, {
    description: "Inspect and manage sf-guardrail — status, rules, audit, install-preset",
    getArgumentCompletions: (prefix) => {
      const subs = ["list", "audit", "forget", "install-preset", "help"];
      const lower = prefix.toLowerCase();
      const items = subs
        .filter((sub) => sub.startsWith(lower))
        .map((sub) => ({ value: sub, label: sub }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const sub = (args ?? "").trim().toLowerCase();
      const { config, source } = getConfig();

      if (sub === "" || sub === "status" || sub === "help") {
        const text = renderStatus({
          config,
          configSource: source,
          recent: readRecent(ctx, 5),
          hasUI: ctx.hasUI,
          headlessEnabled: !!process.env[config.headlessEscapeHatchEnv],
        });
        ctx.ui.notify(text, "info");
        return;
      }

      if (sub === "list") {
        ctx.ui.notify(renderRules(config), "info");
        return;
      }

      if (sub === "audit") {
        ctx.ui.notify(renderAudit(readRecent(ctx, 50)), "info");
        return;
      }

      if (sub === "forget") {
        forgetSession();
        ctx.ui.notify(
          "sf-guardrail: cleared in-memory allow list for this turn. Session entries remain; /reload restores them.",
          "info",
        );
        return;
      }

      if (sub === "install-preset") {
        await installPreset(ctx);
        return;
      }

      ctx.ui.notify(
        `Unknown /sf-guardrail subcommand: ${sub}. Use list, audit, forget, install-preset.`,
        "warning",
      );
    },
  });
}
