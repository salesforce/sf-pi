/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tiny per-machine state store for onboarding nudges.
 *
 * Today this only tracks whether we've already shown the one-time
 * "Found gateway credentials in Claude Code \u2014 run /sf-llm-gateway onboard"
 * notify. Persistence is best-effort: a missing or unreadable file is
 * treated as "not shown yet", which matches the desired behavior on a
 * fresh machine.
 *
 * Backed by `lib/common/state-store.ts` per the Q4 case in
 * AGENTS.md \u2192 State persistence decision tree.
 */
import { createStateStore } from "../../../lib/common/state-store.ts";

const NAMESPACE = "sf-llm-gateway-internal";
const FILENAME = "onboarding.json";
const SCHEMA_VERSION = 1;

export interface OnboardingNudgeState {
  /** ISO timestamp the Claude Code first-run notify was last shown. */
  claudeCodeNotifyShownAt?: string;
}

const DEFAULT_STATE: OnboardingNudgeState = {};

function buildStore(pathOverride?: string) {
  return createStateStore<OnboardingNudgeState>({
    namespace: NAMESPACE,
    filename: FILENAME,
    schemaVersion: SCHEMA_VERSION,
    defaults: DEFAULT_STATE,
    pathOverride,
  });
}

export function readOnboardingState(pathOverride?: string): OnboardingNudgeState {
  try {
    return buildStore(pathOverride).read();
  } catch {
    return DEFAULT_STATE;
  }
}

export function markClaudeCodeNotifyShown(pathOverride?: string): void {
  try {
    buildStore(pathOverride).update((current) => ({
      ...current,
      claudeCodeNotifyShownAt: new Date().toISOString(),
    }));
  } catch {
    // Best-effort \u2014 a missed write means we may show the nudge twice. Not
    // a correctness boundary.
  }
}

export function hasShownClaudeCodeNotify(pathOverride?: string): boolean {
  return Boolean(readOnboardingState(pathOverride).claudeCodeNotifyShownAt);
}
