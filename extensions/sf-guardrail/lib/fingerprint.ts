/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Stable fingerprint helpers for SF Guardrail Safety Envelopes.
 */
import { createHash } from "node:crypto";

export function fingerprintPath(absolutePath: string): string {
  return absolutePath;
}

export function fingerprintCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

export function fingerprintText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
