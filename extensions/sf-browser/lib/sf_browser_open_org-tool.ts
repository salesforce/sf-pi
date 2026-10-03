/* SPDX-License-Identifier: Apache-2.0 */
/** Salesforce-aware org opening tool for SF Browser. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { openOrgInAgentBrowser } from "./operations.ts";
import { SalesforceRouteSchema } from "./salesforce-path-schema.ts";

export const SF_BROWSER_OPEN_ORG_TOOL_NAME = "sf_browser_open_org";

export function registerSfBrowserOpenOrgTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_OPEN_ORG_TOOL_NAME,
    label: "SF Browser Open Org",
    description:
      "Open a Salesforce org/path, structured Salesforce route, or curated Setup Destination in the shared agent-browser session without exposing session-bearing login URLs. Use this before SF Browser snapshot/click/fill workflows.",
    promptSnippet:
      "Open the target Salesforce org/path in agent-browser without exposing login URLs",
    promptGuidelines: [
      "Use sf_browser_open_org before Salesforce UI last-mile work, then call sf_browser_snapshot before acting.",
      "To open one External Client App without search-and-click navigation, use route={type:'external-client-app', appName:'<API name>'}; the route is verified through Tooling API.",
    ],
    parameters: Type.Object({
      target_org: Type.Optional(
        Type.String({
          description: "Salesforce org alias or username. Defaults to active sf-pi target org.",
        }),
      ),
      path: Type.Optional(
        Type.String({
          description:
            "Optional Salesforce path, for example /lightning/setup/SetupOneHome/home. Do not combine with setup or route.",
        }),
      ),
      setup: Type.Optional(
        Type.String({
          description:
            "Curated Setup Destination, such as setup-home, agentforce-agents, flows, object-manager, or users. Do not combine with path or route.",
        }),
      ),
      route: Type.Optional(SalesforceRouteSchema),
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
