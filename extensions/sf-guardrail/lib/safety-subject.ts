/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Normalize Pi tool calls into SF Guardrail Safety Subjects.
 *
 * This keeps tool-shape knowledge out of the Safety Kernel and lower-level risk
 * gates. It is intentionally narrow: only file-path tools, bash commands, and
 * `herdr.run.command` are safety subjects today.
 */
import { classifyNativeToolRisk } from "./native-tool-risk-registry.ts";
import type { SafetySubject } from "./types.ts";

const FILE_PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

export interface SafetySubjectContext {
  sessionId?: string;
}

export function normalizeSafetySubject(
  toolName: string,
  input: Record<string, unknown>,
  context: SafetySubjectContext = {},
): SafetySubject | undefined {
  if (FILE_PATH_TOOLS.has(toolName) && typeof input.path === "string") {
    return { kind: "file", toolName, path: input.path };
  }

  if (toolName === "bash" && typeof input.command === "string") {
    return { kind: "shellCommand", toolName, command: input.command };
  }

  if (toolName === "herdr" && input.action === "run" && typeof input.command === "string") {
    return { kind: "shellCommand", toolName, command: input.command };
  }

  return classifyNativeToolRisk(toolName, input, context);
}
