/* SPDX-License-Identifier: Apache-2.0 */
/** Ref-first click tool for SF Browser's hot path. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runAgentBrowser } from "./agent-browser.ts";
import { throwWithFailureDiagnostics } from "./failure-diagnostics.ts";
import { STALE_REF_HINT } from "./guidance.ts";
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
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const stopTimer = startTimer();
      try {
        await runAgentBrowser(pi, ["click", params.ref], { cwd: ctx.cwd, signal });
      } catch (error) {
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
      const duration = stopTimer();
      return {
        content: [
          {
            type: "text" as const,
            text: okText([
              `Clicked ${params.ref}.`,
              params.reason ? `Reason: ${params.reason}` : undefined,
              `Duration: ${duration.durationText}`,
              STALE_REF_HINT,
            ]),
          },
        ],
        details: { ok: true, ref: params.ref, reason: params.reason, ...duration },
      };
    },
  });
}
