/* SPDX-License-Identifier: Apache-2.0 */
/** Wait tool for Salesforce async UI rendering. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { DEFAULT_AGENT_BROWSER_TIMEOUT_MS } from "./constants.ts";
import { runAgentBrowser } from "./agent-browser.ts";
import { renderBrowserToolCall, renderBrowserToolResult } from "./browser-render.ts";
import { checkpointEvidenceLabel } from "./evidence-policy.ts";
import {
  defaultCheckpointEvidenceTarget,
  prepareCheckpointEvidenceTarget,
  type CheckpointEvidenceTarget,
} from "./evidence-target.ts";
import { throwWithFailureDiagnostics } from "./failure-diagnostics.ts";
import { STALE_REF_HINT } from "./guidance.ts";
import {
  buildLightningOutcomeExpression,
  buildLightningWaitExpression,
  type LightningOutcomeDetails,
  type LightningWaitModeValue,
  type LightningWaitOutcome,
} from "./lightning-wait.ts";
import { captureVisualCheckpoint } from "./operations.ts";
import { startTimer } from "./timing.ts";
import { okText } from "./tool-support.ts";

export const SF_BROWSER_WAIT_TOOL_NAME = "sf_browser_wait";

const LoadState = StringEnum(["domcontentloaded", "networkidle"] as const, {
  description: "Browser load state to wait for.",
});

const CheckpointEvidenceTargetMode = StringEnum(["current", "record-details"] as const, {
  description:
    "Where automatic checkpoint evidence should focus. record-details clicks the Details tab on record pages before capturing evidence.",
});

const LightningWaitMode = StringEnum(
  [
    "app-ready",
    "navigation-ready",
    "record-view",
    "modal-open",
    "modal-closed",
    "toast",
    "spinner-gone",
    "save-result",
  ] as const,
  {
    description:
      "Salesforce Lightning semantic state. save-result classifies the first visible post-save outcome and is not by itself a success assertion.",
  },
);

const WaitConditionSchema = Type.Union([
  Type.Object({
    type: Type.Literal("text"),
    value: Type.String({ description: "Visible text, such as Saved or Success." }),
  }),
  Type.Object({
    type: Type.Literal("url"),
    value: Type.String({ description: "URL glob, such as **/lightning/setup/**." }),
  }),
  Type.Object({ type: Type.Literal("load"), value: LoadState }),
  Type.Object({ type: Type.Literal("lightning"), value: LightningWaitMode }),
  Type.Object({
    type: Type.Literal("delay"),
    value: Type.Number({ minimum: 0, description: "Milliseconds to wait. Last resort only." }),
  }),
]);

export type WaitCondition =
  | { type: "text"; value: string }
  | { type: "url"; value: string }
  | { type: "load"; value: "domcontentloaded" | "networkidle" }
  | { type: "lightning"; value: LightningWaitModeValue }
  | { type: "delay"; value: number };

export type WaitStatus = "matched" | "ambiguous" | "timed_out";
export type { LightningWaitModeValue, LightningWaitOutcome } from "./lightning-wait.ts";

export interface WaitClassification {
  ambiguous: boolean;
  label: string;
  note?: string;
}

export function classifyWait(durationMs: number, condition: WaitCondition): WaitClassification {
  if (condition.type === "delay") return { ambiguous: false, label: "Wait finished" };
  if (durationMs >= DEFAULT_AGENT_BROWSER_TIMEOUT_MS * 0.9) {
    return {
      ambiguous: true,
      label: "Wait timed out",
      note: "The conditional wait reached the timeout window without reliable completion evidence. Snapshot or verify through API before continuing.",
    };
  }
  return { ambiguous: false, label: "Wait finished" };
}

export function classifyWaitStatus(
  classification: WaitClassification,
  outcome?: LightningWaitOutcome,
): WaitStatus {
  if (classification.ambiguous) return "timed_out";
  if (outcome === "ambiguous") return "ambiguous";
  return "matched";
}

export function registerSfBrowserWaitTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_WAIT_TOOL_NAME,
    label: "SF Browser Wait",
    description:
      "Wait for one Salesforce UI condition: expected text, URL pattern, load state, Lightning semantic state, or a last-resort delay. Conditional timeouts fail closed instead of reporting success.",
    promptSnippet: "Wait for one discriminated Salesforce browser condition",
    promptGuidelines: [
      "Pass exactly one condition object. Prefer text, URL, or Lightning conditions over a fixed delay.",
      "save-result classifies an outcome and is never itself a success assertion.",
      "After ambiguous or timed-out waits, snapshot or verify through API; use the installed Browser guide path declared in <sf_engineering_constitution> for the full interaction loop.",
    ],
    renderCall: (args, theme) => renderBrowserToolCall(SF_BROWSER_WAIT_TOOL_NAME, args, theme),
    renderResult: (result, options, theme, context) =>
      renderBrowserToolResult(SF_BROWSER_WAIT_TOOL_NAME, result, options, theme, context),
    parameters: Type.Object({
      condition: WaitConditionSchema,
      checkpointEvidence: Type.Optional(
        Type.Boolean({
          description:
            "Override automatic Browser Evidence checkpoint capture. Defaults to true for navigation-ready, record-view, and save-result Lightning waits; false for other waits.",
        }),
      ),
      checkpointEvidenceTarget: Type.Optional(CheckpointEvidenceTargetMode),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const condition = params.condition as WaitCondition;
      const stopTimer = startTimer();
      try {
        await runAgentBrowser(pi, buildWaitArgs(condition), { cwd: ctx.cwd, signal });
      } catch (error) {
        const duration = stopTimer();
        await throwWithFailureDiagnostics(
          pi,
          ctx,
          {
            toolName: SF_BROWSER_WAIT_TOOL_NAME,
            action: `wait for ${describeWait(condition)}`,
            durationMs: duration.durationMs,
          },
          error,
          signal,
        );
      }
      const duration = stopTimer();
      const lightningMode = condition.type === "lightning" ? condition.value : undefined;
      const lightningDetails = lightningMode
        ? await getLightningOutcome(pi, ctx.cwd, lightningMode, signal)
        : undefined;
      const classification = classifyWait(duration.durationMs, condition);
      const outcome = lightningDetails?.outcome;
      const status = classifyWaitStatus(classification, outcome);
      const content = [
        {
          type: "text" as const,
          text: okText([
            `${classification.label}: ${describeWait(condition)}.`,
            `Status: ${status}.`,
            outcome ? `Outcome: ${outcome}.` : undefined,
            lightningDetails?.matched?.text
              ? `Matched text: ${lightningDetails.matched.text}`
              : undefined,
            lightningDetails?.matched?.url
              ? `Matched URL: ${lightningDetails.matched.url}`
              : undefined,
            `Duration: ${duration.durationText}`,
            classification.note,
            status === "ambiguous"
              ? "The semantic outcome is ambiguous. Snapshot or verify through API before continuing."
              : undefined,
            "Prefer expected text, URL, or Lightning waits over fixed delays for Salesforce Lightning pages.",
            STALE_REF_HINT,
          ]),
        },
      ];
      const checkpointLabel = checkpointEvidenceLabel({
        lightning: lightningMode,
        checkpointEvidence: params.checkpointEvidence,
      });
      const checkpointTarget = checkpointLabel
        ? ((params.checkpointEvidenceTarget as CheckpointEvidenceTarget | undefined) ??
          defaultCheckpointEvidenceTarget(lightningMode))
        : undefined;
      const checkpointTargetResult = checkpointTarget
        ? await prepareCheckpointEvidenceTarget(pi, {
            cwd: ctx.cwd,
            target: checkpointTarget,
            signal,
          })
        : undefined;
      const checkpoint = checkpointLabel
        ? await captureVisualCheckpoint(
            pi,
            ctx,
            {
              label: checkpointLabel,
              imageMode: "thumbnail",
              stepId: toolCallId,
              phase: "checkpoint",
              toolName: SF_BROWSER_WAIT_TOOL_NAME,
            },
            signal,
          )
        : undefined;
      return {
        content: checkpoint ? [...content, ...checkpoint.content] : content,
        details: {
          ok: status === "matched",
          status,
          ambiguous: status !== "matched",
          condition,
          checkpointEvidence: checkpoint?.details.capture,
          checkpointEvidenceTarget: checkpointTargetResult,
          ...(lightningDetails
            ? { outcome: lightningDetails.outcome, matched: lightningDetails.matched }
            : {}),
          ...duration,
        },
        ...(status === "timed_out" ? { isError: true } : {}),
      };
    },
  });
}

export function buildWaitArgs(condition: WaitCondition): string[] {
  switch (condition.type) {
    case "text":
      return ["wait", "--text", condition.value];
    case "url":
      return ["wait", "--url", condition.value];
    case "load":
      return ["wait", "--load", condition.value];
    case "lightning":
      return ["wait", "--fn", buildLightningWaitExpression(condition.value)];
    case "delay":
      return ["wait", String(Math.max(0, Math.floor(condition.value)))];
  }
}

function describeWait(condition: WaitCondition): string {
  switch (condition.type) {
    case "text":
      return `text ${JSON.stringify(condition.value)}`;
    case "url":
      return `url ${JSON.stringify(condition.value)}`;
    case "load":
      return `load ${condition.value}`;
    case "lightning":
      return `lightning ${condition.value}`;
    case "delay":
      return `${Math.max(0, Math.floor(condition.value))}ms`;
  }
}

async function getLightningOutcome(
  pi: ExtensionAPI,
  cwd: string,
  mode: LightningWaitModeValue,
  signal: AbortSignal | undefined,
): Promise<LightningOutcomeDetails> {
  try {
    const result = await runAgentBrowser(pi, ["eval", buildLightningOutcomeExpression(mode)], {
      cwd,
      signal,
      timeoutMs: 15_000,
    });
    return JSON.parse(result.stdout.trim()) as LightningOutcomeDetails;
  } catch {
    return { outcome: "ambiguous" };
  }
}
