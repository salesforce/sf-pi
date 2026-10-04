/* SPDX-License-Identifier: Apache-2.0 */
/** Salesforce-aware org opening tool for SF Browser. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { renderBrowserToolCall, renderBrowserToolResult } from "./browser-render.ts";
import { openOrgInAgentBrowser } from "./operations.ts";
import { SalesforceNavigationTargetSchema } from "./salesforce-path-schema.ts";

export const SF_BROWSER_OPEN_ORG_TOOL_NAME = "sf_browser_open_org";

export function registerSfBrowserOpenOrgTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_OPEN_ORG_TOOL_NAME,
    label: "SF Browser Open Org",
    description:
      "Open one Salesforce navigation target in the shared agent-browser session without exposing session-bearing login URLs. The target discriminates explicit paths, curated Setup/Data Cloud destinations, verified Lightning apps, records, lists, and exact External Client Apps.",
    promptSnippet:
      "Open the target Salesforce org/path in agent-browser without exposing login URLs",
    promptGuidelines: [
      "Use sf_browser_open_org before Salesforce UI last-mile work, then call sf_browser_snapshot before acting.",
      "Pass exactly one target object. Lightning app, External Client App, list-view, and related-list targets use org verification; known paths, home, Setup, Data Cloud, object, and record targets resolve locally.",
    ],
    renderCall: (args, theme) => renderBrowserToolCall(SF_BROWSER_OPEN_ORG_TOOL_NAME, args, theme),
    renderResult: (result, options, theme, context) =>
      renderBrowserToolResult(SF_BROWSER_OPEN_ORG_TOOL_NAME, result, options, theme, context),
    parameters: Type.Object({
      target_org: Type.Optional(
        Type.String({
          description: "Salesforce org alias or username. Defaults to active sf-pi target org.",
        }),
      ),
      target: SalesforceNavigationTargetSchema,
      purpose: Type.Optional(
        Type.String({
          description: "Short reason for opening this org/path, used only in result metadata.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await openOrgInAgentBrowser(pi, ctx, params, signal);
      return {
        content: [{ type: "text" as const, text: result.text }],
        details: result.details,
      };
    },
  });
}
