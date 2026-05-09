/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Centralized wrapper for `/sf-*` slash-command handlers.
 *
 * Every panel-opening or text-emitting command handler in this repo wraps
 * its body in {@link withSafeCommandHandler}. The contract is:
 *
 *   1. Throws are NEVER silent. Any error escaping the handler body is
 *      surfaced via {@link openInfoPanel} (full overlay popup, can't miss it)
 *      when `ctx.hasUI`, falling back to `ctx.ui.notify(..., "error")` for
 *      headless callers.
 *
 *   2. Long-running handlers (>300ms before they yield to UI work) get an
 *      auto-clearing status indicator in the footer so users know the
 *      command was received and is running. The indicator clears on
 *      completion, error, OR throw.
 *
 *   3. Status indicators set via {@link setSafeStatus} are guaranteed to
 *      clear in `finally`, even if the wrapped operation throws.
 *
 * Why pi's built-in error surfacing isn't enough:
 *
 *   pi's `_tryExecuteExtensionCommand` catches handler throws and emits via
 *   the extension error listener, which prints a single red line to the
 *   chat. In a long session, that line scrolls off-screen quickly and
 *   users miss it — the symptom looks like "the command did nothing".
 *   A modal info popup forces the user to see and dismiss the error.
 *
 * Usage:
 *
 *   pi.registerCommand("sf-thing", {
 *     handler: async (args, ctx) => {
 *       await withSafeCommandHandler(ctx, "sf-thing", async () => {
 *         // existing body — may throw, may hang, may open panels
 *         if (someBadState) throw new Error("config missing");
 *         await openCommandPanel(ctx, { ... });
 *       });
 *     },
 *   });
 */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { openInfoPanel } from "./info-panel.ts";

/**
 * How long the handler can run before we surface a "running…" status pill
 * in the footer. Below this threshold we stay silent to avoid flicker on
 * fast paths (cache hits, panel-open without IO).
 */
const SAFE_HANDLER_RUNNING_THRESHOLD_MS = 300;

export interface SafeCommandHandlerOptions {
  /**
   * Override the threshold for the "running…" status pill. Default 300ms.
   * Set to `Infinity` to disable the pill entirely.
   */
  runningThresholdMs?: number;
}

/**
 * Wrap an async slash-command handler body so any throw is surfaced as a
 * visible info popup (or notify in headless mode) and any setStatus from
 * inside the body is guaranteed to clear.
 *
 * Returns the wrapped body's resolved value, or `undefined` if it threw.
 */
export async function withSafeCommandHandler<T>(
  ctx: ExtensionCommandContext,
  commandName: string,
  fn: () => Promise<T> | T,
  options?: SafeCommandHandlerOptions,
): Promise<T | undefined> {
  const statusKey = `sf-pi-safe-cmd:${commandName}`;
  const threshold = options?.runningThresholdMs ?? SAFE_HANDLER_RUNNING_THRESHOLD_MS;
  let statusShown = false;

  // Start the pill timer immediately. If the handler returns inside the
  // threshold, the pill never appears. If it hangs or runs long, the user
  // sees "running…" and can tell their input was received.
  const statusTimer =
    Number.isFinite(threshold) && ctx.hasUI
      ? setTimeout(() => {
          statusShown = true;
          ctx.ui.setStatus(statusKey, `/${commandName} running…`);
        }, threshold)
      : null;

  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack : undefined;
    // Strip the "Error: <message>\n" prefix that Node prepends to stack to
    // avoid duplicating the message in the popup body.
    const stackBody = stack ? stripStackHeader(stack, message) : "";
    const body = stackBody ? `${message}\n\n${stackBody}` : message;
    if (ctx.hasUI) {
      try {
        await openInfoPanel(ctx, {
          title: `/${commandName} failed`,
          body,
          severity: "error",
        });
      } catch {
        // openInfoPanel is itself overlay-mode ctx.ui.custom; if pi's UI
        // is mid-teardown (resetExtensionUI during reload, session swap)
        // it can reject. Fall back to notify so the failure is still
        // visible in the chat scroll.
        ctx.ui.notify(`/${commandName} failed: ${message}`, "error");
      }
    } else {
      ctx.ui.notify(`/${commandName} failed: ${message}`, "error");
    }
    return undefined;
  } finally {
    if (statusTimer) clearTimeout(statusTimer);
    if (statusShown && ctx.hasUI) {
      try {
        ctx.ui.setStatus(statusKey, undefined);
      } catch {
        // setStatus on a stale ctx (post-reload) throws; nothing to do here.
      }
    }
  }
}

/**
 * Wrap a single asynchronous step with an auto-clearing footer status
 * indicator. Use inside `withSafeCommandHandler` for long-running steps
 * that need their own bespoke message (e.g. "Detecting org…",
 * "Installing fonts…").
 *
 * The status is cleared in `finally`, so a throw inside `fn` will not
 * leave a phantom "Detecting org…" indicator hanging in the footer.
 *
 * Distinct from `withSafeCommandHandler`'s built-in pill: that one is
 * generic ("running…"). This one is per-step.
 */
export async function setSafeStatus<T>(
  ctx: ExtensionCommandContext,
  key: string,
  message: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  if (ctx.hasUI) ctx.ui.setStatus(key, message);
  try {
    return await fn();
  } finally {
    if (ctx.hasUI) {
      try {
        ctx.ui.setStatus(key, undefined);
      } catch {
        // Stale ctx; ignore.
      }
    }
  }
}

function stripStackHeader(stack: string, message: string): string {
  const firstNewline = stack.indexOf("\n");
  if (firstNewline < 0) return "";
  const header = stack.slice(0, firstNewline).trim();
  // Node's default header is "Error: <message>" or "<ClassName>: <message>".
  // If the header simply restates the message we already have, drop it.
  if (header === `Error: ${message}` || header.endsWith(`: ${message}`)) {
    return stack.slice(firstNewline + 1).trim();
  }
  return stack.trim();
}
