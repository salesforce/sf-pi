/* SPDX-License-Identifier: Apache-2.0 */
/** Compact error mapping for the SF LWC lifecycle tool. */

import { buildDigest, row, section } from "./digest.ts";
import { toolResultFromDigest } from "./result.ts";
import type { SfLwcParams, ToolResult } from "./types.ts";

export type LwcErrorCode =
  | "NOT_SFDX_PROJECT"
  | "NOT_FOUND"
  | "AMBIGUOUS_TARGET"
  | "DIAGNOSTIC_ERROR"
  | "TEST_RUNNER_MISSING"
  | "TEST_FAILED"
  | "TIMEOUT"
  | "UNKNOWN";

export function lwcErrorResult(params: SfLwcParams, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = classify(message);
  const digest = buildDigest({
    action: params.action,
    status: "fail",
    icon: "🧩",
    title: "LWC Lifecycle Error",
    scope: params.component ?? params.file ?? params.test_file ?? params.workspace,
    sections: [
      section("🔥", "Root Cause", [row("🏷️", "Type", code), row("💬", "Message", message)]),
      section("🛠️", "Suggested Fix", [row("➡️", "Next", suggestionFor(code))]),
    ],
  });
  return toolResultFromDigest(digest, { error: { code, message } });
}

function classify(message: string): LwcErrorCode {
  if (/No sfdx-project\.json/i.test(message)) return "NOT_SFDX_PROJECT";
  if (/not found/i.test(message) && /lwc-jest/i.test(message)) return "TEST_RUNNER_MISSING";
  if (/not found/i.test(message)) return "NOT_FOUND";
  if (/Ambiguous/i.test(message)) return "AMBIGUOUS_TARGET";
  if (/timeout/i.test(message)) return "TIMEOUT";
  if (/diagnostic|compiler|template/i.test(message)) return "DIAGNOSTIC_ERROR";
  return "UNKNOWN";
}

function suggestionFor(code: LwcErrorCode): string {
  switch (code) {
    case "NOT_SFDX_PROJECT":
      return "Run sf_lwc from an SFDX project root or pass workspace.";
    case "TEST_RUNNER_MISSING":
      return "Install project LWC Jest dependencies outside sf-lwc, then rerun test.discover.";
    case "NOT_FOUND":
      return "Run project.scan or component.list to discover valid local LWC targets.";
    case "AMBIGUOUS_TARGET":
      return "Pass package_dir or a more specific target.";
    case "TIMEOUT":
      return "Narrow the test scope or increase timeout_seconds intentionally.";
    case "DIAGNOSTIC_ERROR":
      return "Inspect the diagnostic artifact and rerun file.diagnose after fixing the first error.";
    default:
      return "Check the LWC Result Card and artifact details, then retry with a narrower scope.";
  }
}
