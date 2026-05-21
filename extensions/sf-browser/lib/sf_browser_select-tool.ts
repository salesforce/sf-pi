/* SPDX-License-Identifier: Apache-2.0 */
/** Ref-first select tool for Salesforce classic setup and dual-list controls. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runAgentBrowser } from "./agent-browser.ts";
import { throwWithFailureDiagnostics } from "./failure-diagnostics.ts";
import { STALE_REF_HINT } from "./guidance.ts";
import { startTimer } from "./timing.ts";
import { okText } from "./tool-support.ts";

export const SF_BROWSER_SELECT_TOOL_NAME = "sf_browser_select";

export function registerSfBrowserSelectTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_SELECT_TOOL_NAME,
    label: "SF Browser Select",
    description:
      "Select one or more values in a Salesforce select/listbox ref from the latest sf_browser_snapshot. Useful for Classic Setup dual-list controls such as permission set assignments.",
    promptSnippet:
      "Select values in Salesforce select/listbox refs, including Classic Setup dual-list controls",
    promptGuidelines: [
      "Use sf_browser_select for Salesforce select boxes, multi-selects, and Classic Setup dual-list controls; then click Add or Remove and snapshot before saving.",
    ],
    parameters: Type.Object({
      ref: Type.String({
        description: "Select/listbox ref from sf_browser_snapshot, for example @e171.",
      }),
      values: Type.Array(Type.String({ description: "Visible option value to select." }), {
        description: "One or more visible option values to select.",
        minItems: 1,
      }),
      reason: Type.Optional(
        Type.String({
          description: "Short reason for the selection, used only in result metadata.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const stopTimer = startTimer();
      try {
        await runAgentBrowser(pi, ["select", params.ref, ...params.values], {
          cwd: ctx.cwd,
          signal,
        });
      } catch (error) {
        const duration = stopTimer();
        await throwWithFailureDiagnostics(
          pi,
          ctx,
          {
            toolName: SF_BROWSER_SELECT_TOOL_NAME,
            action: `select ${params.ref}`,
            ref: params.ref,
            durationMs: duration.durationMs,
          },
          error,
          signal,
        );
      }
      const duration = stopTimer();
      return {
        content: [
          {
            type: "text" as const,
            text: okText([
              `Selected ${params.values.map((value) => JSON.stringify(value)).join(", ")} in ${params.ref}.`,
              params.reason ? `Reason: ${params.reason}` : undefined,
              `Duration: ${duration.durationText}`,
              "For Classic Setup dual-list controls: click Add or Remove, then snapshot before saving.",
              STALE_REF_HINT,
            ]),
          },
        ],
        details: {
          ok: true,
          ref: params.ref,
          values: params.values,
          reason: params.reason,
          ...duration,
        },
      };
    },
  });
}
