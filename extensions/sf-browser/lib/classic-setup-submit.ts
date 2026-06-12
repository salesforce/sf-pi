/* SPDX-License-Identifier: Apache-2.0 */
/** Classic Setup submit handling for mutation clicks. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentBrowserResult } from "./agent-browser.ts";
import { runAgentBrowser } from "./agent-browser.ts";

export interface BrowserDialogStatus {
  hasDialog: boolean;
  type?: string;
  message?: string;
  defaultValue?: string;
}

export interface AcceptedBrowserDialog {
  type?: string;
  message?: string;
}

export interface ClassicSetupSubmitResult {
  result?: AgentBrowserResult;
  acceptedDialogs: AcceptedBrowserDialog[];
}

const DIALOG_POLL_INTERVAL_MS = 500;
const DIALOG_STATUS_TIMEOUT_MS = 2_000;
const DIALOG_ACCEPT_TIMEOUT_MS = 5_000;

export function parseDialogStatus(stdout: string): BrowserDialogStatus | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const data = isRecord(parsed) && isRecord(parsed.data) ? parsed.data : parsed;
  if (!isRecord(data)) return undefined;
  const hasDialog = data.hasDialog === true;
  return {
    hasDialog,
    type: typeof data.type === "string" ? data.type : undefined,
    message: typeof data.message === "string" ? data.message : undefined,
    defaultValue: typeof data.defaultValue === "string" ? data.defaultValue : undefined,
  };
}

export function shouldAutoAcceptDialog(status: BrowserDialogStatus): boolean {
  if (!status.hasDialog) return false;
  const type = status.type?.toLowerCase();
  // Prompt requires caller-provided text. Salesforce setup save confirms should
  // be confirm/beforeunload/alert-like dialogs, so do not auto-answer prompts.
  return type === undefined || type === "confirm" || type === "beforeunload" || type === "alert";
}

export async function runClassicSetupMutationClick(
  pi: ExtensionAPI,
  input: { cwd: string; ref: string; signal?: AbortSignal },
): Promise<ClassicSetupSubmitResult> {
  const acceptedDialogs: AcceptedBrowserDialog[] = [];
  let actionDone = false;
  let actionResult: AgentBrowserResult | undefined;
  let actionError: unknown;

  const actionPromise = runAgentBrowser(pi, ["click", input.ref], {
    cwd: input.cwd,
    signal: input.signal,
  })
    .then((result) => {
      actionResult = result;
    })
    .catch((error) => {
      actionError = error;
    })
    .finally(() => {
      actionDone = true;
    });

  while (!actionDone) {
    if (input.signal?.aborted) break;
    await delay(DIALOG_POLL_INTERVAL_MS, input.signal);
    if (actionDone || input.signal?.aborted) break;
    const status = await getDialogStatus(pi, input.cwd, input.signal);
    if (!status || !shouldAutoAcceptDialog(status)) continue;
    await runAgentBrowser(pi, ["dialog", "accept"], {
      cwd: input.cwd,
      signal: input.signal,
      timeoutMs: DIALOG_ACCEPT_TIMEOUT_MS,
    });
    acceptedDialogs.push({ type: status.type, message: status.message });
  }

  await actionPromise;
  if (actionError) throw actionError;
  return { result: actionResult, acceptedDialogs };
}

async function getDialogStatus(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<BrowserDialogStatus | undefined> {
  try {
    const result = await runAgentBrowser(pi, ["dialog", "status", "--json"], {
      cwd,
      signal,
      timeoutMs: DIALOG_STATUS_TIMEOUT_MS,
    });
    return parseDialogStatus(result.stdout);
  } catch {
    return undefined;
  }
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
