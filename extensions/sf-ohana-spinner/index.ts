/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-ohana-spinner behavior contract
 *
 * - Ohana mode supplies rotating Salesforce chrome via Pi's
 *   setWorkingMessage(); Calm mode restores Pi's default Working label
 * - Pi owns the spinner glyph, thinking-level color, and start/stop
 * - Rotates messages every 5 seconds only in Ohana mode
 * - One persisted mode preference; no runtime state between sessions
 *
 * Behavior matrix:
 *
 *   Event           | Result
 *   ----------------|------------------------------------------------------------
 *   session_start   | Install the selected working-indicator mode
 *   5s interval     | In Ohana mode, rotate to a new random message
 *   session_shutdown| Clear rotation timer, restore default indicator
 *   No LLM activity | Silent — Pi only shows the indicator while streaming
 *
 * Pi SDK features used:
 *   ctx.ui.setWorkingIndicator() — restore Pi's default spinner
 *   ctx.ui.setWorkingMessage() — Ohana catalog text, or Pi's default label
 *   session_start, session_shutdown — lifecycle management
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readEffectiveOhanaSpinnerSettings } from "./lib/settings.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";

let messageCatalog: readonly string[] | undefined;

async function pickRandomMessage(): Promise<string> {
  messageCatalog ??= (await import("./lib/messages.ts")).messages;
  return messageCatalog[Math.floor(Math.random() * messageCatalog.length)];
}

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

  function restorePiWorkingIndicator(session: IndicatorSession) {
    if (!session.ui || !isCurrentSession(session)) return;
    session.ui.setWorkingIndicator();
    session.ui.setWorkingMessage();
  }

  async function applyOhanaMessage(session: IndicatorSession) {
    if (!session.ui || !isCurrentSession(session)) return;
    const message = await pickRandomMessage();
    if (!session.ui || !isCurrentSession(session)) return;
    session.ui.setWorkingMessage(message);
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
      restorePiWorkingIndicator(indicatorSession);
      return;
    }

    if (!indicatorSession.ui || !isCurrentSession(indicatorSession)) return;
    indicatorSession.ui.setWorkingIndicator();
    await applyOhanaMessage(indicatorSession);
    if (!indicatorSession.ui || !isCurrentSession(indicatorSession)) return;

    rotationTimer = setInterval(() => {
      void applyOhanaMessage(indicatorSession).catch(() => {
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
      indicatorSession.ui.setWorkingIndicator();
      indicatorSession.ui.setWorkingMessage();
    }
  });
}
