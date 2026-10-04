/* SPDX-License-Identifier: Apache-2.0 */
/** Internal iframe-context recovery for covered SF Browser ref actions. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runAgentBrowser } from "./agent-browser.ts";
import { classifyBrowserFailure } from "./failure-diagnostics.ts";
import { redactText } from "./redaction.ts";

const rememberedFrameUrls = new Map<string, Map<string, string>>();
const MAX_REMEMBERED_FRAME_SESSIONS = 25;

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

export async function expandMissingIframeSnapshots(
  pi: ExtensionAPI,
  input: {
    cwd: string;
    snapshot: string;
    sessionId?: string;
    currentUrl?: string;
    maxFrames?: number;
  },
  signal: AbortSignal | undefined,
): Promise<{ snapshot: string; expandedFrameRefs: string[] }> {
  const lines = input.snapshot.split(/\r?\n/u);
  const expandedFrameRefs: string[] = [];
  const output: string[] = [];
  const maxFrames = Math.max(1, Math.min(3, input.maxFrames ?? 2));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    output.push(line);
    const ref = extractRef(line);
    if (!ref || !isIframeLine(line)) continue;

    if (input.sessionId) {
      try {
        const frameUrl = await runAgentBrowser(pi, ["get", "attr", `@${ref}`, "src"], {
          cwd: input.cwd,
          signal,
          timeoutMs: 10_000,
        });
        rememberFrameUrl(input.sessionId, ref, frameUrl.stdout.trim());
      } catch {
        // The scoped snapshot remains useful even when the iframe URL is unavailable.
      }
    }

    const next = lines[index + 1];
    const alreadyExpanded = next !== undefined && leadingSpaces(next) > leadingSpaces(line);
    if (alreadyExpanded || expandedFrameRefs.length >= maxFrames) continue;

    let childSnapshot = "";
    try {
      await runAgentBrowser(pi, ["frame", `@${ref}`], {
        cwd: input.cwd,
        signal,
        timeoutMs: 15_000,
      });
      if (input.sessionId && !readRememberedFrameUrl(input.sessionId, ref)) {
        try {
          const scopedUrl = await runAgentBrowser(pi, ["get", "url"], {
            cwd: input.cwd,
            signal,
            timeoutMs: 10_000,
          });
          if (scopedUrl.stdout.trim() !== input.currentUrl) {
            rememberFrameUrl(input.sessionId, ref, scopedUrl.stdout.trim());
          }
        } catch {
          // Frame snapshots remain useful when the scoped URL is unavailable.
        }
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const child = await runAgentBrowser(pi, ["snapshot", "-i", "-c"], {
          cwd: input.cwd,
          signal,
          timeoutMs: 15_000,
        });
        childSnapshot = child.stdout.trim();
        if (/\bref=e\d+\b/u.test(childSnapshot)) break;
        if (attempt < 3) {
          await runAgentBrowser(pi, ["wait", "250"], {
            cwd: input.cwd,
            signal,
            timeoutMs: 5_000,
          });
        }
      }
    } catch {
      childSnapshot = "";
    } finally {
      try {
        await runAgentBrowser(pi, ["frame", "main"], {
          cwd: input.cwd,
          signal,
          timeoutMs: 15_000,
        });
      } catch {
        // Best effort: the next browser command will fail closed if main context was not restored.
      }
    }

    if (!/\bref=e\d+\b/u.test(childSnapshot) || childSnapshot === input.snapshot.trim()) continue;
    output.push(...childSnapshot.split(/\r?\n/u).map((childLine) => `  ${childLine}`));
    expandedFrameRefs.push(ref);
  }

  return { snapshot: output.join("\n"), expandedFrameRefs };
}

export function readRememberedFrameUrl(
  sessionId: string | undefined,
  frameRef: string | undefined,
): string | undefined {
  if (!sessionId || !frameRef) return undefined;
  return rememberedFrameUrls.get(sessionId)?.get(normalizeRef(frameRef) ?? "");
}

function rememberFrameUrl(sessionId: string, frameRef: string, frameUrl: string): void {
  if (!/^https:\/\//iu.test(frameUrl)) return;
  let urls = rememberedFrameUrls.get(sessionId);
  if (!urls) {
    urls = new Map<string, string>();
    rememberedFrameUrls.set(sessionId, urls);
    while (rememberedFrameUrls.size > MAX_REMEMBERED_FRAME_SESSIONS) {
      const oldest = rememberedFrameUrls.keys().next().value as string | undefined;
      if (!oldest) break;
      rememberedFrameUrls.delete(oldest);
    }
  }
  urls.set(normalizeRef(frameRef) ?? frameRef, frameUrl);
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
