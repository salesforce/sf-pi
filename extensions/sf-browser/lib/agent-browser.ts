/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Thin process boundary around agent-browser.
 *
 * SF Browser keeps browser semantics in agent-browser. This module only adds
 * the single default SF Browser session, output redaction, and actionable
 * install/launch errors.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BROWSER_LAUNCH_RECOVERY, isBrowserLaunchFailure } from "./browser-launch-diagnostics.ts";
import {
  DEFAULT_AGENT_BROWSER_TIMEOUT_MS,
  INSTALL_GUIDANCE,
  SF_BROWSER_SESSION,
} from "./constants.ts";
import { redactText } from "./redaction.ts";
import { startTimer } from "./timing.ts";

export interface RunAgentBrowserOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  extraGlobalArgs?: string[];
}

export interface AgentBrowserResult {
  stdout: string;
  stderr: string;
  code: number;
  durationMs: number;
  durationText: string;
}

export async function runAgentBrowser(
  pi: ExtensionAPI,
  args: string[],
  options: RunAgentBrowserOptions,
): Promise<AgentBrowserResult> {
  const stopTimer = startTimer();
  let result: Awaited<ReturnType<ExtensionAPI["exec"]>>;
  try {
    result = await pi.exec(
      "agent-browser",
      [
        "--session",
        SF_BROWSER_SESSION,
        "--session-name",
        SF_BROWSER_SESSION,
        ...(options.extraGlobalArgs ?? []),
        ...args,
      ],
      {
        cwd: options.cwd,
        signal: options.signal,
        timeout: options.timeoutMs ?? DEFAULT_AGENT_BROWSER_TIMEOUT_MS,
      },
    );
  } catch (error) {
    throw new Error(formatAgentBrowserError("", errorMessage(error), -1), { cause: error });
  }

  const duration = stopTimer();
  const stdout = redactText(result.stdout ?? "");
  const stderr = redactText(result.stderr ?? "");
  if (result.code !== 0) {
    throw new Error(formatAgentBrowserError(stdout, stderr, result.code));
  }
  return { stdout, stderr, code: result.code, ...duration };
}

export async function checkAgentBrowser(pi: ExtensionAPI, cwd: string): Promise<string> {
  let result: Awaited<ReturnType<ExtensionAPI["exec"]>>;
  try {
    result = await pi.exec("agent-browser", ["--version"], {
      cwd,
      timeout: 15_000,
    });
  } catch (error) {
    return ["agent-browser: missing or not ready", errorMessage(error), "", INSTALL_GUIDANCE]
      .filter(Boolean)
      .join("\n");
  }
  if (result.code !== 0) {
    const details = redactText([result.stderr, result.stdout].filter(Boolean).join("\n").trim());
    return [`agent-browser: missing or not ready`, details, "", INSTALL_GUIDANCE]
      .filter(Boolean)
      .join("\n");
  }
  return `agent-browser: ${redactText(result.stdout.trim() || "installed")}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatAgentBrowserError(stdout: string, stderr: string, code: number): string {
  const body = [stderr, stdout].filter(Boolean).join("\n").trim();
  const missing = /not found|ENOENT|command not found|spawn agent-browser/i.test(body);
  if (missing || !body) {
    return [`agent-browser failed with code ${code}.`, "", INSTALL_GUIDANCE].join("\n");
  }
  if (isBrowserLaunchFailure(body)) {
    return [
      `agent-browser failed with code ${code}.`,
      body,
      "",
      `Recovery: ${BROWSER_LAUNCH_RECOVERY}`,
    ].join("\n");
  }
  return `agent-browser failed with code ${code}.\n${body}`;
}
