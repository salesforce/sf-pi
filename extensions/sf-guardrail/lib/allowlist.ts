/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Session allow-memory for sf-guardrail.
 *
 * When the user picks "Allow for this session" at a confirmation dialog, we
 * persist a `sf-guardrail-allow` entry with `{ ruleId, fingerprint }`. On
 * subsequent tool_calls that classify to the same (ruleId, fingerprint),
 * classify.ts treats them as allowed and skips the prompt.
 *
 * Fingerprint strategy:
 *   - policies: the absolute path being accessed
 *   - commandGate / orgAwareGate: the exact tokenized command string, normalized
 *     (leading/trailing whitespace trimmed, inner whitespace collapsed)
 *
 * Normalization keeps "Allow for session" meaningful even when the LLM
 * regenerates a slightly-reflowed version of the same command.
 *
 * The in-memory cache is rebuilt from session entries on session_start and
 * session_tree so allowances survive /reload, /fork, and tree navigation.
 */
import type { ExtensionAPI, ExtensionContext, CustomEntry } from "@mariozechner/pi-coding-agent";
import { ALLOW_ENTRY_TYPE, type AllowEntryData } from "./types.ts";

// ─── In-memory store ────────────────────────────────────────────────────────────

const allowed = new Set<string>();

function key(ruleId: string, fingerprint: string): string {
  return `${ruleId}::${fingerprint}`;
}

function isAllowEntry(entry: unknown): entry is CustomEntry<AllowEntryData> {
  if (!entry || typeof entry !== "object") return false;
  const c = entry as { type?: string; customType?: string; data?: { ruleId?: unknown } };
  return c.type === "custom" && c.customType === ALLOW_ENTRY_TYPE && !!c.data?.ruleId;
}

/** Hydrate the cache from existing session entries. */
export function restore(ctx: ExtensionContext): void {
  allowed.clear();
  for (const entry of ctx.sessionManager.getEntries()) {
    if (isAllowEntry(entry)) {
      allowed.add(key(entry.data.ruleId, entry.data.fingerprint));
    }
  }
}

export function isAllowed(ruleId: string, fingerprint: string): boolean {
  return allowed.has(key(ruleId, fingerprint));
}

/** Persist a new allowance. Must be called from an agent turn. */
export function grant(pi: ExtensionAPI, ruleId: string, fingerprint: string): void {
  allowed.add(key(ruleId, fingerprint));
  const data: AllowEntryData = { ruleId, fingerprint, grantedAt: Date.now() };
  pi.appendEntry(ALLOW_ENTRY_TYPE, data);
}

/** Drop in-memory allowances. Used by `/sf-guardrail forget`. The session
 *  entries remain on disk; restore() on next /reload would bring them back,
 *  which is intentional so branching/tree navigation doesn't drop them.
 *  Use `forgetAll` when the user really wants to start fresh. */
export function forgetSession(): void {
  allowed.clear();
}

// ─── Fingerprinting ─────────────────────────────────────────────────────────────

export function fingerprintPath(absolutePath: string): string {
  return absolutePath;
}

export function fingerprintCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}
