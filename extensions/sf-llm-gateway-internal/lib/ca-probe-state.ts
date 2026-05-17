/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Persisted snapshot of the most recent gateway-doctor outcome, scoped to
 * the question "would the macOS NODE_EXTRA_CA_CERTS hint apply to this user
 * right now?".
 *
 * The shape is intentionally minimal so the welcome splash can read it
 * synchronously on the boot path and decide, without any live probe of its
 * own, whether to render the `fix-ca-bundle` nudge row.
 *
 * Lifecycle:
 *   - Written by `lib/doctor.ts` at the end of every `fetchGatewayDoctorReport`
 *     run (deferred refresh on `turn_end`, explicit `/sf-llm-gateway doctor`,
 *     or the doctor step inside `/sf-llm-gateway onboard`).
 *   - Read by `extensions/sf-welcome/lib/splash-data.ts` to compute the
 *     CA-bundle nudge row, and by the `fix-ca-bundle` action to short-circuit
 *     when the most recent run already passed.
 *   - Cleared by the fixer's success path so a stale "tls" verdict from
 *     before the fix doesn't leave the splash row showing forever.
 *
 * Backed by `lib/common/state-store.ts` per the Q4 case in
 * AGENTS.md \u2192 State persistence decision tree (per-user persisted state,
 * sf-pi only).
 */
import { createStateStore } from "../../../lib/common/state-store.ts";

const NAMESPACE = "sf-llm-gateway-internal";
const FILENAME = "ca-probe.json";
const SCHEMA_VERSION = 1;

/**
 * High-level classification of the most recent doctor run. We don't store
 * raw HTTP bodies or stack traces \u2014 callers that need detail re-run the
 * doctor. The classes drive the splash nudge gate:
 *
 *   - "tls"      \u2192 error matched the TLS-verify family (hint applies)
 *   - "auth"     \u2192 401 / blocked-key (different fix path: rotate / re-paste)
 *   - "redirect" \u2192 SSO redirect / wrong base URL (different fix path)
 *   - "other"    \u2192 5xx, DNS, abort, anything we don't classify
 *   - null       \u2192 doctor passed (no recommendation needed)
 */
export type GatewayCaProbeFailureClass = "tls" | "auth" | "redirect" | "other" | null;

export interface GatewayCaProbeState {
  /** ISO timestamp of the doctor run that wrote this snapshot. */
  at: string;
  /** Failure class summary. null when the doctor passed. */
  lastFailureClass: GatewayCaProbeFailureClass;
  /** True when NODE_EXTRA_CA_CERTS was set during the doctor run. */
  hasNodeExtraCaCerts: boolean;
  /** Mirror of `process.platform` at probe time \u2014 splash gate is darwin-only. */
  platform: string;
}

const DEFAULT_STATE: GatewayCaProbeState = {
  at: "",
  lastFailureClass: null,
  hasNodeExtraCaCerts: false,
  platform: "",
};

function buildStore(pathOverride?: string) {
  return createStateStore<GatewayCaProbeState>({
    namespace: NAMESPACE,
    filename: FILENAME,
    schemaVersion: SCHEMA_VERSION,
    defaults: DEFAULT_STATE,
    pathOverride,
  });
}

export function readCaProbeState(pathOverride?: string): GatewayCaProbeState {
  try {
    return buildStore(pathOverride).read();
  } catch {
    return DEFAULT_STATE;
  }
}

export function writeCaProbeState(state: GatewayCaProbeState, pathOverride?: string): void {
  try {
    buildStore(pathOverride).write(state);
  } catch {
    // Best-effort \u2014 the splash falls back to "no nudge" when the file is missing.
  }
}

export function clearCaProbeState(pathOverride?: string): void {
  try {
    buildStore(pathOverride).write(DEFAULT_STATE);
  } catch {
    // Best-effort \u2014 see writeCaProbeState.
  }
}

/**
 * Decide whether the splash should render the fix-ca-bundle nudge row.
 *
 * Pure function over a state snapshot \u2014 the splash reads the on-disk
 * state via `readCaProbeState()` and passes it in. Test pattern: feed
 * different snapshots in unit tests without filesystem fixtures.
 */
export function shouldShowCaBundleNudge(state: GatewayCaProbeState): boolean {
  if (!state.at) return false;
  if (state.platform !== "darwin") return false;
  if (state.hasNodeExtraCaCerts) return false;
  return state.lastFailureClass === "tls";
}
