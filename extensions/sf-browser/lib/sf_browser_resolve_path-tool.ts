/* SPDX-License-Identifier: Apache-2.0 */
/** Structured Salesforce route/path resolver tool for SF Browser. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isResolvedSalesforcePath, resolveSalesforcePath } from "./salesforce-path-resolver.ts";
import { SalesforceRouteSchema } from "./salesforce-path-schema.ts";
import { getSetupDestination } from "./setup-destinations.ts";
import { startTimer } from "./timing.ts";
import { okText } from "./tool-support.ts";

export const SF_BROWSER_RESOLVE_PATH_TOOL_NAME = "sf_browser_resolve_path";

export function registerSfBrowserResolvePathTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_RESOLVE_PATH_TOOL_NAME,
    label: "SF Browser Resolve Path",
    description:
      "Resolve a structured Salesforce route, explicit Salesforce path, or bounded fuzzy Setup Destination to a deterministic Salesforce path without opening the browser.",
    promptSnippet: "Resolve Salesforce Lightning and Setup paths before opening the browser",
    promptGuidelines: [
      "Use sf_browser_resolve_path when you want to preview or disambiguate Salesforce navigation before opening the browser.",
      "For fuzzy Setup Destination matches, ask the user to choose when the tool returns candidates instead of guessing.",
    ],
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({
          description:
            "Explicit Salesforce path, for example /lightning/setup/SetupOneHome/home. Do not combine with setup or route.",
        }),
      ),
      setup: Type.Optional(
        Type.String({
          description:
            "Curated Setup Destination or bounded fuzzy Setup Destination text. Do not combine with path or route.",
        }),
      ),
      route: Type.Optional(SalesforceRouteSchema),
    }),
    async execute(_toolCallId, params) {
      const stopTimer = startTimer();
      const result = resolveSalesforcePath(params);
      const duration = stopTimer();
      if (!isResolvedSalesforcePath(result)) {
        const candidates = result.candidates?.map(
          (candidate) =>
            `- ${candidate.destination} (${candidate.confidence.toFixed(2)}): ${candidate.path}`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: okText([
                `Could not resolve Salesforce path: ${result.message}`,
                candidates?.length ? "Candidates:" : undefined,
                candidates?.join("\n"),
                `Duration: ${duration.durationText}`,
              ]),
            },
          ],
          details: { ok: false, ...result, ...duration } as Record<string, unknown>,
        };
      }

      const setupDestination = getSetupDestination(result.destination);
      return {
        content: [
          {
            type: "text" as const,
            text: okText([
              "Resolved Salesforce path.",
              `Path: ${result.path}`,
              `Kind: ${result.kind}`,
              result.destination ? `Destination: ${result.destination}` : undefined,
              setupDestination ? `Use for: ${setupDestination.useFor}` : undefined,
              setupDestination
                ? `Suggested wait: lightning='${setupDestination.suggestedWait.lightning}'`
                : undefined,
              setupDestination?.defaultFocus.length
                ? `Default focus terms: ${setupDestination.defaultFocus.join(", ")}`
                : undefined,
              result.confidence !== undefined
                ? `Confidence: ${result.confidence.toFixed(2)}`
                : undefined,
              `Duration: ${duration.durationText}`,
            ]),
          },
        ],
        details: {
          ok: true,
          ...result,
          ...(setupDestination
            ? {
                setupDestination: {
                  id: setupDestination.id,
                  suggestedWait: setupDestination.suggestedWait,
                  defaultFocus: setupDestination.defaultFocus,
                  runbookRefs: setupDestination.runbookRefs,
                },
              }
            : {}),
          ...duration,
        } as Record<string, unknown>,
      };
    },
  });
}
