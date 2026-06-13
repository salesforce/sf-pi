/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Stable fingerprint helpers for SF Guardrail Safety Envelopes.
 */

export function fingerprintPath(absolutePath: string): string {
  return absolutePath;
}

export function fingerprintCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}
