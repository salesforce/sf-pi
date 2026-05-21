/* SPDX-License-Identifier: Apache-2.0 */
/** Wait tool for Salesforce async UI rendering. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { DEFAULT_AGENT_BROWSER_TIMEOUT_MS } from "./constants.ts";
import { runAgentBrowser } from "./agent-browser.ts";
import { throwWithFailureDiagnostics } from "./failure-diagnostics.ts";
import { STALE_REF_HINT } from "./guidance.ts";
import {
  buildLightningOutcomeExpression,
  buildLightningWaitExpression,
  type LightningOutcomeDetails,
  type LightningWaitModeValue,
} from "./lightning-wait.ts";
import { startTimer } from "./timing.ts";
import { okText } from "./tool-support.ts";

export const SF_BROWSER_WAIT_TOOL_NAME = "sf_browser_wait";

const LoadState = StringEnum(["domcontentloaded", "networkidle"] as const, {
  description: "Load state to wait for.",
});

const LightningWaitMode = StringEnum(
  [
    "app-ready",
    "record-view",
    "modal-open",
    "modal-closed",
    "toast",
    "spinner-gone",
    "save-result",
  ] as const,
  {
    description:
      "Salesforce Lightning semantic state to wait for. save-result classifies the first visible post-save outcome; it is not a success assertion.",
  },
);

export type { LightningWaitModeValue, LightningWaitOutcome } from "./lightning-wait.ts";

export interface WaitClassification {
  ambiguous: boolean;
  label: string;
  note?: string;
}

export function classifyWait(durationMs: number, params: { ms?: number }): WaitClassification {
  if (typeof params.ms === "number") {
    return { ambiguous: false, label: "Wait finished" };
  }
  if (durationMs >= DEFAULT_AGENT_BROWSER_TIMEOUT_MS * 0.9) {
    return {
      ambiguous: true,
      label: "Wait may have timed out",
      note: "No hard error was returned, but the wait reached the timeout window. Snapshot or verify through API before continuing.",
    };
  }
  return { ambiguous: false, label: "Wait finished" };
}

export function registerSfBrowserWaitTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_WAIT_TOOL_NAME,
    label: "SF Browser Wait",
    description:
      "Wait for Salesforce UI progress using expected text, URL pattern, load state, Lightning semantic state, or a last-resort millisecond delay. Prefer text, URL, or Lightning waits over fixed sleeps; long waits are reported as ambiguous when they reach the timeout window.",
    promptSnippet: "Wait for Salesforce UI text, URL, load state, Lightning state, or delay",
    promptGuidelines: [
      "Use sf_browser_wait with expected text, URL, or lightning state after Salesforce actions; use ms only as a last resort for Lightning async rendering.",
      "Use lightning='save-result' after Save to classify success, validation, error, or ambiguous post-save outcomes; it is not a success assertion.",
      "If sf_browser_wait says the wait may have timed out, snapshot or verify through API before continuing.",
    ],
    parameters: Type.Object({
      text: Type.Optional(
        Type.String({ description: "Visible text to wait for, such as Saved or Success." }),
      ),
      url: Type.Optional(
        Type.String({ description: "URL glob to wait for, such as **/lightning/setup/**." }),
      ),
      load: Type.Optional(LoadState),
      lightning: Type.Optional(LightningWaitMode),
      ms: Type.Optional(Type.Number({ description: "Milliseconds to wait. Last resort only." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const modeCount = [params.text, params.url, params.load, params.lightning, params.ms].filter(
        (value) => value !== undefined && value !== "",
      ).length;
      if (modeCount !== 1) {
        throw new Error(
          "sf_browser_wait expects exactly one of text, url, load, lightning, or ms.",
        );
      }

      const stopTimer = startTimer();
      const args = buildWaitArgs(params);
      try {
        await runAgentBrowser(pi, args, { cwd: ctx.cwd, signal });
      } catch (error) {
        const duration = stopTimer();
        await throwWithFailureDiagnostics(
          pi,
          ctx,
          {
            toolName: SF_BROWSER_WAIT_TOOL_NAME,
            action: `wait for ${describeWait(params)}`,
            durationMs: duration.durationMs,
          },
          error,
          signal,
        );
      }
      const duration = stopTimer();
      const lightningDetails = params.lightning
        ? await getLightningOutcome(pi, ctx.cwd, params.lightning, signal)
        : undefined;
      const classification = classifyWait(duration.durationMs, params);
      const outcome = lightningDetails?.outcome;
      const ambiguous = classification.ambiguous || outcome === "ambiguous";
      return {
        content: [
          {
            type: "text" as const,
            text: okText([
              `${classification.label}: ${describeWait(params)}.`,
              outcome ? `Outcome: ${outcome}.` : undefined,
              lightningDetails?.matched?.text
                ? `Matched text: ${lightningDetails.matched.text}`
                : undefined,
              lightningDetails?.matched?.url
                ? `Matched URL: ${lightningDetails.matched.url}`
                : undefined,
              `Duration: ${duration.durationText}`,
              classification.note,
              "Prefer expected text, URL, or Lightning waits over fixed sleeps for Salesforce Lightning pages.",
              STALE_REF_HINT,
            ]),
          },
        ],
        details: {
          ok: true,
          ambiguous,
          wait: params,
          ...(lightningDetails
            ? { outcome: lightningDetails.outcome, matched: lightningDetails.matched }
            : {}),
          ...duration,
        },
      };
    },
  });
}

export function buildWaitArgs(params: {
  text?: string;
  url?: string;
  load?: string;
  lightning?: LightningWaitModeValue;
  ms?: number;
}): string[] {
  if (params.text) return ["wait", "--text", params.text];
  if (params.url) return ["wait", "--url", params.url];
  if (params.load) return ["wait", "--load", params.load];
  if (params.lightning) return ["wait", "--fn", buildLightningWaitExpression(params.lightning)];
  return ["wait", String(Math.max(0, Math.floor(params.ms ?? 0)))];
}

function describeWait(params: {
  text?: string;
  url?: string;
  load?: string;
  lightning?: LightningWaitModeValue;
  ms?: number;
}): string {
  if (params.text) return `text ${JSON.stringify(params.text)}`;
  if (params.url) return `url ${JSON.stringify(params.url)}`;
  if (params.load) return `load ${params.load}`;
  if (params.lightning) return `lightning ${params.lightning}`;
  return `${Math.max(0, Math.floor(params.ms ?? 0))}ms`;
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
