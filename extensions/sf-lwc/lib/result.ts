/* SPDX-License-Identifier: Apache-2.0 */
/** Small result helpers for sf-lwc actions. */

import type { LwcRunDigest, ToolResult } from "./types.ts";

export function ok(text: string, details: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], details: { ok: true, ...details } };
}

export function fail(text: string, details: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], details: { ok: false, ...details } };
}

export function toolResultFromDigest(
  digest: LwcRunDigest,
  extra: Record<string, unknown> = {},
): ToolResult {
  return {
    content: [{ type: "text", text: compactText(digest) }],
    details: {
      ok: digest.status !== "fail",
      digest,
      ...(digest.recommended_skills?.length
        ? { recommended_skills: digest.recommended_skills }
        : {}),
      ...(digest.recommended_tools?.length ? { recommended_tools: digest.recommended_tools } : {}),
      ...extra,
    },
  };
}

export function compactText(digest: LwcRunDigest): string {
  const scope = digest.scope ? `: ${digest.scope}` : "";
  const suffix =
    digest.status === "pass" ? "passed" : digest.status === "fail" ? "failed" : digest.status;
  return `${digest.title}${scope ? ` ${scope}` : ""} — ${suffix}.`;
}
