/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Best-effort Ambient Overlay Dismissal for Salesforce UI.
 *
 * This parser only targets known non-workflow overlays. It deliberately avoids
 * generic "click every Close button" behavior so task-relevant modals remain
 * intact.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runAgentBrowser } from "./agent-browser.ts";

export interface OverlayDismissalResult {
  dismissedRefs: string[];
  snapshotChecked: boolean;
}

const AMBIENT_OVERLAY_MARKERS = [
  "Action Required: Security Contact Missing",
  "Security Contact Missing",
  "My Service Journey",
  "See what you’re missing out on",
] as const;

export async function dismissAmbientOverlays(
  pi: ExtensionAPI,
  cwd: string,
  signal?: AbortSignal,
): Promise<OverlayDismissalResult> {
  const dismissedRefs: string[] = [];
  let snapshotChecked = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await safeSnapshot(pi, cwd, signal);
    if (!snapshot) break;
    snapshotChecked = true;

    const refs = findAmbientOverlayCloseRefs(snapshot).filter(
      (ref) => !dismissedRefs.includes(ref),
    );
    if (refs.length === 0) break;

    for (const ref of refs.slice(0, 3)) {
      try {
        await runAgentBrowser(pi, ["click", ref], { cwd, signal, timeoutMs: 15_000 });
        dismissedRefs.push(ref);
      } catch {
        // Best effort only. Evidence capture should continue even when an
        // ambient close control goes stale between snapshot and click.
      }
    }
  }

  return { dismissedRefs, snapshotChecked };
}

export function findAmbientOverlayCloseRefs(snapshot: string): string[] {
  const lines = snapshot.split(/\r?\n/);
  const refs: string[] = [];

  // Global welcome/setup banners expose an explicit "Close banner" control.
  for (const line of lines) {
    const closeBanner = refFromLine(line, /button "Close banner"/);
    if (closeBanner) refs.push(closeBanner);
  }

  // Known setup-assistance panels are ambient and obscure screenshots. Only
  // close a generic "Close" button when it appears close to a known marker.
  for (let i = 0; i < lines.length; i += 1) {
    if (!AMBIENT_OVERLAY_MARKERS.some((marker) => lines[i]?.includes(marker))) continue;
    for (const nearby of lines.slice(Math.max(0, i - 8), i + 12)) {
      const close = refFromLine(nearby, /button "Close"/);
      if (close) refs.push(close);
    }
  }

  return [...new Set(refs)];
}

async function safeSnapshot(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  try {
    const result = await runAgentBrowser(pi, ["snapshot", "-i", "-c"], {
      cwd,
      signal,
      timeoutMs: 20_000,
    });
    return result.stdout;
  } catch {
    return null;
  }
}

function refFromLine(line: string, labelPattern: RegExp): string | null {
  if (!labelPattern.test(line)) return null;
  return line.match(/\[ref=(e\d+)\]/)?.[1] ?? null;
}
