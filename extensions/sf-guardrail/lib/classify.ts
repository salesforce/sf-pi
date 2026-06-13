/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Classify an incoming tool_call event into a guardrail decision.
 *
 * Evaluation order (first hit wins):
 *   1. policies          → strongest protection wins, may short-circuit to block.
 *   2. safe auto-allow   → strictly validated OS temp cleanup is audited and allowed.
 *   3. commandGate       → allowedPatterns / autoDenyPatterns / confirm.
 *   4. orgAwareGate      → production-only rules.
 *
 * `bash.command` and `herdr.run.command` share the same command-safety path so
 * Herdr pane orchestration cannot bypass Salesforce-aware command mediation.
 */
import { evaluateCommand } from "./command-gate.ts";
import { blockedTools, matchPath } from "./policies.ts";
import { evaluateOrgAware } from "./org-aware-gate.ts";
import { resolveOrgContext, resolveOrgContextWithLookup, type OrgContext } from "./org-context.ts";
import { fingerprintCommand, fingerprintPath } from "./allowlist.ts";
import { approvalScopeForCommand, approvalScopeForOrgAware } from "./approval-scope.ts";
import { detectSafeTempCleanup } from "./temp-cleanup.ts";
import { splitSimpleCommands } from "./bash-ast.ts";
import type { ClassifiedDecision, GuardrailConfig } from "./types.ts";

export interface ClassifyInput {
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
  config: GuardrailConfig;
}

export function classify(input: ClassifyInput): ClassifiedDecision | undefined {
  return classifyInternal(input);
}

/**
 * Async refinement used by the runtime hook. It preserves the synchronous fast
 * path for tests and cheap cases, but when a production prompt is caused only
 * by a guessed explicit target-org, it performs a bounded in-process org lookup
 * so scratch/sandbox aliases can be proven safe.
 */
export async function classifyWithOrgLookup(
  input: ClassifyInput,
): Promise<ClassifiedDecision | undefined> {
  const fast = classifyInternal(input);
  if (!fast || !fast.orgResolutionGuessed || !fast.orgTargetExplicit || !fast.orgCommand) {
    return fast;
  }

  const refinedOrg = await resolveOrgContextWithLookup(
    fast.orgCommand,
    input.cwd,
    input.config.productionAliases,
  );
  if (fast.feature === "orgAwareGate") {
    return buildOrgAwareDecision(input, fast.subject, fast.orgCommand, refinedOrg);
  }
  if (fast.feature === "commandGate" && fast.ruleId === "sf-org-delete") {
    const scope = approvalScopeForCommand(fast.ruleId, fast.orgCommand, refinedOrg);
    return {
      ...fast,
      fingerprint: scope.fingerprint,
      approvalScope: scope,
      orgAlias: refinedOrg.alias,
      orgType: refinedOrg.type,
      orgId: refinedOrg.orgId,
      orgUsername: refinedOrg.username,
      orgResolutionGuessed: refinedOrg.guessed,
      orgResolutionSource: refinedOrg.source,
      orgTargetExplicit: refinedOrg.explicit,
    };
  }
  return fast;
}

function classifyInternal(input: ClassifyInput): ClassifiedDecision | undefined {
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

  const shellCommand = pickShellCommand(toolName, toolInput);

  // ── 2. Safe auto-allow for strictly validated temp cleanup ────────────────
  if (config.features.commandGate && shellCommand) {
    const safeCleanup = detectSafeTempCleanup(shellCommand.command);
    if (safeCleanup) {
      return {
        ruleId: "safe-temp-cleanup",
        feature: "commandGate",
        action: "allow",
        reason: `Strict OS temp cleanup auto-allowed: ${safeCleanup.path}`,
        promptTitle: "Strict OS temp cleanup",
        fingerprint: fingerprintPath(safeCleanup.realPath),
        subject: shellCommand.command,
      };
    }
  }

  // ── 3. Dangerous command gate ─────────────────────────────────────────────
  if (config.features.commandGate && shellCommand) {
    const command = shellCommand.command;
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
      const org =
        outcome.matched.id === "sf-org-delete"
          ? resolveOrgContext(command, cwd, config.productionAliases)
          : undefined;
      const scope = approvalScopeForCommand(outcome.matched.id, command, org);
      return {
        ruleId: outcome.matched.id,
        feature: "commandGate",
        action: "confirm",
        reason: `Dangerous command: ${outcome.matched.description ?? outcome.matched.pattern}`,
        promptTitle: `⚠ ${outcome.matched.description ?? outcome.matched.pattern}`,
        fingerprint: scope.fingerprint,
        subject: command,
        approvalScope: scope,
        orgAlias: org?.alias,
        orgType: org?.type,
        orgId: org?.orgId,
        orgUsername: org?.username,
        orgResolutionGuessed: org?.guessed,
        orgResolutionSource: org?.source,
        orgTargetExplicit: org?.explicit,
        orgCommand: org ? command : undefined,
      };
    }
  }

  // ── 4. Org-aware gate ─────────────────────────────────────────────────────
  if (config.features.orgAwareGate && shellCommand) {
    for (const orgCommand of splitSimpleCommands(shellCommand.command)) {
      const org = resolveOrgContext(orgCommand, cwd, config.productionAliases);
      const decision = buildOrgAwareDecision(input, shellCommand.command, orgCommand, org);
      if (decision) return decision;
    }
  }

  return undefined;
}

function buildOrgAwareDecision(
  input: ClassifyInput,
  fullCommand: string,
  orgCommand: string,
  org: OrgContext,
): ClassifiedDecision | undefined {
  const outcome = evaluateOrgAware(orgCommand, input.config.orgAwareGate.rules, org);
  if (!outcome) return undefined;

  const message = renderBlockMessage(outcome.rule.confirmMessage, {
    command: fullCommand,
    orgAlias: org.alias ?? "<unknown>",
    orgType: org.type,
  });
  const scope = approvalScopeForOrgAware(outcome.rule.id, orgCommand, org);
  return {
    ruleId: outcome.rule.id,
    feature: "orgAwareGate",
    action: outcome.rule.action,
    reason: org.guessed
      ? `${message}\n\nNote: sf-guardrail could not verify the target org type and is treating it as production.`
      : message,
    promptTitle: orgAwareTitle(outcome.rule.description, org),
    fingerprint: scope.fingerprint,
    subject: fullCommand,
    approvalScope: scope,
    orgAlias: org.alias,
    orgType: org.type,
    orgId: org.orgId,
    orgUsername: org.username,
    orgResolutionGuessed: org.guessed,
    orgResolutionSource: org.source,
    orgTargetExplicit: org.explicit,
    orgCommand,
  };
}

function pickShellCommand(
  toolName: string,
  input: Record<string, unknown>,
): { command: string } | undefined {
  if (toolName === "bash") {
    return typeof input.command === "string" ? { command: input.command } : undefined;
  }
  if (toolName === "herdr" && input.action === "run") {
    return typeof input.command === "string" ? { command: input.command } : undefined;
  }
  return undefined;
}

function orgAwareTitle(description: string | undefined, org: OrgContext): string {
  const tag = org.type.toUpperCase();
  const who = org.alias ? ` (${org.alias})` : "";
  const guessed = org.guessed ? " guessed" : "";
  const d = description ?? "Org-aware gate";
  return `⚠ ${tag}${guessed}${who}: ${d}`;
}

/**
 * Extract the filesystem path from a tool input payload. Covers the built-in
 * file tools (`read`, `write`, `edit`, `grep`, `find`, `ls`).
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
