/* SPDX-License-Identifier: Apache-2.0 */
/** Ref-first click tool for SF Browser's hot path. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runAgentBrowser } from "./agent-browser.ts";
import {
  type AcceptedBrowserDialog,
  runClassicSetupMutationClick,
} from "./classic-setup-submit.ts";
import { evidenceLabelForMutationBefore, shouldCaptureMutationBefore } from "./evidence-policy.ts";
import { throwWithFailureDiagnostics } from "./failure-diagnostics.ts";
import { STALE_REF_HINT } from "./guidance.ts";
import { retryInFrameAction } from "./in-frame-actions.ts";
import { captureEvidence } from "./operations.ts";
import { startTimer } from "./timing.ts";
import { okText } from "./tool-support.ts";

export const SF_BROWSER_CLICK_TOOL_NAME = "sf_browser_click";

export function registerSfBrowserClickTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_CLICK_TOOL_NAME,
    label: "SF Browser Click",
    description:
      "Click an element ref from the latest sf_browser_snapshot. This is ref-first by design; use direct agent-browser commands for semantic locators or long-tail interactions.",
    promptSnippet: "Click refs from the latest Salesforce browser snapshot",
    promptGuidelines: [
      "Use sf_browser_click only with refs from the latest sf_browser_snapshot; wait and snapshot again after page-changing Salesforce clicks.",
    ],
    parameters: Type.Object({
      ref: Type.String({ description: "Element ref from sf_browser_snapshot, for example @e3." }),
      reason: Type.Optional(
        Type.String({ description: "Short reason for the click, used only in result metadata." }),
      ),
      mutation: Type.Optional(
        Type.Boolean({
          description:
            "Mark this click as a committing mutation such as save, deploy, enable, delete, assign, or submit. When true, SF Browser captures before-mutation evidence automatically.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const stopTimer = startTimer();
      const beforeEvidence = shouldCaptureMutationBefore(params)
        ? await captureEvidence(
            pi,
            ctx,
            {
              label: evidenceLabelForMutationBefore("click", params.ref),
              imageMode: "thumbnail",
            },
            signal,
          )
        : undefined;
      let recoveredIframeRef: string | undefined;
      let acceptedDialogs: AcceptedBrowserDialog[] = [];
      try {
        if (params.mutation === true) {
          const submit = await runClassicSetupMutationClick(pi, {
            cwd: ctx.cwd,
            ref: params.ref,
            signal,
          });
          acceptedDialogs = submit.acceptedDialogs;
        } else {
          await runAgentBrowser(pi, ["click", params.ref], { cwd: ctx.cwd, signal });
        }
      } catch (error) {
        const retry = await retryInFrameAction(pi, {
          cwd: ctx.cwd,
          targetRef: params.ref,
          actionArgs: ["click", params.ref],
          error,
          signal,
        });
        if (retry.ok) {
          recoveredIframeRef = retry.iframeRef;
        } else {
          const duration = stopTimer();
          await throwWithFailureDiagnostics(
            pi,
            ctx,
            {
              toolName: SF_BROWSER_CLICK_TOOL_NAME,
              action: `click ${params.ref}`,
              ref: params.ref,
              durationMs: duration.durationMs,
            },
            error,
            signal,
          );
        }
      }
      const duration = stopTimer();
      return {
        content: [
          ...(beforeEvidence?.content ?? []),
          {
            type: "text" as const,
            text: okText([
              `Clicked ${params.ref}.`,
              params.reason ? `Reason: ${params.reason}` : undefined,
              beforeEvidence
                ? "Before-mutation Browser Evidence captured. Use sf_browser_wait with lightning='save-result' after the committing action for post-mutation evidence."
                : undefined,
              recoveredIframeRef
                ? `Recovered covered-element failure by retrying inside frame ${recoveredIframeRef}.`
                : undefined,
              ...formatAcceptedDialogs(acceptedDialogs),
              `Duration: ${duration.durationText}`,
              STALE_REF_HINT,
            ]),
          },
        ],
        details: {
          ok: true,
          ref: params.ref,
          reason: params.reason,
          mutation: params.mutation,
          beforeMutationEvidence: beforeEvidence?.details.capture,
          recoveredIframeRef,
          acceptedDialogs,
          ...duration,
        },
      };
    },
  });
}

function formatAcceptedDialogs(dialogs: AcceptedBrowserDialog[]): string[] {
  if (!dialogs.length) return [];
  return dialogs.map((dialog, index) => {
    const label = dialog.type ? `${dialog.type} dialog` : "browser dialog";
    const message = dialog.message ? `: ${dialog.message}` : "";
    return `Accepted Salesforce ${label} ${index + 1}${message}`;
  });
}
