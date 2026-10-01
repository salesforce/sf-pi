/* SPDX-License-Identifier: Apache-2.0 */
/** Secret-safe SF Integrate error results. */

import type { SfIntegrateParams, ToolResult } from "./types.ts";

export function integrationErrorResult(params: SfIntegrateParams, error: unknown): ToolResult {
  const message = safeMessage(error);
  return {
    content: [{ type: "text", text: `SF Integrate ${params.action} failed: ${message}` }],
    details: { ok: false, action: params.action, error: message },
    isError: true,
  };
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/gu, " ").trim().slice(0, 2_000) || "Unknown integration error";
}
