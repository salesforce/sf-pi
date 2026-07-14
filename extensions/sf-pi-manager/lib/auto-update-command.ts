/* SPDX-License-Identifier: Apache-2.0 */
/** Native Auto Update command and runner for SF Pi Manager. */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  autoUpdateStatusPath,
  markAutoUpdateResult,
  markAutoUpdateRunning,
  readAutoUpdateEnabled,
  readAutoUpdateStatus,
  shouldRunAutoUpdate,
  writeAutoUpdateEnabled,
  type AutoUpdateStatus,
} from "../../../lib/common/auto-update/store.ts";

const AUTO_UPDATE_DELAY_MS = 10_000;
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

export type AutoUpdateAction = "status" | "on" | "off" | "run" | "help";

export function parseAutoUpdateArgs(raw: string): { action: AutoUpdateAction } {
  const token = raw.trim().split(/\s+/).filter(Boolean)[0]?.toLowerCase();
  if (token === "on" || token === "enable") return { action: "on" };
  if (token === "off" || token === "disable") return { action: "off" };
  if (token === "run" || token === "now") return { action: "run" };
  if (token === "help") return { action: "help" };
  return { action: "status" };
}

export async function handleAutoUpdate(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: { action: AutoUpdateAction },
): Promise<void> {
  if (args.action === "on") {
    writeAutoUpdateEnabled(true);
    ctx.ui.notify(renderAutoUpdateStatus("Auto Update enabled."), "info");
    return;
  }
  if (args.action === "off") {
    writeAutoUpdateEnabled(false);
    ctx.ui.notify(renderAutoUpdateStatus("Auto Update disabled."), "info");
    return;
  }
  if (args.action === "run") {
    ctx.ui.notify("Auto Update starting…", "info");
    const status = await runNativeAutoUpdate(pi, ctx);
    ctx.ui.notify(
      renderAutoUpdateStatus("Auto Update finished.", status),
      status.lastResult === "failed" ? "warning" : "info",
    );
    return;
  }
  if (args.action === "help") {
    ctx.ui.notify(
      [
        "Usage: /sf-pi auto-update [status|on|off|run]",
        "",
        "Native Auto Update is opt-in. When enabled, SF Pi tries once per day after startup, only if Pi is idle.",
        "Commands run in order:",
        "  1. pi update --all",
        "  2. sf update stable",
      ].join("\n"),
      "info",
    );
    return;
  }
  ctx.ui.notify(renderAutoUpdateStatus(), "info");
}

export function scheduleNativeAutoUpdate(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    try {
      if (!ctx.hasUI) return;
      if (!ctx.isIdle()) return;
      if (!shouldRunAutoUpdate()) return;
      void runNativeAutoUpdate(pi, ctx).then((status) => {
        if (!ctx.hasUI) return;
        const level = status.lastResult === "failed" ? "warning" : "info";
        ctx.ui.notify(renderAutoUpdateStatus("Auto Update finished.", status), level);
      });
    } catch {
      // Best-effort background convenience. Manual /sf-pi auto-update run remains available.
    }
  }, AUTO_UPDATE_DELAY_MS);
  timer.unref?.();
  return timer;
}

export async function runNativeAutoUpdate(
  pi: ExtensionAPI,
  ctx: Pick<ExtensionContext, "cwd" | "ui" | "hasUI">,
): Promise<AutoUpdateStatus> {
  const setStatus = (message: string | undefined) => {
    if (ctx.hasUI) ctx.ui.setStatus("sf-pi-auto-update", message);
  };

  try {
    markAutoUpdateRunning("pi");
    setStatus("Auto Update: pi update --all…");
    const piResult = await pi.exec("pi", ["update", "--all"], {
      cwd: ctx.cwd,
      timeout: UPDATE_TIMEOUT_MS,
    });
    if (piResult.code !== 0) {
      return fail(`pi update --all failed: ${summarizeOutput(piResult.stderr || piResult.stdout)}`);
    }

    markAutoUpdateRunning("sf-cli");
    setStatus("Auto Update: sf update stable…");
    const sfResult = await pi.exec("sf", ["update", "stable"], {
      cwd: ctx.cwd,
      timeout: UPDATE_TIMEOUT_MS,
    });
    if (sfResult.code !== 0) {
      return fail(
        `sf update stable failed: ${summarizeOutput(sfResult.stderr || sfResult.stdout)}`,
      );
    }

    return markAutoUpdateResult({
      result: "success",
      message: "Native updates completed.",
      restartRecommended: true,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    setStatus(undefined);
  }
}

export function renderAutoUpdateStatus(
  prefix?: string,
  status: AutoUpdateStatus = readAutoUpdateStatus(),
): string {
  const enabled = readAutoUpdateEnabled();
  const lines = [
    prefix,
    `Auto Update: ${enabled ? "on" : "off"}`,
    `Status file: ${autoUpdateStatusPath()}`,
    `Last run: ${status.lastRunAt ?? "never"}`,
    `Last result: ${status.lastResult ?? "—"}`,
    status.running ? `Running: ${status.currentTarget ?? "update"}` : undefined,
    status.restartRecommended ? "Restart recommended: yes" : undefined,
    status.message ? `Message: ${status.message}` : undefined,
    "",
    "Native commands:",
    "  pi update --all",
    "  sf update stable",
  ].filter((line): line is string => !!line);
  return lines.join("\n");
}

function fail(message: string): AutoUpdateStatus {
  return markAutoUpdateResult({
    result: "failed",
    message: message || "Auto Update failed.",
    restartRecommended: false,
  });
}

function summarizeOutput(output: string): string {
  const line = output
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  return line ? line.slice(0, 240) : "no output";
}
