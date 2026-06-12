/* SPDX-License-Identifier: Apache-2.0 */
/** Target preparation for automatic Browser Evidence checkpoints. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runAgentBrowser } from "./agent-browser.ts";
import { buildLightningWaitExpression, type LightningWaitModeValue } from "./lightning-wait.ts";

export type CheckpointEvidenceTarget = "current" | "record-details";

export function defaultCheckpointEvidenceTarget(
  lightning: LightningWaitModeValue | undefined,
): CheckpointEvidenceTarget {
  return lightning === "record-view" || lightning === "save-result" ? "record-details" : "current";
}

export function findDetailsTabRef(snapshot: string): string | undefined {
  for (const line of snapshot.split(/\r?\n/)) {
    if (!/\btab\s+"Details"/i.test(line)) continue;
    if (/\bselected\b/i.test(line)) return undefined;
    const ref = line.match(/\bref=(e\d+)\b/)?.[1];
    return ref ? `@${ref}` : undefined;
  }
  return undefined;
}

export async function prepareCheckpointEvidenceTarget(
  pi: ExtensionAPI,
  input: {
    cwd: string;
    target: CheckpointEvidenceTarget;
    signal?: AbortSignal;
  },
): Promise<{ target: CheckpointEvidenceTarget; clickedRef?: string; skipped?: string }> {
  if (input.target === "current") return { target: input.target };

  let snapshot: string;
  try {
    const result = await runAgentBrowser(pi, ["snapshot", "-i", "-c"], {
      cwd: input.cwd,
      signal: input.signal,
      timeoutMs: 15_000,
    });
    snapshot = result.stdout.trim();
  } catch {
    return { target: input.target, skipped: "snapshot-failed" };
  }

  const detailsRef = findDetailsTabRef(snapshot);
  if (!detailsRef) return { target: input.target, skipped: "details-tab-not-found-or-selected" };

  try {
    await runAgentBrowser(pi, ["click", detailsRef], {
      cwd: input.cwd,
      signal: input.signal,
      timeoutMs: 15_000,
    });
    await runAgentBrowser(pi, ["wait", "--fn", buildLightningWaitExpression("app-ready")], {
      cwd: input.cwd,
      signal: input.signal,
      timeoutMs: 15_000,
    });
    return { target: input.target, clickedRef: detailsRef };
  } catch {
    return { target: input.target, skipped: "details-tab-click-failed" };
  }
}
