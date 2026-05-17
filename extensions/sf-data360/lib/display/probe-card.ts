/* SPDX-License-Identifier: Apache-2.0 */
/** Map d360_probe readiness results into the standard Data 360 result card. */

import type { ProbeResult, ProbeState } from "../probe-tool.ts";
import type { D360ResultCard } from "./card.ts";

export interface ProbeCardInput {
  targetOrg: string;
  apiVersion: string;
  state: "ready" | "ready_empty" | "partial" | "blocked";
  guidance: string;
  probes: ProbeResult[];
}

const READY_STATES: ProbeState[] = ["enabled_populated", "ok"];
const EMPTY_STATES: ProbeState[] = ["enabled_empty"];
const GATED_STATES: ProbeState[] = ["feature_gated"];
const FAILED_STATES: ProbeState[] = ["cli_error", "unknown_error", "tenant_missing", "not_found"];

export function probeResultToCard(input: ProbeCardInput, fullOutputPath?: string): D360ResultCard {
  const counts = countProbeStates(input.probes);
  const notable = buildNotableLines(input.probes);
  const surfaceLines = input.probes.map(renderProbeLine);
  const status =
    input.state === "blocked" ? "error" : input.state === "partial" ? "warning" : "success";

  return {
    status,
    icon: "📊",
    title: "Data 360 readiness",
    subtitle: `${input.targetOrg} · API v${input.apiVersion} · ${input.state}`,
    summary: input.guidance,
    facts: [
      { label: "Ready/populated", value: String(counts.ready) },
      { label: "Empty", value: String(counts.empty) },
      { label: "Feature gated", value: String(counts.gated) },
      { label: "Failed/unavailable", value: String(counts.failed) },
    ],
    sections: [
      ...(notable.length ? [{ title: "Notable", icon: "⚠️", lines: notable }] : []),
      { title: "Surfaces", icon: "☁️", lines: surfaceLines },
    ],
    artifacts: fullOutputPath
      ? [{ label: "Full JSON", path: fullOutputPath, kind: "json" }]
      : undefined,
    nextSteps: buildNextSteps(input.state, counts.failed),
  };
}

function countProbeStates(probes: ProbeResult[]): {
  ready: number;
  empty: number;
  gated: number;
  failed: number;
} {
  let ready = 0;
  let empty = 0;
  let gated = 0;
  let failed = 0;
  for (const probe of probes) {
    if (READY_STATES.includes(probe.state)) ready++;
    else if (EMPTY_STATES.includes(probe.state)) empty++;
    else if (GATED_STATES.includes(probe.state)) gated++;
    else if (FAILED_STATES.includes(probe.state)) failed++;
  }
  return { ready, empty, gated, failed };
}

function buildNotableLines(probes: ProbeResult[]): string[] {
  const problemStates = new Set<ProbeState>([
    "feature_gated",
    "not_found",
    "tenant_missing",
    "cli_error",
    "unknown_error",
  ]);
  const problems = probes
    .filter((probe) => problemStates.has(probe.state))
    .slice(0, 6)
    .map((probe) => `${statusIcon(probe.state)} ${probe.name}: ${probe.message ?? probe.state}`);
  const empty = probes
    .filter((probe) => probe.state === "enabled_empty")
    .slice(0, Math.max(0, 6 - problems.length))
    .map((probe) => `⚪ ${probe.name}: empty`);
  return [...problems, ...empty];
}

function renderProbeLine(probe: ProbeResult): string {
  const count = probe.count === undefined ? "" : ` · ${probe.count} ${probe.countKind ?? "count"}`;
  const message = probe.message ? ` · ${probe.message}` : "";
  return `${statusIcon(probe.state)} ${probe.name}: ${probe.state}${count}${message}`;
}

function statusIcon(state: ProbeState): string {
  if (READY_STATES.includes(state)) return "✅";
  if (EMPTY_STATES.includes(state)) return "⚪";
  if (GATED_STATES.includes(state)) return "🚧";
  if (state === "not_found") return "∅";
  return "⚠️";
}

function buildNextSteps(state: ProbeCardInput["state"], failedCount: number): string[] | undefined {
  if (state === "ready" || state === "ready_empty") {
    return ["Use d360 search/examples/runbook or d360_metadata for the next workflow step."];
  }
  if (failedCount > 0) {
    return [
      "Inspect failed surfaces in the full JSON before running workflows that depend on them.",
    ];
  }
  return undefined;
}
