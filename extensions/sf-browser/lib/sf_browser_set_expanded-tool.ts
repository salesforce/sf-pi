/* SPDX-License-Identifier: Apache-2.0 */
/** Idempotent Salesforce disclosure control with fresh-snapshot verification. */
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  findLatestBrowserSnapshotSession,
  markLatestBrowserSnapshotStale,
  writeLatestBrowserSnapshotRefs,
} from "../../../lib/common/sf-browser-snapshot-state.ts";
import { runAgentBrowser } from "./agent-browser.ts";
import { renderBrowserToolCall, renderBrowserToolResult } from "./browser-render.ts";
import {
  findExpansionControlByLabel,
  findExpansionControlInSnapshot,
  type SnapshotExpansionControl,
} from "./expanded-control.ts";
import { throwWithFailureDiagnostics } from "./failure-diagnostics.ts";
import { captureVisualCheckpoint } from "./operations.ts";
import { requireFreshBrowserRef } from "./ref-freshness.ts";
import { startTimer } from "./timing.ts";
import { okText, writeBrowserArtifact } from "./tool-support.ts";

export const SF_BROWSER_SET_EXPANDED_TOOL_NAME = "sf_browser_set_expanded";

export function registerSfBrowserSetExpandedTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_SET_EXPANDED_TOOL_NAME,
    label: "SF Browser Set Expanded",
    description:
      "Set a Salesforce disclosure control to an explicit expanded or collapsed state. Accepts a fresh expandable button or Setup tree-item ref, resolves nested Expand/Collapse controls, and verifies the resulting state in a fresh snapshot.",
    promptSnippet:
      "Open or close Salesforce Setup categories and global menus idempotently with observed-state proof",
    promptGuidelines: [
      "Use sf_browser_set_expanded for Setup categories, the global Setup menu, App Launcher, and other controls that publish expanded=true/false.",
      "Pass a ref from the latest sf_browser_snapshot and the explicit desiredState; the tool fails closed when a fresh snapshot does not confirm the state.",
    ],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    renderCall: (args, theme) =>
      renderBrowserToolCall(SF_BROWSER_SET_EXPANDED_TOOL_NAME, args, theme),
    renderResult: (result, options, theme, context) =>
      renderBrowserToolResult(SF_BROWSER_SET_EXPANDED_TOOL_NAME, result, options, theme, context),
    parameters: Type.Object({
      ref: Type.String({
        description:
          "Expandable button or Setup tree-item ref from the latest sf_browser_snapshot.",
      }),
      desiredState: Type.Boolean({
        description: "true to expand/open; false to collapse/close.",
      }),
      reason: Type.Optional(
        Type.String({ description: "Short reason for changing the disclosure state." }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      requireFreshBrowserRef(sessionId, params.ref);
      const previousSession = findLatestBrowserSnapshotSession(sessionId);
      const initialSnapshot = readSnapshot(previousSession?.fullSnapshotPath);
      const initial = findExpansionControlInSnapshot(initialSnapshot, params.ref);
      if (!initial) {
        throw new Error(
          `Ref ${params.ref} is not an expandable control or Setup tree item with a nested Expand/Collapse button. Capture a fresh snapshot and choose a control that publishes expanded=true/false.`,
        );
      }
      if (initial.disabled) {
        throw new Error(`Disclosure ${JSON.stringify(initial.label)} is disabled.`);
      }

      const stopTimer = startTimer();
      let changed = false;
      if (initial.expanded !== params.desiredState) {
        try {
          await runAgentBrowser(pi, ["click", initial.controlRef], { cwd: ctx.cwd, signal });
          changed = true;
        } catch (error) {
          const duration = stopTimer();
          await throwWithFailureDiagnostics(
            pi,
            ctx,
            {
              toolName: SF_BROWSER_SET_EXPANDED_TOOL_NAME,
              action: `${params.desiredState ? "expand" : "collapse"} ${initial.label}`,
              ref: initial.controlRef,
              durationMs: duration.durationMs,
            },
            error,
            signal,
          );
        }
      }

      markLatestBrowserSnapshotStale(
        sessionId,
        `sf_browser_set_expanded ${params.ref} -> ${params.desiredState}`,
      );
      const observed = await pollExpandedState(pi, ctx.cwd, initial, params.desiredState, signal);
      if (!observed.control || observed.control.expanded !== params.desiredState) {
        const duration = stopTimer();
        await throwWithFailureDiagnostics(
          pi,
          ctx,
          {
            toolName: SF_BROWSER_SET_EXPANDED_TOOL_NAME,
            action: `verify ${initial.label} as ${params.desiredState ? "expanded" : "collapsed"}`,
            ref: params.ref,
            durationMs: duration.durationMs,
          },
          new Error(
            `The fresh Salesforce snapshot did not confirm ${JSON.stringify(initial.label)} as ${params.desiredState ? "expanded" : "collapsed"}.`,
          ),
          signal,
        );
      }

      const observedUrl = await currentBrowserUrl(pi, ctx.cwd, signal, previousSession?.url);
      const fullSnapshotPath = writeBrowserArtifact(observed.snapshot, {
        label: "expanded-snapshot",
        extension: "txt",
        sessionId,
      });
      writeLatestBrowserSnapshotRefs({
        sessionId,
        snapshot: observed.snapshot,
        url: observedUrl,
        fullSnapshotPath,
      });
      const afterEvidence = await captureVisualCheckpoint(
        pi,
        ctx,
        {
          label: `after-expanded-${params.ref}-${params.desiredState ? "open" : "closed"}`,
          imageMode: "artifact",
          dismissOverlays: false,
          ifChanged: true,
          forceThumbnail: true,
          currentUrl: observedUrl,
          stepId: toolCallId,
          phase: "after",
          toolName: SF_BROWSER_SET_EXPANDED_TOOL_NAME,
        },
        signal,
      );
      const duration = stopTimer();
      return {
        content: [
          {
            type: "text" as const,
            text: okText([
              `${initial.label}: ${params.desiredState ? "expanded" : "collapsed"}.`,
              initial.expanded === params.desiredState
                ? "Already in the requested state; no click was needed."
                : "Requested state verified in a fresh Salesforce snapshot.",
              initial.controlRef !== initial.targetRef
                ? `Used nested ${params.desiredState ? "Expand" : "Collapse"} control ${initial.controlRef} for Setup tree item ${initial.targetRef}.`
                : undefined,
              params.reason ? `Reason: ${params.reason}` : undefined,
              `Duration: ${duration.durationText}`,
            ]),
          },
        ],
        details: {
          ok: true,
          ref: params.ref,
          targetRef: initial.targetRef,
          controlRef: initial.controlRef,
          label: initial.label,
          role: initial.role,
          previousState: initial.expanded,
          desiredState: params.desiredState,
          observedState: observed.control?.expanded,
          changed,
          reason: params.reason,
          afterActionEvidence: afterEvidence.details.capture,
          ...duration,
        },
      };
    },
  });
}

