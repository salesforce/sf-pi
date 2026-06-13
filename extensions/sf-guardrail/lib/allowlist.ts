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
import type { ExtensionAPI, ExtensionContext, CustomEntry } from "@earendil-works/pi-coding-agent";
import {
  ALLOW_ENTRY_TYPE,
  ALLOW_REVOKE_ENTRY_TYPE,
  type AllowEntryData,
  type AllowRevokeEntryData,
} from "./types.ts";
import type { OrgContext } from "./org-context.ts";

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

function isAllowRevokeEntry(entry: unknown): entry is CustomEntry<AllowRevokeEntryData> {
  if (!entry || typeof entry !== "object") return false;
  const c = entry as { type?: string; customType?: string; data?: { revokedAt?: unknown } };
  return (
    c.type === "custom" &&
    c.customType === ALLOW_REVOKE_ENTRY_TYPE &&
    typeof c.data?.revokedAt === "number"
  );
}

/** Hydrate the cache from existing session entries. */
export function restore(ctx: ExtensionContext): void {
  allowed.clear();
  const entries = ctx.sessionManager.getEntries();
  const lastRevokeAt = entries.reduce(
    (latest, entry) =>
      isAllowRevokeEntry(entry) ? Math.max(latest, entry.data.revokedAt) : latest,
    0,
  );
  for (const entry of entries) {
    if (isAllowEntry(entry) && entry.data.grantedAt > lastRevokeAt) {
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

/**
 * Drop in-memory allowances and append a native Pi session-entry tombstone so
 * /reload and /tree navigation do not restore older allow entries.
 */
export function forgetSession(pi?: ExtensionAPI): void {
  allowed.clear();
  if (pi) pi.appendEntry(ALLOW_REVOKE_ENTRY_TYPE, { revokedAt: Date.now() });
}

// ─── Fingerprinting ─────────────────────────────────────────────────────────────

export function fingerprintPath(absolutePath: string): string {
  return absolutePath;
}

export function fingerprintCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

/**
 * Session allow-memory for org-aware gates uses a safety envelope rather than
 * the exact shell string. Production deploy prompts, for example, should not
 * repeat just because the metadata member changes, but the allowance must stay
 * scoped to the resolved org and command family.
 */
export function fingerprintOrgAwareCommand(
  ruleId: string,
  command: string,
  org: Pick<OrgContext, "alias" | "orgId" | "username" | "type">,
): string {
  const orgKey = org.orgId ?? org.username ?? org.alias ?? "<unknown>";
  if (ruleId === "sf-deploy-prod") {
    return `org=${orgKey}|type=${org.type}|family=sf project deploy`;
  }
  return `org=${orgKey}|type=${org.type}|command=${fingerprintCommand(command)}`;
}
