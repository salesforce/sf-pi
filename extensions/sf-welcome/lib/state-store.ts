/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Persistent state store for sf-welcome.
 *
 * Tracks cross-session preferences like "last pi version the user has seen"
 * so the What's New panel only appears when something has actually changed.
 *
 * The state file is small, best-effort, and lives alongside other sf-pi
 * artifacts in the user's agent home. Read/write failures are swallowed —
 * we treat persistence as a nice-to-have, not a correctness boundary.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";

export interface SfWelcomeState {
  /** Latest pi-coding-agent version acknowledged via a dismissed splash. */
  lastSeenPiVersion?: string;
  /**
   * Records the user's answer to the one-time "install bundled Nerd Font"
   * prompt. Once set, the prompt never fires again (manual
   * `/sf-setup-fonts` still works as an escape hatch).
   */
  fontInstallDecision?: "yes" | "no";
  /** ISO timestamp for when we asked. Written together with the decision. */
  fontInstallPromptedAt?: string;
}

const STATE_FILE_NAME = "sf-welcome-state.json";

export function defaultStatePath(agentDir: string = globalAgentPath()): string {
  return globalAgentPathFromBase(agentDir, STATE_FILE_NAME);
}

function globalAgentPathFromBase(agentDir: string, ...segments: string[]): string {
  // Keep the optional argument as an agent-dir override for unit tests while
  // production callers use Pi's rebrand-aware globalAgentPath() helper.
  return join(agentDir, ...segments);
}

/**
 * Read the persisted welcome state.
 *
 * Returns an empty object when the file is missing or unreadable — the
 * caller can treat a missing `lastSeenPiVersion` as "first-ever launch".
 */
export function readWelcomeState(path: string = defaultStatePath()): SfWelcomeState {
  const parsed = readRawState(path);
  const state: SfWelcomeState = {};
  if (typeof parsed.lastSeenPiVersion === "string" && parsed.lastSeenPiVersion.trim()) {
    state.lastSeenPiVersion = parsed.lastSeenPiVersion.trim();
  }
  if (parsed.fontInstallDecision === "yes" || parsed.fontInstallDecision === "no") {
    state.fontInstallDecision = parsed.fontInstallDecision;
  }
  if (typeof parsed.fontInstallPromptedAt === "string" && parsed.fontInstallPromptedAt.trim()) {
    state.fontInstallPromptedAt = parsed.fontInstallPromptedAt.trim();
  }
  return state;
}

/**
 * Merge-write the welcome state. Preserves unknown keys so forward-compatible
 * additions do not get dropped by older code reading the file.
 */
export function writeWelcomeState(
  updates: Partial<SfWelcomeState>,
  path: string = defaultStatePath(),
): void {
  try {
    // Start from the raw record (not the typed read) so forward-compatible
    // keys survive a partial update.
    const existing = readRawState(path);
    const merged = { ...existing, ...updates };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  } catch {
    // Best-effort — never crash the splash because persistence failed.
  }
}

/**
 * Low-level read that preserves every key on disk. Internal to the module;
 * public callers get the typed slice via readWelcomeState().
 */
function readRawState(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
