/* SPDX-License-Identifier: Apache-2.0 */
/** Compact accessibility snapshot tool for SF Browser. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai/base";
import { Type } from "typebox";
import { runAgentBrowser } from "./agent-browser.ts";
import { RAW_AGENT_BROWSER_ESCAPE_HATCH, STALE_REF_HINT } from "./guidance.ts";
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
      "sf_browser_snapshot defaults to outputMode=summary to avoid context dumps; request outputMode=full only when the summary misses needed refs.",
    ],
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
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const stopTimer = startTimer();
      const args = ["snapshot"];
      if (params.interactive !== false) args.push("-i");
      if (params.compact !== false) args.push("-c");
      if (typeof params.maxDepth === "number" && Number.isFinite(params.maxDepth)) {
        args.push("-d", String(Math.max(1, Math.floor(params.maxDepth))));
      }

      const result = await runAgentBrowser(pi, args, { cwd: ctx.cwd, signal });
      const currentUrl = await getCurrentUrl(pi, ctx.cwd, signal);
      const sessionId = ctx.sessionManager.getSessionId();
      const rawSnapshot = result.stdout.trim();
      const fullSnapshotPath = writeBrowserArtifact(rawSnapshot, {
        label: "snapshot",
        extension: "txt",
        sessionId,
      });
      const outputMode = snapshotOutputModeFromUnknown(params.outputMode);
      const focus = Array.isArray(params.focus) ? params.focus : [];
      const duration = stopTimer();

      const body = buildSnapshotBody(
        rawSnapshot,
        fullSnapshotPath,
        outputMode,
        focus,
        currentUrl,
        sessionId,
      );
      const text = okText([
        body,
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
