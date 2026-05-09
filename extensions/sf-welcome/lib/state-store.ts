/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Persistent state store for sf-welcome.
 *
 * Tracks cross-session preferences like "last pi version the user has seen"
 * so the What's New panel only appears when something has actually changed.
 *
 * Backed by the shared `lib/common/state-store.ts` helper (atomic write,
 * schema versioning, safe defaults). The on-disk path is preserved at
 * `<globalAgentDir>/sf-welcome-state.json` so existing users' dismissals
 * survive the upgrade — new state for new extensions should use the
 * canonical `<globalAgentDir>/sf-pi/<namespace>/<filename>` layout instead.
 *
 * Read/write failures are swallowed — we treat persistence as a
 * nice-to-have, not a correctness boundary, so the splash never crashes
 * because of disk noise.
 */
import { canonicalStatePath, createStateStore } from "../../../lib/common/state-store.ts";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";

const NAMESPACE = "sf-welcome";
const SCHEMA_VERSION = 1;
// Legacy on-disk path predates the canonical sf-pi/<ns>/<file> layout. We
// keep it via pathOverride so existing dismissals and font-install decisions
// survive without a migration step in this release.
const LEGACY_FILE_NAME = "sf-welcome-state.json";

/**
 * Re-exported so callers (and tests) can ask where the file lives without
 * hard-coding the path. The default points at the legacy location; passing
 * `agentDir` lets unit tests redirect to a tmp dir.
 */
export function defaultStatePath(agentDir: string = globalAgentPath()): string {
  // Legacy path lives directly under the agent dir, not under sf-pi/<ns>/.
  return `${agentDir}/${LEGACY_FILE_NAME}`;
}

/** Public canonical path for any future migration. */
export function canonicalSfWelcomeStatePath(): string {
  return canonicalStatePath(NAMESPACE, "state.json");
}

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

const EMPTY_STATE: SfWelcomeState = {};

/**
 * The shared store holds a raw `Record<string, unknown>` (not the typed
 * `SfWelcomeState`) so forward-compatible keys written by a future sf-pi
 * survive a partial write here. Reads project to the typed slice via
 * `parseLooseState`; writes merge into the raw record.
 */
function buildStore(filePath: string) {
  return createStateStore<Record<string, unknown>>({
    namespace: NAMESPACE,
    filename: LEGACY_FILE_NAME,
    schemaVersion: SCHEMA_VERSION,
    defaults: {},
    pathOverride: filePath,
    // Pre-envelope shape (fromVersion === 0) is the bare object the file
    // shipped with for the v0.1.x series. Keep every key so future-compat
    // fields survive; the read projector strips them down to the typed slice.
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      return raw as Record<string, unknown>;
    },
  });
}

function parseLooseState(parsed: Record<string, unknown>): SfWelcomeState {
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
 * Read the persisted welcome state.
 *
 * Returns an empty object when the file is missing or unreadable — the
 * caller can treat a missing `lastSeenPiVersion` as "first-ever launch".
 * The file may carry forward-compat fields written by a newer sf-pi; the
 * typed slice strips them so callers see only what they understand.
 */
export function readWelcomeState(path: string = defaultStatePath()): SfWelcomeState {
  try {
    return parseLooseState(buildStore(path).read());
  } catch {
    return {};
  }
}

/**
 * Merge-write the welcome state. Preserves unknown keys so forward-compatible
 * additions do not get dropped by older code reading the file.
 *
 * Writes are atomic (tmp-file + rename) so an interrupted write never leaves
 * a half-written file behind.
 */
export function writeWelcomeState(
  updates: Partial<SfWelcomeState>,
  path: string = defaultStatePath(),
): void {
  try {
    buildStore(path).update((current) => ({ ...current, ...updates }));
  } catch {
    // Best-effort — never crash the splash because persistence failed.
  }
}

// Reference EMPTY_STATE so it stays in scope for callers that expect the
// default to come from this module (kept for symmetry with the previous
// pre-helper implementation).
void EMPTY_STATE;
