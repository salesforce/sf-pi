/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-ohana-spinner behavior contract
 *
 * - Shows either Ohana mode (explicit Thinking state + rainbow rotating
 *   messages) or Calm mode (explicit Thinking state + stable text) via Pi's
 *   native setWorkingIndicator() API
 * - Rotates messages every 5 seconds only in Ohana mode
 * - Pi manages the animation lifecycle (auto-starts on streaming, auto-stops on idle)
 * - One persisted mode preference; no runtime state between sessions
 *
 * Behavior matrix:
 *
 *   Event           | Result
 *   ----------------|------------------------------------------------------------
 *   session_start   | Install the selected working indicator mode
 *   5s interval     | In Ohana mode, rotate to a new random message
 *   session_shutdown| Clear rotation timer, restore default indicator
 *   No LLM activity | Silent — Pi only shows the indicator while streaming
 *
 * Pi SDK features used:
 *   ctx.ui.setWorkingIndicator() — configurable animated frames + interval
 *   session_start, session_shutdown — lifecycle management
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildCalmFrames, buildRainbowFrames } from "./lib/rainbow.ts";
import { readEffectiveOhanaSpinnerSettings } from "./lib/settings.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";

let messageCatalog: readonly string[] | undefined;

async function pickRandomMessage(): Promise<string> {
  messageCatalog ??= (await import("./lib/messages.ts")).messages;
  return messageCatalog[Math.floor(Math.random() * messageCatalog.length)];
}

// ---- Animation interval matches the original 150ms per color shift ----
const FRAME_INTERVAL_MS = 150;

// ---- Message rotation interval: 5s keeps it entertaining without being distracting ----
const MESSAGE_ROTATION_MS = 5000;

export default function (pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-ohana-spinner")) return;

  type IndicatorSession = {
    generation: number;
    key: string;
    ui?: ExtensionContext["ui"];
    cancelled: boolean;
  };

  let rotationTimer: ReturnType<typeof setInterval> | undefined;
  let activeSessionGeneration = 0;
  let activeSessionKey: string | null = null;
  let activeIndicatorSession: IndicatorSession | undefined;

  function sessionKey(ctx: ExtensionContext): string {
    return `${ctx.sessionManager.getSessionId()}::${ctx.cwd}`;
  }

  function isCurrentSession(session: IndicatorSession): boolean {
    return (
      !session.cancelled &&
      session.generation === activeSessionGeneration &&
      session.key === activeSessionKey
    );
  }

  function stopRotation() {
    if (activeIndicatorSession) activeIndicatorSession.cancelled = true;
    clearInterval(rotationTimer);
    rotationTimer = undefined;
  }

  /** Install the indicator with frames for the selected mode.
   *
   * Pi 0.70+ composes the working loader as `{indicator-frame} {workingMessage}`
   * and defaults the message to "Working...". Our frames already carry the
   * full visible text (plus a leading braille spinner glyph), so we blank Pi's
   * default working message — otherwise "Working..." paints next to the custom
   * indicator. */
  function applyCalmIndicator(session: IndicatorSession) {
    if (!session.ui || !isCurrentSession(session)) return;
    session.ui.setWorkingIndicator({ frames: buildCalmFrames(), intervalMs: FRAME_INTERVAL_MS });
    session.ui.setWorkingMessage("");
  }

  async function applyOhanaIndicator(session: IndicatorSession) {
    if (!session.ui || !isCurrentSession(session)) return;
    const frames = buildRainbowFrames(await pickRandomMessage());
    if (!isCurrentSession(session)) return;
    session.ui.setWorkingIndicator({ frames, intervalMs: FRAME_INTERVAL_MS });
    session.ui.setWorkingMessage("");
  }

  pi.on("session_start", async (_event, ctx) => {
    stopRotation();

    activeSessionGeneration += 1;
    const key = sessionKey(ctx);
    activeSessionKey = key;
    const indicatorSession: IndicatorSession = {
      generation: activeSessionGeneration,
      key,
      ui: ctx.hasUI ? ctx.ui : undefined,
      cancelled: false,
    };
    activeIndicatorSession = indicatorSession;

    const settings = readEffectiveOhanaSpinnerSettings(ctx.cwd);
    if (settings.mode === "calm") {
      applyCalmIndicator(indicatorSession);
      return;
    }

    // Set the initial rainbow indicator — Pi shows it only while streaming.
    await applyOhanaIndicator(indicatorSession);
    if (!indicatorSession.ui || !isCurrentSession(indicatorSession)) return;

    // Rotate to a new random message every 5s so the spinner stays fresh.
    // The indicator keeps animating the previous frames between rotations.
    rotationTimer = setInterval(() => {
      void applyOhanaIndicator(indicatorSession).catch(() => {
        // Timer work is best-effort UI decoration. Stop rotating rather than
        // letting an async timer rejection terminate the host process.
        if (isCurrentSession(indicatorSession)) stopRotation();
      });
    }, MESSAGE_ROTATION_MS);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const indicatorSession = activeIndicatorSession;
    const wasActive =
      indicatorSession &&
      indicatorSession.generation === activeSessionGeneration &&
      indicatorSession.key === sessionKey(ctx);
    if (!wasActive) return;

    activeSessionGeneration += 1;
    activeSessionKey = null;
    stopRotation();
    activeIndicatorSession = undefined;
    if (indicatorSession.ui) {
      indicatorSession.ui.setWorkingIndicator(); // Restore Pi's default spinner
      indicatorSession.ui.setWorkingMessage(); // Restore Pi's default "Working..." message
    }
  });
}
