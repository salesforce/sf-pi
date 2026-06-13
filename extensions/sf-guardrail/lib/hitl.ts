/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Human-in-the-loop confirmation for sf-guardrail.
 *
 * Single shared primitive modeled on sf-slack/recipient-confirm.ts:
 *   - Interactive mode → ctx.ui.select with three options:
 *       • Allow once
 *       • Allow for this session  (persisted via pi.appendEntry)
 *       • Block
 *     Timeout equals block.
 *   - Headless mode → env escape hatch allows pass-through with an audit
 *     warning; otherwise block. Never fail-open silently.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ConfirmResult =
  | { outcome: "allow_once" }
  | { outcome: "allow_session" }
  | { outcome: "allow_persisted" }
  | { outcome: "block"; reason: string }
  | { outcome: "timeout"; reason: string }
  | { outcome: "cancel"; reason: string }
  | { outcome: "headless_pass" }
  | { outcome: "headless_block"; reason: string };

export interface ConfirmOptions {
  title: string;
  detail: string;
  timeoutMs: number;
  escapeHatchEnv: string;
  signal?: AbortSignal;
  scopedAllowLabel?: string;
}

const ALLOW_ONCE_LABEL = "Allow once";
const ALLOW_SESSION_LABEL = "Allow for this session";
const BLOCK_LABEL = "Block";

export async function confirmDecision(
  ctx: ExtensionContext,
  options: ConfirmOptions,
): Promise<ConfirmResult> {
  if (!ctx.hasUI) {
    const envValue = process.env[options.escapeHatchEnv];
    if (envValue && envValue !== "0" && envValue.toLowerCase() !== "false") {
      return { outcome: "headless_pass" };
    }
    return {
      outcome: "headless_block",
      reason:
        `${options.title}\n\n${options.detail}\n\n` +
        `Blocked by sf-guardrail in headless mode. Set ${options.escapeHatchEnv}=1 to opt in.`,
    };
  }

  const timeoutSeconds = Math.ceil(options.timeoutMs / 1000);
  const header = `${options.title}\n\n${options.detail}\n\nApproval timeout: ${timeoutSeconds}s.`;
  const startedAt = Date.now();
  ctx.ui.setStatus?.("sf-guardrail", `Approval required: ${options.title}`);
  ctx.ui.notify?.(`sf-guardrail approval required: ${options.title}`, "warning");

  try {
    const scopedLabel = options.scopedAllowLabel ?? ALLOW_SESSION_LABEL;
    const picked = await ctx.ui.select(header, [ALLOW_ONCE_LABEL, scopedLabel, BLOCK_LABEL], {
      timeout: options.timeoutMs,
      signal: options.signal,
    });

    if (picked === ALLOW_ONCE_LABEL) return { outcome: "allow_once" };
    if (picked === scopedLabel) {
      return options.scopedAllowLabel
        ? { outcome: "allow_persisted" }
        : { outcome: "allow_session" };
    }
    if (picked === BLOCK_LABEL) {
      return { outcome: "block", reason: detailedBlockReason("Blocked by user", options) };
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= options.timeoutMs - 250) {
      return {
        outcome: "timeout",
        reason: detailedBlockReason(
          `Approval expired after ${timeoutSeconds}s with no response`,
          options,
        ),
      };
    }
    return {
      outcome: "cancel",
      reason: detailedBlockReason("Approval was cancelled", options),
    };
  } finally {
    ctx.ui.setStatus?.("sf-guardrail", undefined);
  }
}

function detailedBlockReason(summary: string, options: ConfirmOptions): string {
  return `${summary} by sf-guardrail.\n\n${options.title}\n\n${options.detail}\n\nRun /sf-guardrail audit to inspect recent decisions, then retry if appropriate.`;
}
