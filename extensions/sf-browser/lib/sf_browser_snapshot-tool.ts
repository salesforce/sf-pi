/* SPDX-License-Identifier: Apache-2.0 */
/** Compact accessibility snapshot tool for SF Browser. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { writeLatestBrowserSnapshotRefs } from "../../../lib/common/sf-browser-snapshot-state.ts";
import { renderBrowserToolCall, renderBrowserToolResult } from "./browser-render.ts";
import { runAgentBrowser } from "./agent-browser.ts";
import { RAW_AGENT_BROWSER_ESCAPE_HATCH, STALE_REF_HINT } from "./guidance.ts";
import { expandMissingIframeSnapshots } from "./in-frame-actions.ts";
import { dismissAmbientOverlays } from "./overlay-dismissal.ts";
import { captureVisualCheckpoint } from "./operations.ts";
import { readEffectiveSfBrowserSettings } from "./settings.ts";
import { snapshotOutputModeFromUnknown, summarizeSnapshot } from "./snapshot-summary.ts";
import { startTimer } from "./timing.ts";
import { formatPossiblyLargeOutput, okText, writeBrowserArtifact } from "./tool-support.ts";

export const SF_BROWSER_SNAPSHOT_TOOL_NAME = "sf_browser_snapshot";

const SnapshotOutputMode = StringEnum(["summary", "artifact", "full"] as const, {
  description:
    "summary returns compact decision-oriented context and saves the full snapshot artifact (default); artifact returns only metadata; full returns full snapshot inline with truncation.",
});

export function registerSfBrowserSnapshotTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_SNAPSHOT_TOOL_NAME,
    label: "SF Browser Snapshot",
    description:
      "Capture a pi-native agent-browser accessibility snapshot for Salesforce UI reasoning. By default returns a compact summary and stores the full snapshot as an artifact. Re-run after Salesforce page-changing actions because refs become stale.",
    promptSnippet: "Capture compact Salesforce UI snapshots with short-lived agent-browser refs",
    promptGuidelines: [
      "Use sf_browser_snapshot before browser actions and after every Salesforce page-changing click, save, modal open, navigation, tab switch, or Lightning rerender.",
      "When the effective dismissOverlays setting is enabled, snapshots close only recognized ambient Salesforce overlays before publishing refs.",
      "sf_browser_snapshot defaults to outputMode=summary to avoid context dumps; request outputMode=full only when the summary misses needed refs.",
    ],
    renderCall: (args, theme) => renderBrowserToolCall(SF_BROWSER_SNAPSHOT_TOOL_NAME, args, theme),
    renderResult: (result, options, theme, context) =>
      renderBrowserToolResult(SF_BROWSER_SNAPSHOT_TOOL_NAME, result, options, theme, context),
    parameters: Type.Object({
      interactive: Type.Optional(
        Type.Boolean({ description: "Only include interactive elements. Defaults to true." }),
      ),
      compact: Type.Optional(
        Type.Boolean({ description: "Remove empty structural nodes. Defaults to true." }),
      ),
      maxDepth: Type.Optional(
        Type.Number({ description: "Optional snapshot depth cap passed to agent-browser -d." }),
      ),
      outputMode: Type.Optional(SnapshotOutputMode),
      focus: Type.Optional(
        Type.Array(Type.String({ description: "Term to prioritize in the compact summary." }), {
          description: "Optional focus terms to keep matching refs in the compact summary.",
        }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const stopTimer = startTimer();
      const settings = readEffectiveSfBrowserSettings(ctx.cwd);
      const overlayDismissal = settings.dismissOverlays
        ? await dismissAmbientOverlays(pi, ctx.cwd, signal)
        : { dismissedRefs: [], snapshotChecked: false };
      const args = ["snapshot"];
      if (params.interactive !== false) args.push("-i");
      if (params.compact !== false) args.push("-c");
      if (typeof params.maxDepth === "number" && Number.isFinite(params.maxDepth)) {
        args.push("-d", String(Math.max(1, Math.floor(params.maxDepth))));
      }

      const result = await runAgentBrowser(pi, args, { cwd: ctx.cwd, signal });
      const currentUrl = await getCurrentUrl(pi, ctx.cwd, signal);
      const sessionId = ctx.sessionManager.getSessionId();
      const settledSnapshot = await settleClassicSetupSnapshot(
        pi,
        ctx.cwd,
        currentUrl,
        result.stdout.trim(),
        signal,
      );
      const expandedFrames = await expandMissingIframeSnapshots(
        pi,
        { cwd: ctx.cwd, snapshot: settledSnapshot.snapshot, sessionId, currentUrl },
        signal,
      );
      const rawSnapshot = expandedFrames.snapshot;
      const fullSnapshotPath = writeBrowserArtifact(rawSnapshot, {
        label: "snapshot",
        extension: "txt",
        sessionId,
      });
      writeLatestBrowserSnapshotRefs({
        sessionId,
        snapshot: rawSnapshot,
        url: currentUrl,
        fullSnapshotPath,
      });
      const outputMode = snapshotOutputModeFromUnknown(params.outputMode);
      const focus = Array.isArray(params.focus) ? params.focus : [];

      const body = buildSnapshotBody(
        rawSnapshot,
        fullSnapshotPath,
        outputMode,
        focus,
        currentUrl,
        sessionId,
      );
      const visualEvidence = await captureVisualCheckpoint(
        pi,
        ctx,
        {
          label: "snapshot-current-page",
          imageMode: "artifact",
          dismissOverlays: false,
          ifChanged: true,
          forceThumbnail: true,
          currentUrl,
          stepId: toolCallId,
          phase: "observed",
          toolName: SF_BROWSER_SNAPSHOT_TOOL_NAME,
        },
        signal,
      );
      const duration = stopTimer();
      const text = okText([
        body,
        overlayDismissal.dismissedRefs.length
          ? `Dismissed ambient overlays: ${overlayDismissal.dismissedRefs.join(", ")}`
          : undefined,
        expandedFrames.expandedFrameRefs.length
          ? `Expanded iframe controls: ${expandedFrames.expandedFrameRefs.join(", ")}`
          : undefined,
        `Duration: ${duration.durationText}`,
        "",
        STALE_REF_HINT,
        RAW_AGENT_BROWSER_ESCAPE_HATCH,
      ]);
      return {
        content: [{ type: "text" as const, text }],
        details: {
          ok: true,
          outputMode,
          fullSnapshotPath,
          currentUrl,
          sessionId,
          focus,
          rawLength: rawSnapshot.length,
          overlayDismissal,
          expandedFrameRefs: expandedFrames.expandedFrameRefs,
          classicSetupPolls: settledSnapshot.polls,
          evidence: visualEvidence.details.capture,
          visualUnchanged: visualEvidence.details.unchanged === true,
          ...duration,
        },
      };
    },
  });
}

function buildSnapshotBody(
  rawSnapshot: string,
  fullSnapshotPath: string,
  outputMode: "summary" | "artifact" | "full",
  focus: string[],
  url: string | undefined,
  sessionId: string,
): string {
  if (outputMode === "artifact") {
    return [
      "Snapshot captured as artifact.",
      `Full snapshot: ${fullSnapshotPath}`,
      focus.length ? `Focus terms: ${focus.join(", ")}` : undefined,
      "Use outputMode=summary for compact refs or outputMode=full for explicit inline output.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (outputMode === "full") {
    const formatted = formatPossiblyLargeOutput(rawSnapshot, {
      label: "snapshot-full",
      extension: "txt",
      maxBytes: 50_000,
      maxLines: 2_000,
      sessionId,
    });
    return okText([
      formatted.text,
      formatted.fullOutputPath ? `Full snapshot: ${formatted.fullOutputPath}` : undefined,
    ]);
  }

  return summarizeSnapshot({ snapshot: rawSnapshot, fullSnapshotPath, focus, url });
}

export type SetupSnapshotClassification = "iframe" | "native-content" | "empty";

export function classifySetupSnapshot(snapshot: string): SetupSnapshotClassification {
  if (/^\s*- Iframe\b/imu.test(snapshot)) return "iframe";
  for (const rawLine of snapshot.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (
      /^- (checkbox|switch|textbox|listbox|columnheader|rowheader|gridcell|cell|table|grid)\b/iu.test(
        line,
      )
    ) {
      return "native-content";
    }
    if (/^- combobox\b/iu.test(line) && !/"(?:Search Setup|Quick Find)"/iu.test(line)) {
      return "native-content";
    }
    if (
      /^- button "\s*(?:New|Save|Create|Add|Edit|Delete|Assign|Activate|Enable|Disable|View)\b/iu.test(
        line,
      )
    ) {
      return "native-content";
    }
  }
  return "empty";
}

async function settleClassicSetupSnapshot(
  pi: ExtensionAPI,
  cwd: string,
  currentUrl: string | undefined,
  initialSnapshot: string,
  signal: AbortSignal | undefined,
): Promise<{ snapshot: string; polls: number }> {
  if (!/\/lightning\/setup\//iu.test(currentUrl ?? "")) {
    return { snapshot: initialSnapshot, polls: 0 };
  }
  const initialKind = classifySetupSnapshot(initialSnapshot);
  if (initialKind !== "empty") return { snapshot: initialSnapshot, polls: 0 };

  try {
    const host = await runAgentBrowser(
      pi,
      [
        "eval",
        `(() => { const host = document.querySelector('force-aloha-page'); if (!host) return false; const style = getComputedStyle(host); const rect = host.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && host.getAttribute('aria-hidden') !== 'true'; })()`,
      ],
      { cwd, signal, timeoutMs: 10_000 },
    );
    if (host.stdout.trim() !== "true") return { snapshot: initialSnapshot, polls: 0 };
  } catch {
    return { snapshot: initialSnapshot, polls: 0 };
  }

  for (let polls = 1; polls <= 8; polls += 1) {
    if (polls > 1) {
      await runAgentBrowser(pi, ["wait", "250"], { cwd, signal, timeoutMs: 5_000 });
    }
    const refreshed = await runAgentBrowser(pi, ["snapshot", "-i", "-c"], {
      cwd,
      signal,
      timeoutMs: 15_000,
    });
    const snapshot = refreshed.stdout.trim();
    const kind = classifySetupSnapshot(snapshot);
    if (kind === "iframe") return { snapshot, polls };
    if (kind === "native-content") return { snapshot: initialSnapshot, polls };
  }
  return { snapshot: initialSnapshot, polls: 8 };
}

async function getCurrentUrl(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const result = await runAgentBrowser(pi, ["get", "url"], { cwd, signal, timeoutMs: 15_000 });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
