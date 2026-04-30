/* SPDX-License-Identifier: Apache-2.0 */
/**
 * pi-compat — feature-detecting shims for pi-coding-agent APIs that may not
 * exist on older pi runtimes.
 *
 * Why this exists:
 *   sf-pi's `peerDependencies` allow users to run against pi versions that
 *   pre-date newer additive APIs. If an extension calls one of those APIs
 *   directly on an older pi, startup crashes with
 *   `ctx.ui.<method> is not a function` (see issue #51 for the 0.70.2 case).
 *
 *   Rather than sprinkle `typeof ... === "function"` checks through every
 *   call site, extensions funnel through these helpers so we get a single
 *   place to document the required pi version and fail soft.
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

/**
 * Hide or show pi's built-in interactive working loader row.
 *
 * Added in pi-coding-agent 0.70.3. On older pi builds the method is
 * missing from `ctx.ui`; we no-op instead of crashing so overlays still
 * render (the only visual cost is that pi's loader row may remain behind
 * our modal, which is exactly how 0.70.2 behaved before we adopted this).
 *
 * Also short-circuits when UI is unavailable (print/RPC modes) to match
 * the `if (ctx.hasUI)` guard pattern already used at most call sites.
 */
export function setWorkingVisible(ctx: ExtensionContext, visible: boolean): void {
  if (!ctx.hasUI) return;
  const ui = ctx.ui as { setWorkingVisible?: (visible: boolean) => void };
  if (typeof ui.setWorkingVisible === "function") {
    ui.setWorkingVisible(visible);
  }
}
