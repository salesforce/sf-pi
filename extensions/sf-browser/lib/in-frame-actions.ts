/* SPDX-License-Identifier: Apache-2.0 */
/** Internal iframe-context recovery for covered SF Browser ref actions. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runAgentBrowser } from "./agent-browser.ts";
import { classifyBrowserFailure } from "./failure-diagnostics.ts";
import { redactText } from "./redaction.ts";

export interface InFrameRetryPlan {
  iframeRef: string;
  targetRef: string;
}

export type InFrameRetryResult =
  | { ok: true; iframeRef: string }
  | { ok: false; reason: "not-covered-element" | "no-frame-plan" | "retry-failed"; error?: string };

export function findInFrameRetryPlan(
  snapshot: string,
  targetRef: string | undefined,
): InFrameRetryPlan | undefined {
  const normalizedTarget = normalizeRef(targetRef);
  if (!normalizedTarget) return undefined;

  const frameStack: Array<{ indent: number; ref: string }> = [];
  for (const line of snapshot.split(/\r?\n/)) {
    const indent = leadingSpaces(line);
    let currentFrame = frameStack.at(-1);
    while (currentFrame && currentFrame.indent >= indent) {
      frameStack.pop();
      currentFrame = frameStack.at(-1);
    }

    const lineRef = extractRef(line);
    if (lineRef === normalizedTarget) {
      const frame = frameStack.at(-1);
      return frame ? { iframeRef: `@${frame.ref}`, targetRef: `@${normalizedTarget}` } : undefined;
    }

    if (lineRef && isIframeLine(line)) {
      frameStack.push({ indent, ref: lineRef });
    }
  }
  return undefined;
}

export async function retryInFrameAction(
  pi: ExtensionAPI,
  input: {
    cwd: string;
    targetRef?: string;
    actionArgs: string[];
    error: unknown;
    signal?: AbortSignal;
  },
): Promise<InFrameRetryResult> {
  const originalError = input.error instanceof Error ? input.error.message : String(input.error);
  if (classifyBrowserFailure(originalError) !== "covered-element") {
    return { ok: false, reason: "not-covered-element" };
  }

  let snapshot: string;
  try {
    const result = await runAgentBrowser(pi, ["snapshot", "-i", "-c"], {
      cwd: input.cwd,
      signal: input.signal,
      timeoutMs: 15_000,
    });
    snapshot = result.stdout.trim();
  } catch (error) {
    return { ok: false, reason: "no-frame-plan", error: redactError(error) };
  }

  const plan = findInFrameRetryPlan(snapshot, input.targetRef);
  if (!plan) return { ok: false, reason: "no-frame-plan" };

  try {
    await runAgentBrowser(pi, ["frame", plan.iframeRef], {
      cwd: input.cwd,
      signal: input.signal,
      timeoutMs: 15_000,
    });
    try {
      await runAgentBrowser(pi, input.actionArgs, { cwd: input.cwd, signal: input.signal });
    } finally {
      await runAgentBrowser(pi, ["frame", "main"], {
        cwd: input.cwd,
        signal: input.signal,
        timeoutMs: 15_000,
      });
    }
    return { ok: true, iframeRef: plan.iframeRef };
  } catch (error) {
    return { ok: false, reason: "retry-failed", error: redactError(error) };
  }
}

function leadingSpaces(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function extractRef(line: string): string | undefined {
  return line.match(/\bref=(e\d+)\b/)?.[1];
}

function isIframeLine(line: string): boolean {
  return /\bIframe\b/i.test(line);
}

function normalizeRef(ref: string | undefined): string | undefined {
  const trimmed = ref?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^@/, "");
}

function redactError(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error));
}
