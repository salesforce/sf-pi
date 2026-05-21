/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Best-effort diagnostics for failed SF Browser actions.
 *
 * Diagnostics must never mask the original browser failure. They capture enough
 * session-scoped context for the next agent turn to recover without dumping
 * screenshots or raw accessibility trees into the transcript.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { commitEvidenceCapture, planEvidenceCapture } from "./artifacts.ts";
import { runAgentBrowser } from "./agent-browser.ts";
import { redactText, sanitizeLabel } from "./redaction.ts";
import { formatDuration } from "./timing.ts";
import { okText, writeBrowserArtifact } from "./tool-support.ts";

export type BrowserFailureKind =
  | "stale-ref"
  | "element-not-found"
  | "timeout"
  | "navigation"
  | "agent-browser-missing"
  | "unknown";

export interface BrowserFailureDiagnosticsInput {
  toolName: string;
  action: string;
  ref?: string;
  durationMs?: number;
}

export interface BrowserFailureDiagnostics {
  kind: BrowserFailureKind;
  recovery: string;
  originalError: string;
  currentUrl?: string;
  snapshotPath?: string;
  screenshotPath?: string;
  diagnosticsError?: string;
}

export function classifyBrowserFailure(message: string): BrowserFailureKind {
  if (/ENOENT|command not found|spawn agent-browser|agent-browser.*missing/i.test(message)) {
    return "agent-browser-missing";
  }
  if (/ref(?:erence)? not found|element not found:\s*@e\d+|unknown ref|stale/i.test(message)) {
    return "stale-ref";
  }
  if (/element not found|no element|not visible|not attached|detached/i.test(message)) {
    return "element-not-found";
  }
  if (/timeout|timed out|deadline|exceeded/i.test(message)) return "timeout";
  if (
    /navigation|net::|frame was detached|execution context was destroyed|target closed/i.test(
      message,
    )
  ) {
    return "navigation";
  }
  return "unknown";
}

export function recoveryHint(kind: BrowserFailureKind): string {
  switch (kind) {
    case "stale-ref":
      return "The page likely rerendered and invalidated the ref. Run sf_browser_snapshot and retry with a fresh ref.";
    case "element-not-found":
      return "The target element was not found or was not interactable. Snapshot with focus terms, check overlays/modals, then retry with a visible ref.";
    case "timeout":
      return "The browser action or wait timed out. Snapshot the current state and verify through API when possible before retrying.";
    case "navigation":
      return "The page navigated or the frame changed during the action. Wait for a URL/text/Lightning state, then snapshot before the next action.";
    case "agent-browser-missing":
      return "agent-browser is missing or unavailable. Run /sf-browser doctor for install and runtime guidance.";
    default:
      return "Capture a fresh snapshot, inspect the current page state, and retry only with current refs.";
  }
}

export async function buildFailureDiagnostics(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: BrowserFailureDiagnosticsInput,
  error: unknown,
  signal?: AbortSignal,
): Promise<BrowserFailureDiagnostics> {
  const originalError = redactText(error instanceof Error ? error.message : String(error));
  const kind = classifyBrowserFailure(originalError);
  const diagnostics: BrowserFailureDiagnostics = {
    kind,
    recovery: recoveryHint(kind),
    originalError,
  };

  try {
    diagnostics.currentUrl = await safeCurrentUrl(pi, ctx.cwd, signal);
    diagnostics.snapshotPath = await safeSnapshotArtifact(pi, ctx, input, signal);
    diagnostics.screenshotPath = await safeScreenshotArtifact(
      pi,
      ctx,
      input,
      diagnostics.currentUrl,
      signal,
    );
  } catch (diagnosticsError) {
    diagnostics.diagnosticsError = redactText(
      diagnosticsError instanceof Error ? diagnosticsError.message : String(diagnosticsError),
    );
  }

  return diagnostics;
}

export function formatBrowserFailure(
  input: BrowserFailureDiagnosticsInput,
  diagnostics: BrowserFailureDiagnostics,
): string {
  return okText([
    `SF Browser action failed: ${diagnostics.kind}.`,
    `Tool: ${input.toolName}`,
    `Attempted: ${input.action}`,
    input.durationMs !== undefined
      ? `Duration before failure: ${formatDuration(input.durationMs)}`
      : undefined,
    `Recovery: ${diagnostics.recovery}`,
    diagnostics.currentUrl ? `URL: ${diagnostics.currentUrl}` : undefined,
    diagnostics.snapshotPath ? `Diagnostic snapshot: ${diagnostics.snapshotPath}` : undefined,
    diagnostics.screenshotPath ? `Diagnostic screenshot: ${diagnostics.screenshotPath}` : undefined,
    diagnostics.diagnosticsError
      ? `Diagnostic capture issue: ${diagnostics.diagnosticsError}`
      : undefined,
    "",
    diagnostics.originalError,
  ]);
}

export async function throwWithFailureDiagnostics(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: BrowserFailureDiagnosticsInput,
  error: unknown,
  signal?: AbortSignal,
): Promise<never> {
  const diagnostics = await buildFailureDiagnostics(pi, ctx, input, error, signal);
  throw new Error(formatBrowserFailure(input, diagnostics), { cause: error });
}

function diagnosticLabel(input: BrowserFailureDiagnosticsInput, suffix: string): string {
  return sanitizeLabel(
    ["failure", input.toolName.replace(/^sf_browser_/, ""), input.ref, suffix]
      .filter(Boolean)
      .join("-"),
    "failure",
  );
}

async function safeCurrentUrl(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const result = await runAgentBrowser(pi, ["get", "url"], { cwd, signal, timeoutMs: 10_000 });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function safeSnapshotArtifact(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: BrowserFailureDiagnosticsInput,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const result = await runAgentBrowser(pi, ["snapshot", "-i", "-c"], {
      cwd: ctx.cwd,
      signal,
      timeoutMs: 15_000,
    });
    return writeBrowserArtifact(result.stdout.trim(), {
      label: diagnosticLabel(input, "snapshot"),
      extension: "txt",
      sessionId: ctx.sessionManager.getSessionId(),
    });
  } catch {
    return undefined;
  }
}

async function safeScreenshotArtifact(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: BrowserFailureDiagnosticsInput,
  currentUrl: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  const sessionId = ctx.sessionManager.getSessionId();
  const planned = planEvidenceCapture(diagnosticLabel(input, "screenshot"), sessionId);
  try {
    await runAgentBrowser(pi, ["screenshot", planned.path], {
      cwd: ctx.cwd,
      signal,
      timeoutMs: 15_000,
    });
    commitEvidenceCapture(
      {
        id: planned.id,
        label: planned.label,
        path: planned.path,
        createdAt: new Date().toISOString(),
        imageMode: "artifact",
        includedImage: false,
        url: currentUrl,
      },
      sessionId,
    );
    return planned.path;
  } catch {
    return undefined;
  }
}
