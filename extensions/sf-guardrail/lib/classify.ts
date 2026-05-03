/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Classify an incoming tool_call event into a guardrail decision.
 *
 * Evaluation order (first hit wins):
 *   1. policies          → strongest protection wins, may short-circuit to block.
 *   2. commandGate       → allowedPatterns / autoDenyPatterns / confirm.
 *   3. orgAwareGate      → production-only rules.
 *
 * This module performs no I/O beyond `existsSync` via policies.matchPath.
 * It has no knowledge of pi.ctx, ui prompts, or the audit log; those are
 * orchestrated in index.ts based on the returned ClassifiedDecision.
 */
import { evaluateCommand } from "./command-gate.ts";
import { blockedTools, matchPath } from "./policies.ts";
import { evaluateOrgAware } from "./org-aware-gate.ts";
import { resolveOrgContext } from "./org-context.ts";
import { fingerprintCommand, fingerprintPath } from "./allowlist.ts";
import type { ClassifiedDecision, GuardrailConfig } from "./types.ts";

export interface ClassifyInput {
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
  config: GuardrailConfig;
}

export function classify(input: ClassifyInput): ClassifiedDecision | undefined {
  const { toolName, input: toolInput, cwd, config } = input;

  if (!config.enabled) return undefined;

  // ── 1. File-protection policies ────────────────────────────────────────────
  if (config.features.policies) {
    const targetPath = pickPath(toolName, toolInput);
    if (targetPath) {
      const matched = matchPath(targetPath, cwd, config.policies.rules);
      if (matched) {
        const blocked = blockedTools(matched.rule.protection);
        if (blocked.includes(toolName)) {
          return {
            ruleId: matched.rule.id,
            feature: "policies",
            action: "block",
            reason: renderBlockMessage(matched.rule.blockMessage, {
              file: targetPath,
            }),
            fingerprint: fingerprintPath(targetPath),
            subject: targetPath,
          };
        }
      }
    }
  }

  // ── 2. Dangerous command gate ─────────────────────────────────────────────
  if (config.features.commandGate && toolName === "bash") {
    const command = typeof toolInput.command === "string" ? toolInput.command : "";
    const outcome = evaluateCommand(command, config.commandGate);
    if (outcome) {
      if (outcome.action === "allow") return undefined;
      if (outcome.action === "autodeny") {
        return {
          ruleId: outcome.matched.id,
          feature: "commandGate",
          action: "block",
          reason: `Blocked: ${outcome.matched.description ?? outcome.matched.pattern}`,
          fingerprint: fingerprintCommand(command),
          subject: command,
        };
      }
      return {
        ruleId: outcome.matched.id,
        feature: "commandGate",
        action: "confirm",
        reason: `Dangerous command: ${outcome.matched.description ?? outcome.matched.pattern}`,
        promptTitle: `⚠ ${outcome.matched.description ?? outcome.matched.pattern}`,
        fingerprint: fingerprintCommand(command),
        subject: command,
      };
    }
  }

  // ── 3. Org-aware gate ─────────────────────────────────────────────────────
  if (config.features.orgAwareGate && toolName === "bash") {
    const command = typeof toolInput.command === "string" ? toolInput.command : "";
    const org = resolveOrgContext(command, cwd, config.productionAliases);
    const outcome = evaluateOrgAware(command, config.orgAwareGate.rules, org);
    if (outcome) {
      const message = renderBlockMessage(outcome.rule.confirmMessage, {
        command,
        orgAlias: org.alias ?? "<unknown>",
        orgType: org.type,
      });
      return {
        ruleId: outcome.rule.id,
        feature: "orgAwareGate",
        action: outcome.rule.action,
        reason: message,
        promptTitle: orgAwareTitle(outcome.rule.description, org),
        fingerprint: fingerprintCommand(command),
        subject: command,
        orgAlias: org.alias,
        orgType: org.type,
      };
    }
  }

  return undefined;
}

function orgAwareTitle(
  description: string | undefined,
  org: { type: string; alias?: string },
): string {
  const tag = org.type.toUpperCase();
  const who = org.alias ? ` (${org.alias})` : "";
  const d = description ?? "Org-aware gate";
  return `⚠ ${tag}${who}: ${d}`;
}

/**
 * Extract the filesystem path from a tool input payload. Covers the built-in
 * file tools (`read`, `write`, `edit`, `grep`, `find`, `ls`) plus `bash` when
 * we can spot a path-like argument in the command.
 */
function pickPath(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName === "read" || toolName === "write" || toolName === "edit") {
    return typeof input.path === "string" ? input.path : undefined;
  }
  if (toolName === "ls" || toolName === "find" || toolName === "grep") {
    return typeof input.path === "string" ? input.path : undefined;
  }
  return undefined;
}

// ─── Message templating ────────────────────────────────────────────────────────

function renderBlockMessage(template: string | undefined, vars: Record<string, string>): string {
  const fallback = `Blocked by sf-guardrail.`;
  const source = template ?? fallback;
  return source.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
}
