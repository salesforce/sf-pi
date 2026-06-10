/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Local operation timings for sf-agentscript.
 *
 * These timings are local diagnostic facts only: phase names, durations, and
 * small non-sensitive hints such as cache hit/miss. They are returned in tool
 * details and, for human readability, appended as a compact emoji timing line.
 * No tokens, URLs, prompts, payloads, or org secrets should ever be recorded
 * here.
 */

import { performance } from "node:perf_hooks";
import type { ToolEnvelope, ToolError } from "./tool-types.ts";

export type TimingCacheState = "hit" | "miss" | "refresh" | "bypass";

export interface TimingPhase {
  name: string;
  ms: number;
  cache?: TimingCacheState;
  endpoint?: "" | "test." | "dev.";
  status?: "ok" | "error";
}

export interface TimingSnapshot {
  total_ms: number;
  phases: TimingPhase[];
}

export interface TimingCollector {
  phase: (name: string) => { end: (extra?: Omit<TimingPhase, "name" | "ms">) => void };
  time: <T>(name: string, run: () => Promise<T> | T) => Promise<T>;
  add: (name: string, ms: number, extra?: Omit<TimingPhase, "name" | "ms">) => void;
  snapshot: () => TimingSnapshot;
}

export function createTimingCollector(): TimingCollector {
  const started = performance.now();
  const phases: TimingPhase[] = [];
  const add = (name: string, ms: number, extra?: Omit<TimingPhase, "name" | "ms">): void => {
    phases.push({ name, ms: roundMs(ms), ...(extra ?? {}) });
  };
  return {
    phase(name) {
      const phaseStarted = performance.now();
      let ended = false;
      return {
        end(extra) {
          if (ended) return;
          ended = true;
          add(name, performance.now() - phaseStarted, extra);
        },
      };
    },
    async time<T>(name: string, run: () => Promise<T> | T): Promise<T> {
      const p = this.phase(name);
      try {
        const result = await run();
        p.end({ status: "ok" });
        return result;
      } catch (error) {
        p.end({ status: "error" });
        throw error;
      }
    },
    add,
    snapshot() {
      return {
        total_ms: roundMs(performance.now() - started),
        phases: [...phases],
      };
    },
  };
}

export function withTimings<T extends Record<string, unknown> | ToolError>(
  envelope: ToolEnvelope<T>,
  timings: TimingCollector,
  opts: { appendLine?: boolean } = {},
): ToolEnvelope<T & { timings: TimingSnapshot }> {
  const snapshot = timings.snapshot();
  const details = {
    ...((envelope.details ?? {}) as T),
    timings: snapshot,
  } as T & { timings: TimingSnapshot };
  const content = [...envelope.content];
  if (opts.appendLine && content[0]?.type === "text") {
    content[0] = {
      ...content[0],
      text: `${content[0].text}\n${renderTimingLine(snapshot)}`,
    };
  }
  return { ...envelope, details, content };
}

export function renderTimingLine(timings: TimingSnapshot): string {
  const phases = timings.phases.slice(0, 8).map(renderPhase).join("  ");
  const overflow = timings.phases.length > 8 ? `  …+${timings.phases.length - 8}` : "";
  return [`⏱️ Timing`, `total ${formatMs(timings.total_ms)}`, phases, overflow]
    .filter(Boolean)
    .join("  ");
}

function renderPhase(phase: TimingPhase): string {
  const cache = phase.cache ? ` ${cacheBadge(phase.cache)}` : "";
  const endpoint = phase.endpoint ? ` ${endpointLabel(phase.endpoint)}` : "";
  return `${phaseIcon(phase.name)} ${shortPhaseName(phase.name)} ${formatMs(phase.ms)}${cache}${endpoint}`;
}

function phaseIcon(name: string): string {
  if (/auth|jwt/i.test(name)) return "🔐";
  if (/server|sfap|eval|publish|preview|session|message/i.test(name)) return "☁️";
  if (/local|compile|diagnostic|sdk/i.test(name)) return "🧪";
  if (/trace|report|artifact|persist|write/i.test(name)) return "📎";
  if (/org|soql|target|preflight|readiness|user/i.test(name)) return "🔎";
  if (/cache/i.test(name)) return "⚡";
  return "•";
}

function shortPhaseName(name: string): string {
  return name
    .replace(/^agentscript\./, "")
    .replace(/^authoring\./, "")
    .replace(/_/g, " ");
}

function cacheBadge(cache: TimingCacheState): string {
  switch (cache) {
    case "hit":
      return "🟢 cache hit";
    case "miss":
      return "🟠 cache miss";
    case "refresh":
      return "🔄 cache refresh";
    case "bypass":
      return "⚪ cache bypass";
  }
}

function endpointLabel(endpoint: "" | "test." | "dev."): string {
  if (endpoint === "") return "api";
  if (endpoint === "test.") return "test.api";
  return "dev.api";
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
  return `${Math.round(ms)}ms`;
}

function roundMs(ms: number): number {
  return Math.max(0, Math.round(ms));
}
