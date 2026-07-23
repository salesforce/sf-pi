/* SPDX-License-Identifier: Apache-2.0 */
/** Sanitized Human-Only rows for automatic update lifecycle visibility. */
import os from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  registerHumanOnlyCommandOutput,
  type HumanOnlyCommandOutput,
} from "../../../lib/common/human-only-command-output.ts";
import { redactDisplayText } from "../../../lib/common/redaction.ts";

export const AUTO_UPDATE_ENTRY_TYPE = "sf-pi-auto-update";

export function registerAutoUpdateTranscript(pi: ExtensionAPI): void {
  registerHumanOnlyCommandOutput(pi, AUTO_UPDATE_ENTRY_TYPE);
}

export function appendAutoUpdateTranscript(pi: ExtensionAPI, output: HumanOnlyCommandOutput): void {
  pi.appendEntry<HumanOnlyCommandOutput>(AUTO_UPDATE_ENTRY_TYPE, {
    title: sanitize(output.title, 120),
    body: sanitize(output.body, 1_200),
    severity: output.severity,
  });
}

function sanitize(value: string, maxLength: number): string {
  let safe = redactDisplayText(value);
  const home = os.homedir();
  if (home) safe = safe.split(home).join("<home>");
  safe = safe.replace(/\bhttps?:\/\/[^\s]+/gi, "<url-redacted>");
  return safe.slice(0, maxLength);
}
