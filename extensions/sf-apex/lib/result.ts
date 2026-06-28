/* SPDX-License-Identifier: Apache-2.0 */
/** Small tool-result helpers for sf-apex actions. */

import type { ToolResult } from "./types.ts";

export function ok(text: string, details: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], details: { ok: true, ...details } };
}

export function fail(text: string, details: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], details: { ok: false, ...details } };
}
