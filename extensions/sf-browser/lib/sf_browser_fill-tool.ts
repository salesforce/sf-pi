/* SPDX-License-Identifier: Apache-2.0 */
/** Ref-first fill tool for SF Browser's hot path. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runAgentBrowser } from "./agent-browser.ts";
import { renderBrowserToolCall, renderBrowserToolResult } from "./browser-render.ts";
import { throwWithFailureDiagnostics } from "./failure-diagnostics.ts";
import { STALE_REF_HINT } from "./guidance.ts";
import { requireFreshBrowserRef } from "./ref-freshness.ts";
import { retryInFrameAction } from "./in-frame-actions.ts";
import { captureVisualCheckpoint } from "./operations.ts";
import { startTimer } from "./timing.ts";
import { okText } from "./tool-support.ts";

export const SF_BROWSER_FILL_TOOL_NAME = "sf_browser_fill";

export function registerSfBrowserFillTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_FILL_TOOL_NAME,
    label: "SF Browser Fill",
    description:
      "Fill a text input ref from the latest sf_browser_snapshot. For Salesforce lookup/combobox controls, fill the visible input, wait for options, snapshot, then click the desired option.",
    promptSnippet: "Fill refs from the latest Salesforce browser snapshot",
    promptGuidelines: [
      "Use sf_browser_fill for normal text inputs. For Salesforce lookup or combobox controls, fill, wait for options, snapshot, then click the option ref.",
    ],
    renderCall: (args, theme) => renderBrowserToolCall(SF_BROWSER_FILL_TOOL_NAME, args, theme),
    renderResult: (result, options, theme, context) =>
      renderBrowserToolResult(SF_BROWSER_FILL_TOOL_NAME, result, options, theme, context),
    parameters: Type.Object({
      ref: Type.String({ description: "Input ref from sf_browser_snapshot, for example @e4." }),
      value: Type.String({ description: "Value to fill." }),
      secret: Type.Optional(
        Type.Boolean({ description: "When true, redact the filled value from tool output." }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      requireFreshBrowserRef(ctx.sessionManager.getSessionId(), params.ref);
      const stopTimer = startTimer();
      let recoveredIframeRef: string | undefined;
      try {
        await runAgentBrowser(pi, ["fill", params.ref, params.value], { cwd: ctx.cwd, signal });
      } catch (error) {
        const retry = await retryInFrameAction(pi, {
          cwd: ctx.cwd,
          targetRef: params.ref,
          actionArgs: ["fill", params.ref, params.value],
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
              toolName: SF_BROWSER_FILL_TOOL_NAME,
              action: `fill ${params.ref} with ${params.secret ? "<redacted>" : JSON.stringify(params.value)}`,
              ref: params.ref,
              durationMs: duration.durationMs,
            },
            "error" in retry && retry.error
              ? new Error(
                  `${error instanceof Error ? error.message : String(error)}\nAutomatic in-frame retry failed: ${retry.error}`,
                )
              : error,
            signal,
          );
        }
      }
      const afterActionEvidence = await captureVisualCheckpoint(
        pi,
        ctx,
        {
          label: `after-fill-${params.ref}`,
          imageMode: "artifact",
          dismissOverlays: false,
          ifChanged: true,
          forceThumbnail: true,
          stepId: toolCallId,
          phase: "after-action",
          toolName: SF_BROWSER_FILL_TOOL_NAME,
        },
        signal,
      );
      const duration = stopTimer();
      const valueText = params.secret ? "<redacted>" : params.value;
      return {
        content: [
          {
            type: "text" as const,
            text: okText([
              `Filled ${params.ref} with ${JSON.stringify(valueText)}.`,
              recoveredIframeRef
                ? `Recovered covered-element failure by retrying inside frame ${recoveredIframeRef}.`
                : undefined,
              `Duration: ${duration.durationText}`,
              "For Salesforce lookup/combobox controls: wait for options, snapshot, then click the desired option.",
              STALE_REF_HINT,
            ]),
          },
        ],
        details: {
          ok: true,
          ref: params.ref,
          secret: params.secret === true,
          recoveredIframeRef,
          afterActionEvidence: afterActionEvidence.details.capture,
          visualUnchanged: afterActionEvidence.details.unchanged === true,
          ...duration,
        },
      };
    },
  });
}
