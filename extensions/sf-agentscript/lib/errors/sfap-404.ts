/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Single source of truth for the SFAP-404 user-facing message.
 *
 * Five copies of nearly-identical wording used to live in
 * lifecycle.ts (×2), lifecycle-tool.ts, preview/client.ts, and
 * agent-api-error-map.ts — most of them claiming "your org isn't
 * Agentforce-enabled" with high confidence. That claim is wrong any
 * time the same session has already had a successful publish or
 * preview, which made the message actively misleading. The original
 * postmortem (Issue 5) caught it firing immediately after a
 * successful first publish.
 *
 * The rewritten message:
 *   - states what happened ("404 across host fallback")
 *   - calls out that 404s are usually transient
 *   - lists the two possible permanent causes (org / permissions)
 *   - never claims to know which one applies
 *
 * Pure function, no I/O — safe to call from any layer.
 */

/**
 * Build the canonical SFAP-404 message. `phase` is interpolated into
 * the leading sentence so the operator knows which call failed.
 *
 * `agentApiName` is optional; when provided, the message includes a
 * concrete next-step nudge to confirm prior version state via
 * `agentscript_lifecycle action='list_versions'`.
 */
export function sfap404Message(opts: {
  phase: "publish" | "compile" | "preview" | "activate";
  agentApiName?: string;
}): string {
  const phaseWord =
    opts.phase === "compile"
      ? "Server compile"
      : opts.phase === "preview"
        ? "Preview"
        : opts.phase === "activate"
          ? "Activate"
          : "Publish";
  const lines: string[] = [
    `${phaseWord} returned 404 across the SFAP host fallback (api / test.api / dev.api).`,
    "",
    "404s on this endpoint are usually transient — retry in 30s. If every call fails:",
    "  • the org may not be Agentforce-enabled (e.g. a basic dev edition), or",
    "  • the running user may lack the right permission set assignment.",
  ];
  if (opts.agentApiName) {
    lines.push("");
    lines.push(
      `If you've already published this agent in this session, confirm with: ` +
        `agentscript_lifecycle action='list_versions' agent_api_name='${opts.agentApiName}'.`,
    );
  }
  return lines.join("\n");
}
