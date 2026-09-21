/* SPDX-License-Identifier: Apache-2.0 */
/** Stable SF Flow error envelope. */

import { buildFlowDigest, row, section, toolResultFromDigest } from "./digest.ts";
import type { SfFlowParams, ToolResult } from "./types.ts";

export function flowErrorResult(params: SfFlowParams, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const digest = buildFlowDigest({
    action: params.action,
    kind: "flow_error",
    status: "fail",
    icon: "🌊",
    title: "SF Flow · failed",
    meta: [params.file ?? params.target_org ?? "request"],
    sections: [section("🧯", "Error", [row("❌", "Message", message)])],
    next_step: "Correct the input or first reported platform error, then retry the same action.",
  });
  return toolResultFromDigest(digest, { error: message });
}
