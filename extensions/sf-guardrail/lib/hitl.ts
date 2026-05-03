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
 *
 * The helper is a pure orchestrator; it does not know which rule is firing
 * or which audit entry to emit. index.ts handles those side effects based
 * on the returned ConfirmResult.
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type ConfirmResult =
  | { outcome: "allow_once" }
  | { outcome: "allow_session" }
  | { outcome: "block"; reason: string }
  | { outcome: "headless_pass" }
  | { outcome: "headless_block"; reason: string };

export interface ConfirmOptions {
  title: string;
  detail: string;
  timeoutMs: number;
  escapeHatchEnv: string;
  signal?: AbortSignal;
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

  const header = `${options.title}\n\n${options.detail}`;
  const picked = await ctx.ui.select(header, [ALLOW_ONCE_LABEL, ALLOW_SESSION_LABEL, BLOCK_LABEL], {
    timeout: options.timeoutMs,
    signal: options.signal,
  });

  if (picked === ALLOW_ONCE_LABEL) return { outcome: "allow_once" };
  if (picked === ALLOW_SESSION_LABEL) return { outcome: "allow_session" };
  if (picked === BLOCK_LABEL) {
    return { outcome: "block", reason: "Blocked by user via sf-guardrail." };
  }
  // Timeout or Esc
  return {
    outcome: "block",
    reason: "Blocked by sf-guardrail (timed out or cancelled).",
  };
}
