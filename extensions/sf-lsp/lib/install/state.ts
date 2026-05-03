/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Persistent install decisions for the first-boot LSP orchestrator.
 *
 * Mirrors the shape and tolerant-read strategy used by
 * `extensions/sf-welcome/lib/state-store.ts`: read failures swallow to
 * an empty object, unknown keys survive a partial write, disk errors
 * never crash the caller.
 *
 * The file lives at `~/.pi/agent/sf-lsp-install-state.json` so it
 * survives across sf-pi version upgrades.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ComponentDecision, LspComponentId, LspInstallState } from "./types.ts";
import { lspInstallStatePath } from "./paths.ts";

// -------------------------------------------------------------------------------------------------
// Read
// -------------------------------------------------------------------------------------------------

export function readLspInstallState(path: string = lspInstallStatePath()): LspInstallState {
  const raw = readRaw(path);
  const result: LspInstallState = { decisions: {} };

  if (typeof raw.lastPromptedAt === "string" && raw.lastPromptedAt.trim()) {
    result.lastPromptedAt = raw.lastPromptedAt.trim();
  }

  const decisions = raw.decisions;
  if (decisions && typeof decisions === "object" && !Array.isArray(decisions)) {
    for (const key of Object.keys(decisions) as Array<LspComponentId>) {
      const value = (decisions as Record<string, unknown>)[key];
      const parsed = parseDecision(value);
      if (parsed) result.decisions[key] = parsed;
    }
  }

  return result;
}

function parseDecision(value: unknown): ComponentDecision | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;

  const at =
    typeof record.at === "string" && record.at.trim() ? record.at.trim() : new Date().toISOString();

  if (record.action === "install") {
    const acceptedVersion =
      typeof record.acceptedVersion === "string" && record.acceptedVersion.trim()
        ? record.acceptedVersion.trim()
        : undefined;
    return { action: "install", acceptedVersion, at };
  }

  if (record.action === "decline") {
    const declinedVersion =
      typeof record.declinedVersion === "string" && record.declinedVersion.trim()
        ? record.declinedVersion.trim()
        : undefined;
    return { action: "decline", declinedVersion, at };
  }

  return undefined;
}

// -------------------------------------------------------------------------------------------------
// Write
// -------------------------------------------------------------------------------------------------

export function writeLspInstallState(
  updates: Partial<LspInstallState>,
  path: string = lspInstallStatePath(),
): void {
  try {
    const existing = readRaw(path);
    const existingDecisions =
      existing.decisions &&
      typeof existing.decisions === "object" &&
      !Array.isArray(existing.decisions)
        ? (existing.decisions as Record<string, unknown>)
        : {};
    const mergedDecisions = { ...existingDecisions, ...(updates.decisions ?? {}) };
    const merged: Record<string, unknown> = {
      ...existing,
      ...updates,
      decisions: mergedDecisions,
    };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  } catch {
    // Best-effort — persistence is not a correctness boundary.
  }
}

/** Record a decision for a single component. */
export function recordComponentDecision(
  id: LspComponentId,
  decision: ComponentDecision,
  path: string = lspInstallStatePath(),
): void {
  writeLspInstallState({ decisions: { [id]: decision } }, path);
}

// -------------------------------------------------------------------------------------------------
// Internal
// -------------------------------------------------------------------------------------------------

function readRaw(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const content = readFileSync(path, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