async function pollExpandedState(
  pi: ExtensionAPI,
  cwd: string,
  initial: SnapshotExpansionControl,
  desiredState: boolean,
  signal: AbortSignal | undefined,
): Promise<{ snapshot: string; control?: SnapshotExpansionControl }> {
  let snapshot = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) {
      await runAgentBrowser(pi, ["wait", "250"], { cwd, signal, timeoutMs: 5_000 });
    }
    const result = await runAgentBrowser(pi, ["snapshot", "-i", "-c"], {
      cwd,
      signal,
      timeoutMs: 15_000,
    });
    snapshot = result.stdout.trim();
    const control = findExpansionControlByLabel(snapshot, initial.label, initial.role);
    if (control?.expanded === desiredState) return { snapshot, control };
  }
  return {
    snapshot,
    control: findExpansionControlByLabel(snapshot, initial.label, initial.role),
  };
}

function readSnapshot(path: string | undefined): string {
  if (!path) throw new Error("The latest sf_browser_snapshot has no full snapshot artifact.");
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error("The latest sf_browser_snapshot artifact could not be read.");
  }
}

async function currentBrowserUrl(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
  fallback: string | undefined,
): Promise<string | undefined> {
  try {
    const result = await runAgentBrowser(pi, ["get", "url"], {
      cwd,
      signal,
      timeoutMs: 10_000,
    });
    return result.stdout.trim() || fallback;
  } catch {
    return fallback;
  }
}
