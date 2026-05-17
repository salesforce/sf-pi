/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Persisted record of what `/sf-llm-gateway fix-ca-bundle` last applied.
 *
 * Used for two things:
 *   1. The splash nudge skips the row when a fix is already on disk \u2014 we
 *      don't want to keep telling users to apply something they already
 *      applied.
 *   2. A future "remove fix" command can know which plist + .zshenv block
 *      it owns without re-deriving the paths.
 *
 * Backed by `lib/common/state-store.ts` per the Q4 case in
 * AGENTS.md \u2192 State persistence decision tree. Mode 0o600 because the
 * file points at a private CA bundle path and the LaunchAgent plist that
 * sets the env var.
 */
import { createStateStore } from "../../../lib/common/state-store.ts";

const NAMESPACE = "sf-llm-gateway-internal";
const FILENAME = "ca-bundle-fixer.json";
const SCHEMA_VERSION = 1;

export interface CaBundleFixerState {
  /** ISO timestamp of the last successful apply. Empty when never applied. */
  appliedAt?: string;
  /** Absolute path to the PEM bundle the fix wired up. */
  bundlePath?: string;
  /** Absolute path to the LaunchAgent plist we own. */
  plistPath?: string;
  /**
   * "adopt" \u2014 the fix pointed at an existing bundle (e.g. installed by
   *           another tool), no download was performed.
   * "bootstrap" \u2014 the fix downloaded the bundle from a configured URL.
   */
  source?: "adopt" | "bootstrap";
}

const DEFAULT_STATE: CaBundleFixerState = {};

function buildStore(pathOverride?: string) {
  return createStateStore<CaBundleFixerState>({
    namespace: NAMESPACE,
    filename: FILENAME,
    schemaVersion: SCHEMA_VERSION,
    defaults: DEFAULT_STATE,
    pathOverride,
    mode: 0o600,
  });
}

export function readCaBundleFixerState(pathOverride?: string): CaBundleFixerState {
  try {
    return buildStore(pathOverride).read();
  } catch {
    return DEFAULT_STATE;
  }
}

export function writeCaBundleFixerState(state: CaBundleFixerState, pathOverride?: string): void {
  try {
    buildStore(pathOverride).write(state);
  } catch {
    // Best-effort \u2014 the splash nudge falls back to "no fix recorded".
  }
}

export function clearCaBundleFixerState(pathOverride?: string): void {
  try {
    buildStore(pathOverride).write(DEFAULT_STATE);
  } catch {
    // Best-effort \u2014 see writeCaBundleFixerState.
  }
}

/**
 * Returns true when a previous apply has already wired up the env var.
 * Splash nudge consumes this directly.
 */
export function hasCaBundleFixApplied(state: CaBundleFixerState): boolean {
  return Boolean(state.appliedAt && state.bundlePath);
}
