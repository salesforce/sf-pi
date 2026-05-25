/* SPDX-License-Identifier: Apache-2.0 */
/** Status and doctor rendering for SF Herdr. */
import type { HerdrSignalState } from "./signal-state.ts";
import {
  herdrPreferencesPath,
  readSfHerdrPreferences,
} from "../../../lib/common/herdr-profile/store.ts";

export interface HerdrRuntimeStatus {
  inHerdrPane: boolean;
  activeControlEnv: boolean;
  passiveStatusBridge: boolean;
  paneId?: string;
}

export function getHerdrRuntimeStatus(env: NodeJS.ProcessEnv = process.env): HerdrRuntimeStatus {
  return {
    inHerdrPane: env.HERDR_ENV === "1" && !!env.HERDR_PANE_ID,
    activeControlEnv: env.HERDR_ENV === "1" && !!env.HERDR_PANE_ID,
    passiveStatusBridge: env.HERDR_ENV === "1" && !!env.HERDR_SOCKET_PATH && !!env.HERDR_PANE_ID,
    paneId: env.HERDR_PANE_ID,
  };
}

export function renderStatus(signalState: HerdrSignalState): string {
  const runtime = getHerdrRuntimeStatus();
  const preferences = readSfHerdrPreferences();
  const inferred = signalState.infer();
  const recent = signalState.recent(5);
  const lines: string[] = [];

  lines.push("SF Herdr status");
  lines.push(`Runtime: ${runtime.inHerdrPane ? "inside Herdr pane" : "not inside Herdr pane"}`);
  lines.push(`Active control env: ${runtime.activeControlEnv ? "ready" : "unavailable"}`);
  lines.push(`Passive status bridge: ${runtime.passiveStatusBridge ? "ready" : "not detected"}`);
  if (runtime.paneId) lines.push(`Pane: ${runtime.paneId}`);
  lines.push(`Preferences: ${herdrPreferencesPath()}`);
  lines.push(`Workflow mode: ${preferences.workflowMode}`);
  lines.push(
    `Inferred workflow: ${inferred.primaryWorkflow} (${Math.round(inferred.confidence * 100)}%) — ${inferred.reason}`,
  );
  if (inferred.relatedWorkflows.length > 0) {
    lines.push(`Related workflows: ${inferred.relatedWorkflows.join(", ")}`);
  }
  if (recent.length > 0) {
    lines.push("");
    lines.push("Recent signals:");
    for (const item of recent) {
      lines.push(`- ${item.workflow}: ${item.reason}`);
    }
  }
  return lines.join("\n");
}

export function renderDoctor(signalState: HerdrSignalState): string {
  const runtime = getHerdrRuntimeStatus();
  const inferred = signalState.infer();
  const checks = [
    `✓ sf-herdr extension loaded`,
    `${runtime.activeControlEnv ? "✓" : "○"} Herdr active-control environment ${runtime.activeControlEnv ? "detected" : "not detected"}`,
    `${runtime.passiveStatusBridge ? "✓" : "○"} Passive Herdr status bridge ${runtime.passiveStatusBridge ? "detected" : "not detected"}`,
    `✓ Preferences path ${herdrPreferencesPath()}`,
    `✓ Signal inference ready (${inferred.primaryWorkflow}, ${Math.round(inferred.confidence * 100)}%)`,
  ];
  return [
    "SF Herdr doctor",
    ...checks,
    "",
    "Notes:",
    "- The upstream npm:@ogulcancelik/pi-herdr package provides the actual herdr tool.",
    "- sf-herdr plans lanes only; it does not mutate panes or generate shell commands.",
    "- sf-guardrail mediates herdr.run commands when configured safety rules match.",
  ].join("\n");
}
