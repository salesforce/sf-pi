/* SPDX-License-Identifier: Apache-2.0 */
/** Browser Evidence capture tool for SF Browser. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { captureEvidence } from "./operations.ts";
import { readEffectiveSfBrowserSettings } from "./settings.ts";

export const SF_BROWSER_CAPTURE_EVIDENCE_TOOL_NAME = "sf_browser_capture_evidence";

const EvidenceMode = StringEnum(["artifact", "thumbnail", "full"] as const, {
  description:
    "artifact stores only a file reference, thumbnail returns a bounded image result, full returns the full screenshot when small enough. Defaults to thumbnail.",
});

export function registerSfBrowserCaptureEvidenceTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_CAPTURE_EVIDENCE_TOOL_NAME,
    label: "SF Browser Capture Evidence",
    description:
      "Capture session-scoped Browser Evidence from agent-browser. Stores a full private screenshot artifact, optionally dismisses known ambient Salesforce overlays, can enrich with recent Setup Audit Trail context, and optionally returns a bounded image for model vision. Use artifact mode for batches.",
    promptSnippet:
      "Capture private Salesforce browser screenshots with optional bounded model-visible images",
    promptGuidelines: [
      "Use sf_browser_capture_evidence with imageMode=thumbnail when the model should inspect the current screen; use imageMode=artifact for repeated or batch captures.",
    ],
    parameters: Type.Object({
      label: Type.Optional(
        Type.String({ description: "Short public-safe label for the evidence file." }),
      ),
      imageMode: Type.Optional(EvidenceMode),
      dismissOverlays: Type.Optional(
        Type.Boolean({
          description:
            "Best-effort dismissal of known non-workflow Salesforce overlays before capture. Defaults to true.",
        }),
      ),
      scrollToRef: Type.Optional(
        Type.String({
          description:
            "Optional ref to scroll into view before capturing evidence, useful for lower-page sections.",
        }),
      ),
      target_org: Type.Optional(
        Type.String({
          description:
            "Salesforce org alias or username for optional Setup Audit Trail enrichment. Defaults to active sf-pi target org.",
        }),
      ),
      includeSetupAuditTrail: Type.Optional(
        Type.Boolean({
          description:
            "When true, enrich the evidence capture with a best-effort, bounded recent Setup Audit Trail query. Defaults to false.",
        }),
      ),
      auditLookbackMinutes: Type.Optional(
        Type.Number({
          description:
            "Recent Setup Audit Trail lookback window in minutes. Defaults to 5 and is capped at 60.",
        }),
      ),
      viewportWidth: Type.Optional(
        Type.Number({
          description:
            "Optional screenshot viewport width. Thumbnail mode defaults to 1440 for fuller visual evidence.",
        }),
      ),
      viewportHeight: Type.Optional(
        Type.Number({
          description:
            "Optional screenshot viewport height. Thumbnail mode defaults to 1000 for fuller visual evidence.",
        }),
      ),
      deviceScaleFactor: Type.Optional(
        Type.Number({
          description:
            "Optional device scale factor for evidence screenshots. Defaults to the browser's current scale and is capped at 3.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const settings = readEffectiveSfBrowserSettings(ctx.cwd);
      return captureEvidence(
        pi,
        ctx,
        {
          imageMode: settings.evidenceImageMode,
          dismissOverlays: settings.dismissOverlays,
          includeSetupAuditTrail: settings.includeSetupAuditTrail,
          ...(params as Record<string, unknown>),
        },
        signal,
      );
    },
  });
}
