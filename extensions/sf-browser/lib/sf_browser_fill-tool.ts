/* SPDX-License-Identifier: Apache-2.0 */
/** Ref-first fill tool for SF Browser's hot path. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runAgentBrowser } from "./agent-browser.ts";
import { throwWithFailureDiagnostics } from "./failure-diagnostics.ts";
import { STALE_REF_HINT } from "./guidance.ts";
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
    parameters: Type.Object({
      ref: Type.String({ description: "Input ref from sf_browser_snapshot, for example @e4." }),
      value: Type.String({ description: "Value to fill." }),
      secret: Type.Optional(
        Type.Boolean({ description: "When true, redact the filled value from tool output." }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const stopTimer = startTimer();
      try {
        await runAgentBrowser(pi, ["fill", params.ref, params.value], { cwd: ctx.cwd, signal });
      } catch (error) {
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
          error,
          signal,
        );
      }
      const duration = stopTimer();
      const valueText = params.secret ? "<redacted>" : params.value;
      return {
        content: [
          {
            type: "text" as const,
            text: okText([
              `Filled ${params.ref} with ${JSON.stringify(valueText)}.`,
              `Duration: ${duration.durationText}`,
              "For Salesforce lookup/combobox controls: wait for options, snapshot, then click the desired option.",
              STALE_REF_HINT,
            ]),
          },
        ],
        details: { ok: true, ref: params.ref, secret: params.secret === true, ...duration },
      };
    },
  });
}
