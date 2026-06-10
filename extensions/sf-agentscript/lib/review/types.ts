/* SPDX-License-Identifier: Apache-2.0 */
/** Shared review finding shape for deterministic Agent Script readiness review. */

export interface ReviewFinding {
  id: string;
  severity: "blocker" | "warning" | "info";
  category: "compile" | "shape" | "flow" | "actions" | "deployment" | "org";
  message: string;
  evidence?: string[];
  recover_via?: { tool: string; params: Record<string, unknown> };
}
