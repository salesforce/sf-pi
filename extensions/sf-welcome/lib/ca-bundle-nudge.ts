/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Splash-facing helper for the corporate CA bundle nudge.
 *
 * Cache-first by construction: every input is read from a state file
 * the gateway extension already populated on its own deferred refresh
 * cycle. This module never opens a network connection, never spawns a
 * subprocess, and never walks the filesystem beyond the canonical state
 * paths. That keeps the splash boot path within budget while still
 * surfacing the nudge as soon as the gateway has classified the
 * failure.
 *
 * The consumer call site lives in `splash-data.ts`. Tests live in
 * `tests/ca-bundle-nudge.test.ts`.
 */
import {
  hasCaBundleFixApplied,
  readCaBundleFixerState,
} from "../../sf-llm-gateway-internal/lib/ca-bundle-fixer-state.ts";
import {
  readCaProbeState,
  shouldShowCaBundleNudge,
} from "../../sf-llm-gateway-internal/lib/ca-probe-state.ts";
import { isSfPiExtensionEnabled } from "../../../lib/common/sf-pi-extension-state.ts";
import type { CaBundleNudgeSummary } from "./types.ts";

const COMMAND = "/sf-llm-gateway fix-ca-bundle";
const MESSAGE = "Wire your corporate CA into Node \u2014 LaunchAgent + ~/.zshenv in one shot.";

/**
 * Decide whether the splash should render the CA bundle nudge row, and
 * return the rendered payload when yes.
 *
 * Test seam: the optional path overrides let unit tests redirect both
 * state files into a tmp dir without monkey-patching the agent dir.
 */
export function collectCaBundleNudge(opts: {
  cwd: string;
  probeStatePathOverride?: string;
  fixerStatePathOverride?: string;
}): CaBundleNudgeSummary | undefined {
  // Gate 1: the internal-only extension must be enabled. External users
  // never see this row regardless of any leftover state files.
  if (!isSfPiExtensionEnabled(opts.cwd, "sf-llm-gateway-internal")) {
    return undefined;
  }

  // Gate 2: the fixer must not have already applied. We don't want the
  // splash to keep nagging after the user already ran fix-ca-bundle.
  const fixerState = readCaBundleFixerState(opts.fixerStatePathOverride);
  if (hasCaBundleFixApplied(fixerState)) {
    return undefined;
  }

  // Gate 3: the doctor's last verdict must look like the macOS-no-bundle
  // signature. Pure function over the cached snapshot \u2014 no fresh probe.
  const probeState = readCaProbeState(opts.probeStatePathOverride);
  if (!shouldShowCaBundleNudge(probeState)) {
    return undefined;
  }

  return { command: COMMAND, message: MESSAGE };
}
