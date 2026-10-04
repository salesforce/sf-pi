/* SPDX-License-Identifier: Apache-2.0 */
/** Idempotent Salesforce checkbox/switch tool with visual before/after proof. */
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
import { throwWithFailureDiagnostics } from "./failure-diagnostics.ts";
import {
  expandMissingIframeSnapshots,
  findInFrameRetryPlan,
  readRememberedFrameUrl,
} from "./in-frame-actions.ts";
import { captureEvidence, captureVisualCheckpoint } from "./operations.ts";
import { requireFreshBrowserRef } from "./ref-freshness.ts";
import { startTimer } from "./timing.ts";
import {
  findToggleInSnapshot,
  setToggleState,
  toggleStateFromSnapshotLine,
} from "./toggle-control.ts";
import { okText, writeBrowserArtifact } from "./tool-support.ts";

export const SF_BROWSER_SET_TOGGLE_TOOL_NAME = "sf_browser_set_toggle";

export function registerSfBrowserSetToggleTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_SET_TOGGLE_TOOL_NAME,
    label: "SF Browser Set Toggle",
    description:
      "Set a Salesforce checkbox or switch to an explicit desired state using a fresh snapshot ref. The operation is idempotent, captures before/after Browser Evidence, verifies the observed state, and uses a narrow keyboard-first Classic Setup adapter for force-aloha iframe surfaces.",
    promptSnippet:
      "Set Salesforce toggles idempotently with explicit desired state and before/after proof",
    promptGuidelines: [
      "Use sf_browser_set_toggle instead of a generic click when the target is a checkbox or switch.",
      "The tool verifies in-page state only. When persistence is pending-save, click the explicit Save control and verify the resulting state.",
    ],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    renderCall: (args, theme) =>
      renderBrowserToolCall(SF_BROWSER_SET_TOGGLE_TOOL_NAME, args, theme),
    renderResult: (result, options, theme, context) =>
      renderBrowserToolResult(SF_BROWSER_SET_TOGGLE_TOOL_NAME, result, options, theme, context),
    parameters: Type.Object({
      ref: Type.String({
        description: "Checkbox or switch ref from the latest sf_browser_snapshot.",
      }),
      desiredState: Type.Boolean({ description: "true for On/checked; false for Off/unchecked." }),
      reason: Type.Optional(
        Type.String({ description: "Short reason for changing the control state." }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const entry = requireFreshBrowserRef(sessionId, params.ref);
      const role = entry.role?.toLowerCase();
      if (role !== "checkbox" && role !== "switch") {
        throw new Error(
          `Ref ${params.ref} is ${entry.role ?? "an unknown control"}, not a checkbox or switch. Capture a fresh snapshot and choose a toggle ref.`,
        );
      }
      if (!entry.label) throw new Error(`Ref ${params.ref} has no accessible label.`);
      const currentState = toggleStateFromSnapshotLine(entry.line);
      if (currentState === undefined) {
        throw new Error(`Ref ${params.ref} did not publish an explicit checked state.`);
      }
      if (/\bdisabled\b/iu.test(entry.line)) {
        throw new Error(`Toggle ${JSON.stringify(entry.label)} is disabled and cannot be changed.`);
      }

      const stopTimer = startTimer();
      const previousSession = findLatestBrowserSnapshotSession(sessionId);
      const beforeEvidence = await captureEvidence(
        pi,
        ctx,
        {
          label: `before-toggle-${params.ref}`,
          imageMode: "artifact",
          dismissOverlays: false,
          forceThumbnail: true,
          currentUrl: previousSession?.url,
          stepId: toolCallId,
          phase: "before",
          toolName: SF_BROWSER_SET_TOGGLE_TOOL_NAME,
        },
        signal,
      );

      const frameRef = findToggleFrameRef(previousSession?.fullSnapshotPath, params.ref);
      const frameUrl = readRememberedFrameUrl(sessionId, frameRef);
      let recoveredClassicSetup = false;
      let changed = false;
      if (currentState !== params.desiredState) {
        try {
          const action = await setToggleState(
            pi,
            {
              cwd: ctx.cwd,
              ref: params.ref,
              role,
              label: entry.label,
              desiredState: params.desiredState,
              frameRef,
              frameUrl,
            },
            signal,
          );
          recoveredClassicSetup = action.recoveredClassicSetup;
          changed = action.changed;
        } catch (error) {
          const duration = stopTimer();
          await throwWithFailureDiagnostics(
            pi,
            ctx,
            {
              toolName: SF_BROWSER_SET_TOGGLE_TOOL_NAME,
              action: `set ${entry.label} to ${params.desiredState ? "On" : "Off"}`,
              ref: params.ref,
              durationMs: duration.durationMs,
            },
            error,
            signal,
          );
        }
      }

      markLatestBrowserSnapshotStale(
        sessionId,
        `sf_browser_set_toggle ${params.ref} -> ${params.desiredState}`,
      );
      const snapshotResult = await runAgentBrowser(pi, ["snapshot", "-i", "-c"], {
        cwd: ctx.cwd,
        signal,
        timeoutMs: 15_000,
      });
      const expandedSnapshot = await expandMissingIframeSnapshots(
        pi,
        { cwd: ctx.cwd, snapshot: snapshotResult.stdout.trim() },
        signal,
      );
      const rawSnapshot = expandedSnapshot.snapshot;
      const observedUrl = await currentBrowserUrl(pi, ctx.cwd, signal, previousSession?.url);
      const fullSnapshotPath = writeBrowserArtifact(rawSnapshot, {
        label: "toggle-snapshot",
        extension: "txt",
        sessionId,
      });
      writeLatestBrowserSnapshotRefs({
        sessionId,
        snapshot: rawSnapshot,
        url: observedUrl,
        fullSnapshotPath,
      });
      const observed = findToggleInSnapshot(rawSnapshot, entry.label);
      if (!observed || observed.checked !== params.desiredState) {
        const duration = stopTimer();
        await throwWithFailureDiagnostics(
          pi,
          ctx,
          {
            toolName: SF_BROWSER_SET_TOGGLE_TOOL_NAME,
            action: `verify ${entry.label} as ${params.desiredState ? "On" : "Off"}`,
            ref: params.ref,
            durationMs: duration.durationMs,
          },
          new Error("The fresh Salesforce snapshot did not confirm the requested toggle state."),
          signal,
        );
      }

      const afterEvidence = await captureVisualCheckpoint(
        pi,
        ctx,
        {
          label: `after-toggle-${params.ref}-${params.desiredState ? "on" : "off"}`,
          imageMode: "artifact",
          dismissOverlays: false,
          forceThumbnail: true,
          currentUrl: observedUrl,
          stepId: toolCallId,
          phase: "after",
          toolName: SF_BROWSER_SET_TOGGLE_TOOL_NAME,
        },
        signal,
      );
      const persistence = hasSaveControl(rawSnapshot) ? "pending-save" : "ui-state-verified";
      const duration = stopTimer();
      return {
        content: [
          {
            type: "text" as const,
            text: okText([
              `${entry.label}: ${params.desiredState ? "On" : "Off"}.`,
              currentState === params.desiredState
                ? "Already in the requested state; no toggle action was needed."
                : "Requested state verified in a fresh Salesforce snapshot.",
              params.reason ? `Reason: ${params.reason}` : undefined,
              recoveredClassicSetup
                ? "Recovered the force-aloha covered-element failure through the keyboard-first Classic Setup adapter."
                : undefined,
              persistence === "pending-save"
                ? "Persistence: pending explicit Save and resulting-state verification."
                : "Persistence: UI state verified; use API or reopen verification when durable state matters.",
              `Duration: ${duration.durationText}`,
            ]),
          },
        ],
        details: {
          ok: true,
          ref: params.ref,
          role,
          label: entry.label,
          previousState: currentState,
          desiredState: params.desiredState,
          observedState: observed.checked,
          changed,
          persistence,
          recoveredClassicSetup,
          frameRef,
          promotedClassicFrame: Boolean(frameUrl),
          beforeMutationEvidence: beforeEvidence.details.capture,
          afterActionEvidence: afterEvidence.details.capture,
          reason: params.reason,
          ...duration,
        },
      };
    },
  });
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

function findToggleFrameRef(fullSnapshotPath: string | undefined, ref: string): string | undefined {
  if (!fullSnapshotPath) return undefined;
  try {
    return findInFrameRetryPlan(readFileSync(fullSnapshotPath, "utf8"), ref)?.iframeRef;
  } catch {
    return undefined;
  }
}

function hasSaveControl(snapshot: string): boolean {
  return /^\s*- button "\s*Save\s*"/imu.test(snapshot);
}
