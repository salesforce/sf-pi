/* SPDX-License-Identifier: Apache-2.0 */
/**
 * LSP-aware working indicator helper.
 *
 * Flips `ctx.ui.setWorkingIndicator` to a themed "LSP <Lang>…" animation
 * while we wait on diagnostics, and restores pi's default on completion.
 *
 * Pi only renders the working indicator while streaming, so calling this
 * from `handleToolResult` is safe even when the check finishes after the
 * assistant turn ends — restoring to the default is a no-op at that point.
 *
 * We reference-count nested pushes because parallel tool execution can have
 * multiple supported files in flight at once. Only when the count drops to
 * zero do we restore the default indicator.
 */

import type { ExtensionContext, WorkingIndicatorOptions } from "@mariozechner/pi-coding-agent";
import type { SupportedLanguage } from "./types.ts";
import { languageLabel } from "./activity.ts";

interface WorkingIndicatorState {
  depth: number;
  active?: SupportedLanguage;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function createWorkingIndicatorState(): WorkingIndicatorState {
  return { depth: 0 };
}

export function pushLspIndicator(
  ctx: ExtensionContext,
  state: WorkingIndicatorState,
  language: SupportedLanguage,
): void {
  if (!ctx.hasUI) return;
  state.depth += 1;
  state.active = language;

  const theme = ctx.ui.theme;
  const label = languageLabel(language);

  const frames = SPINNER_FRAMES.map((frame) => {
    return `${theme.fg("accent", frame)} ${theme.fg("dim", `LSP ${label}…`)}`;
  });

  const options: WorkingIndicatorOptions = { frames, intervalMs: 80 };
  try {
    ctx.ui.setWorkingIndicator(options);
  } catch {
    // older pi builds may lack WorkingIndicatorOptions — fall back silently
  }
}

export function popLspIndicator(ctx: ExtensionContext, state: WorkingIndicatorState): void {
  if (!ctx.hasUI) return;
  state.depth = Math.max(0, state.depth - 1);
  if (state.depth === 0) {
    state.active = undefined;
    try {
      ctx.ui.setWorkingIndicator();
    } catch {
      // see pushLspIndicator
    }
  }
}

/** Force-reset to the default indicator (e.g. on session_shutdown). */
export function resetLspIndicator(ctx: ExtensionContext, state: WorkingIndicatorState): void {
  state.depth = 0;
  state.active = undefined;
  if (!ctx.hasUI) return;
  try {
    ctx.ui.setWorkingIndicator();
  } catch {
    // ignore
  }
}
