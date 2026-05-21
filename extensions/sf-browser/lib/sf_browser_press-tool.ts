/* SPDX-License-Identifier: Apache-2.0 */
/** Keyboard press tool for SF Browser's hot path. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runAgentBrowser } from "./agent-browser.ts";
import { throwWithFailureDiagnostics } from "./failure-diagnostics.ts";
import { STALE_REF_HINT } from "./guidance.ts";
import { startTimer } from "./timing.ts";
import { okText } from "./tool-support.ts";

export const SF_BROWSER_PRESS_TOOL_NAME = "sf_browser_press";

export function registerSfBrowserPressTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_PRESS_TOOL_NAME,
    label: "SF Browser Press",
    description:
      "Press a keyboard key in the shared Salesforce browser session, useful for search boxes, lookup/combobox confirmation, tabbing, Escape, and modal flows.",
    promptSnippet: "Press keyboard keys in the shared Salesforce browser session",
    promptGuidelines: [
      "Use sf_browser_press after focusing/filling when Salesforce expects keyboard confirmation, such as Enter in search boxes or Escape for modals.",
    ],
    parameters: Type.Object({
      key: Type.String({ description: "Key or chord, for example Enter, Escape, Tab, Control+a." }),
      reason: Type.Optional(
        Type.String({
          description: "Short reason for the key press, used only in result metadata.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const stopTimer = startTimer();
      try {
        await runAgentBrowser(pi, ["press", params.key], { cwd: ctx.cwd, signal });
      } catch (error) {
        const duration = stopTimer();
        await throwWithFailureDiagnostics(
          pi,
          ctx,
          {
            toolName: SF_BROWSER_PRESS_TOOL_NAME,
            action: `press ${params.key}`,
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
              `Pressed ${params.key}.`,
              params.reason ? `Reason: ${params.reason}` : undefined,
              `Duration: ${duration.durationText}`,
              STALE_REF_HINT,
            ]),
          },
        ],
        details: { ok: true, key: params.key, reason: params.reason, ...duration },
      };
    },
  });
}
