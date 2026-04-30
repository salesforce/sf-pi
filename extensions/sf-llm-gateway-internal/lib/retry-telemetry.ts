/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Retry telemetry — small pure event bus so the transport layer can tell the
 * extension "we just retried an upstream stream" without importing Pi types
 * or knowing where the UI lives.
 *
 * The extension entry point installs a listener on init that turns these
 * events into `ctx.ui.notify` messages, so users actually see that a
 * transient upstream failure was handled. Before this, the robust retry was
 * fully silent — users had no way to tell whether pi had tried anything or
 * was just slow.
 *
 * Everything here is pure + in-memory:
 *   - setRetryEventListener(fn)         — install the listener
 *   - clearRetryEventListener()         — remove it (session_shutdown)
 *   - emitRetryEvent(event)             — called by streamAnthropicWithRobustRetry
 *   - formatRetryGuidanceFooter()       — one-line tip appended to final errors
 */
import { RETRY_GUIDANCE_SETTINGS_PATH, RETRY_GUIDANCE_STATUS_URL } from "./config.ts";

export type RetryEvent =
  | {
      type: "retry_attempt";
      /** 1-indexed attempt number for the *next* request (not the one that failed). */
      attempt: number;
      /** Upper bound on attempts, including the first one that already failed. */
      maxAttempts: number;
      /** Delay in ms before the next attempt begins. */
      delayMs: number;
      /** Sanitized error message from the attempt that just failed. */
      reason: string;
      /** Model id the retry is targeting, when known. */
      modelId?: string;
    }
  | {
      type: "retry_exhausted";
      /** Total attempts made (including the first). */
      attempts: number;
      /** Sanitized error message from the final failed attempt. */
      reason: string;
      modelId?: string;
    }
  | {
      type: "retry_recovered";
      /** Total attempts that were made before success, 2+ means at least one retry. */
      attempts: number;
      modelId?: string;
    };

export type RetryEventListener = (event: RetryEvent) => void;

let listener: RetryEventListener | null = null;

/** Install a listener. Only one listener at a time — the last caller wins. */
export function setRetryEventListener(next: RetryEventListener): void {
  listener = next;
}

/** Remove the currently installed listener, if any. */
export function clearRetryEventListener(): void {
  listener = null;
}

/**
 * Fire an event to the installed listener. Safe to call when no listener is
 * installed (the transport stays usable in tests and headless runs).
 *
 * Listener errors are deliberately swallowed — a broken listener must not
 * take down an in-flight model stream.
 */
export function emitRetryEvent(event: RetryEvent): void {
  if (!listener) return;
  try {
    listener(event);
  } catch {
    // Swallow: telemetry must never break the stream.
  }
}

/**
 * Return the one-line "what can I do about this?" footer that the transport
 * appends to sanitized error messages when retries exhaust, and the same
 * footer the extension shows when forwarding the final error through the UI.
 *
 * Kept intentionally terse so it fits in a single transcript line. Includes
 * the exact settings path and the Anthropic status URL verbatim so users can
 * act on it immediately.
 */
export function formatRetryGuidanceFooter(): string {
  return `Tip: bump retry.maxRetries in ${RETRY_GUIDANCE_SETTINGS_PATH}, or run /compact to shrink context. Upstream status: ${RETRY_GUIDANCE_STATUS_URL}`;
}

/**
 * Convert a RetryEvent into a short human-readable notification string.
 *
 * Rendered by the extension entry point; kept here so unit tests can pin the
 * wording without booting a Pi UI.
 */
export function formatRetryEventNotification(event: RetryEvent): string {
  switch (event.type) {
    case "retry_attempt":
      return `Gateway upstream hiccup — retrying (${event.attempt}/${event.maxAttempts - 1}) in ${Math.round(event.delayMs / 100) / 10}s. ${event.reason}`;
    case "retry_exhausted":
      return `Gateway upstream retry exhausted after ${event.attempts} attempt${event.attempts === 1 ? "" : "s"}. ${event.reason}\n${formatRetryGuidanceFooter()}`;
    case "retry_recovered":
      return `Gateway upstream recovered after ${event.attempts} attempt${event.attempts === 1 ? "" : "s"}.`;
  }
}
