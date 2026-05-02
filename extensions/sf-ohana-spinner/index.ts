/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-ohana-spinner behavior contract
 *
 * - Shows a random Salesforce ecosystem message with rainbow ANSI animation
 *   during LLM streaming via Pi's native setWorkingIndicator() API
 * - Rotates messages every 5 seconds by regenerating the frame set
 * - Pi manages the animation lifecycle (auto-starts on streaming, auto-stops on idle)
 * - Zero config, zero state between sessions
 *
 * Behavior matrix:
 *
 *   Event           | Result
 *   ----------------|------------------------------------------------------------
 *   session_start   | Install the rainbow working indicator
 *   5s interval     | Rotate to new random message, regenerate indicator frames
 *   session_shutdown| Clear rotation timer, restore default indicator
 *   No LLM activity | Silent — Pi only shows the indicator while streaming
 *
 * Pi SDK features used:
 *   ctx.ui.setWorkingIndicator() — configurable animated frames + interval
 *   session_start, session_shutdown — lifecycle management
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { messages } from "./lib/messages.ts";
import { buildRainbowFrames } from "./lib/rainbow.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";

function pickRandom(): string {
  return messages[Math.floor(Math.random() * messages.length)];
}

// ---- Animation interval matches the original 150ms per color shift ----
const FRAME_INTERVAL_MS = 150;

// ---- Message rotation interval: 5s keeps it entertaining without being distracting ----
const MESSAGE_ROTATION_MS = 5000;

export default function (pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-ohana-spinner")) return;

  let rotationTimer: ReturnType<typeof setInterval> | undefined;
  let activeSessionGeneration = 0;
  let activeSessionKey: string | null = null;

  function sessionKey(ctx: ExtensionContext): string {
    return `${ctx.sessionManager.getSessionId()}::${ctx.cwd}`;
  }

  function isActiveSession(ctx: ExtensionContext, generation: number): boolean {
    return generation === activeSessionGeneration && activeSessionKey === sessionKey(ctx);
  }

  /** Install the indicator with frames for the current message.
   *
   * Pi 0.70+ composes the working loader as `{indicator-frame} {workingMessage}`
   * and defaults the message to "Working...". Our rainbow frames already
   * carry the full Salesforce message text (plus a leading braille
   * spinner glyph), so we blank Pi's default working message — otherwise
   * "Working..." paints next to our animation and the rainbow effectively
   * disappears behind the static label. */
  function applyIndicator(ctx: ExtensionContext, generation: number) {
    if (!ctx.hasUI || !isActiveSession(ctx, generation)) return;
    const frames = buildRainbowFrames(pickRandom());
    ctx.ui.setWorkingIndicator({ frames, intervalMs: FRAME_INTERVAL_MS });
    ctx.ui.setWorkingMessage("");
  }

  pi.on("session_start", async (_event, ctx) => {
    activeSessionGeneration += 1;
    activeSessionKey = sessionKey(ctx);
    const generation = activeSessionGeneration;

    // Set the initial rainbow indicator — Pi shows it only while streaming.
    applyIndicator(ctx, generation);

    // Rotate to a new random message every 5s so the spinner stays fresh.
    // The indicator keeps animating the previous frames between rotations.
    clearInterval(rotationTimer);
    rotationTimer = setInterval(() => applyIndicator(ctx, generation), MESSAGE_ROTATION_MS);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const wasActive = isActiveSession(ctx, activeSessionGeneration);
    if (!wasActive) return;

    activeSessionGeneration += 1;
    activeSessionKey = null;
    clearInterval(rotationTimer);
    rotationTimer = undefined;
    if (ctx.hasUI) {
      ctx.ui.setWorkingIndicator(); // Restore Pi's default spinner
      ctx.ui.setWorkingMessage(); // Restore Pi's default "Working..." message
    }
  });
}
