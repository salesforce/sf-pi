/* SPDX-License-Identifier: Apache-2.0 */
/** Branch-scoped workflow signal inference for SF Herdr lane planning. */
import path from "node:path";
import type { ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { isEditToolResult, isWriteToolResult } from "@earendil-works/pi-coding-agent";

import type { HerdrWorkflowKey } from "../../../lib/common/herdr-profile/store.ts";

export interface HerdrWorkflowSignal {
  workflow: HerdrWorkflowKey;
  source: string;
  reason: string;
  weight: number;
  timestamp: number;
}

export interface InferredHerdrWorkflow {
  primaryWorkflow: HerdrWorkflowKey;
  relatedWorkflows: HerdrWorkflowKey[];
  confidence: number;
  reason: string;
}

export interface HerdrToolExecutionEndEvent {
  type?: string;
  toolCallId?: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
}

export interface HerdrSignalState {
  observe(signal: HerdrWorkflowSignal): void;
  observeToolExecutionEnd(event: HerdrToolExecutionEndEvent): void;
  observeToolResult(event: ToolResultEvent, cwd: string): void;
  reconstruct(ctx: ExtensionContext): void;
  infer(): InferredHerdrWorkflow;
  recent(limit?: number): HerdrWorkflowSignal[];
  reset(): void;
}

const MAX_SIGNALS = 40;
const WORKFLOW_ORDER: HerdrWorkflowKey[] = [
  "agentscript",
  "apex",
  "data360",
  "browser",
  "uiBundle",
  "generic",
];

export function createHerdrSignalState(): HerdrSignalState {
  let signals: HerdrWorkflowSignal[] = [];

  function observe(signal: HerdrWorkflowSignal): void {
    signals.push(signal);
    if (signals.length > MAX_SIGNALS) signals = signals.slice(-MAX_SIGNALS);
  }

  function observeToolExecutionEnd(event: HerdrToolExecutionEndEvent): void {
    const toolName = event.toolName;
    for (const signal of signalsFromToolCall(toolName, event.args)) {
      observe(signal);
    }
  }

  function observeToolResult(event: ToolResultEvent, cwd: string): void {
    if (event.isError) return;
    if (isEditToolResult(event) || isWriteToolResult(event)) {
      const rawPath = event.input.path;
      if (typeof rawPath === "string") {
        const signal = signalFromPath(path.resolve(cwd, rawPath));
        if (signal) observe(signal);
      }
    }
    for (const signal of signalsFromToolCall(event.toolName, event.input)) {
      observe(signal);
    }
  }

  function reconstruct(ctx: ExtensionContext): void {
    signals = [];
    const branch = ctx.sessionManager.getBranch();
    for (const entry of branch) {
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (message.role !== "toolResult") continue;
      const toolName = String(message.toolName ?? "");
      const rawMessage = message as unknown as { input?: unknown; details?: unknown };
      const input = isObject(rawMessage.input) ? rawMessage.input : {};
      for (const signal of signalsFromToolCall(toolName, input)) {
        observe(signal);
      }
      const pathValue = input.path;
      if (typeof pathValue === "string") {
        const signal = signalFromPath(path.resolve(ctx.cwd, pathValue));
        if (signal) observe(signal);
      }
    }
  }

  function infer(): InferredHerdrWorkflow {
    if (signals.length === 0) {
      return {
        primaryWorkflow: "generic",
        relatedWorkflows: [],
        confidence: 0.35,
        reason: "No recent Salesforce workflow signals; using generic Herdr profile.",
      };
    }

    const totals = new Map<HerdrWorkflowKey, number>();
    const reasons = new Map<HerdrWorkflowKey, string>();
    const now = Date.now();
    for (const signal of signals) {
      const ageMs = Math.max(0, now - signal.timestamp);
      const recency = Math.max(0.35, 1 - ageMs / (20 * 60_000));
      totals.set(signal.workflow, (totals.get(signal.workflow) ?? 0) + signal.weight * recency);
      reasons.set(signal.workflow, signal.reason);
    }

    const ranked = [...totals.entries()].sort((a, b) => {
      const byScore = b[1] - a[1];
      if (Math.abs(byScore) > 0.001) return byScore;
      return WORKFLOW_ORDER.indexOf(a[0]) - WORKFLOW_ORDER.indexOf(b[0]);
    });
    const [primary, primaryScore] = ranked[0] ?? ["generic", 0];
    const total = ranked.reduce((sum, [, score]) => sum + score, 0) || 1;
    const related = ranked
      .slice(1)
      .filter(([, score]) => score >= Math.max(0.6, primaryScore * 0.35))
      .slice(0, 2)
      .map(([workflow]) => workflow);

    return {
      primaryWorkflow: primary,
      relatedWorkflows: related,
      confidence: Math.max(0.35, Math.min(0.95, primaryScore / total + 0.25)),
      reason: `Recent ${primary} signal: ${reasons.get(primary) ?? "workflow activity observed"}.`,
    };
  }

  return {
    observe,
    observeToolExecutionEnd,
    observeToolResult,
    reconstruct,
    infer,
    recent: (limit = 8) => signals.slice(-limit).reverse(),
    reset: () => {
      signals = [];
    },
  };
}

function signalsFromToolCall(toolName: string, input: unknown): HerdrWorkflowSignal[] {
  const now = Date.now();
  if (toolName.startsWith("agentscript_")) {
    return [signal("agentscript", toolName, `${toolName} tool used`, 2.5, now)];
  }
  if (
    toolName === "d360" ||
    toolName.startsWith("d360_") ||
    toolName === "data360" ||
    toolName.startsWith("data360_")
  ) {
    return [signal("data360", toolName, `${toolName} tool used`, 2.5, now)];
  }
  if (toolName === "sf_apex") {
    return [signal("apex", toolName, `${toolName} tool used`, 2.3, now)];
  }
  if (toolName === "sf_lwc") {
    return [signal("uiBundle", toolName, `${toolName} tool used`, 2.0, now)];
  }
  if (toolName.startsWith("sf_browser_")) {
    return [signal("browser", toolName, `${toolName} tool used`, 2.2, now)];
  }
  if (toolName === "herdr" && isObject(input) && input.action === "run") {
    const command = typeof input.command === "string" ? input.command : "";
    return signalsFromCommand(command, now);
  }
  if (toolName === "bash" && isObject(input)) {
    const command = typeof input.command === "string" ? input.command : "";
    return signalsFromCommand(command, now);
  }
  return [];
}

function signalsFromCommand(command: string, now: number): HerdrWorkflowSignal[] {
  const lower = command.toLowerCase();
  const result: HerdrWorkflowSignal[] = [];
  if (/\bsf\s+apex\b|\bapex\s+run\s+test\b|\*test\.cls\b/i.test(command)) {
    result.push(signal("apex", "command", "Apex-related command observed", 1.8, now));
  }
  if (lower.includes("agentscript") || lower.includes(".agent")) {
    result.push(
      signal("agentscript", "command", "Agent Script-related command observed", 1.8, now),
    );
  }
  if (lower.includes("d360") || lower.includes("data360") || lower.includes("data 360")) {
    result.push(signal("data360", "command", "Data 360-related command observed", 1.7, now));
  }
  if (lower.includes("sf_browser") || lower.includes("agent-browser")) {
    result.push(signal("browser", "command", "Browser-related command observed", 1.6, now));
  }
  if (lower.includes("npm run dev") || lower.includes("vite") || lower.includes("uibundle")) {
    result.push(signal("uiBundle", "command", "UI bundle/server command observed", 1.6, now));
  }
  if (lower.includes("npm test") || lower.includes("vitest") || lower.includes("jest")) {
    result.push(signal("generic", "command", "Local test command observed", 1.0, now));
  }
  return result;
}

function signalFromPath(filePath: string): HerdrWorkflowSignal | undefined {
  const now = Date.now();
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".agent")) {
    return signal("agentscript", "file", "Agent Script file edited", 2.0, now);
  }
  if (lower.endsWith(".cls") || lower.endsWith(".trigger")) {
    return signal("apex", "file", "Apex file edited", 2.0, now);
  }
  if (lower.includes("/uibundles/") || lower.includes("/lwc/")) {
    return signal("uiBundle", "file", "UI bundle or LWC file edited", 1.6, now);
  }
  if (lower.includes("datacloud") || lower.includes("data360") || lower.includes("d360")) {
    return signal("data360", "file", "Data 360-related file edited", 1.5, now);
  }
  return undefined;
}

function signal(
  workflow: HerdrWorkflowKey,
  source: string,
  reason: string,
  weight: number,
  timestamp: number,
): HerdrWorkflowSignal {
  return { workflow, source, reason, weight, timestamp };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
