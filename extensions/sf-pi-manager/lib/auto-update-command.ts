/* SPDX-License-Identifier: Apache-2.0 */
/** `/sf-pi auto-update` parsing, explicit actions, and status rendering. */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  readAutoUpdateEnabled,
  readAutoUpdateStatus,
  writeAutoUpdateEnabled,
  type AutoUpdateStatus,
} from "../../../lib/common/auto-update/store.ts";
import { runNativeAutoUpdate } from "./auto-update-runner.ts";

export { runNativeAutoUpdate } from "./auto-update-runner.ts";

export type AutoUpdateAction = "status" | "on" | "off" | "run" | "help";

export function parseAutoUpdateArgs(raw: string): { action: AutoUpdateAction } {
  const token = raw.trim().split(/\s+/).filter(Boolean)[0]?.toLowerCase();
  if (token === "on" || token === "enable") return { action: "on" };
  if (token === "off" || token === "disable") return { action: "off" };
  if (token === "run" || token === "now") return { action: "run" };
  if (token === "help") return { action: "help" };
  return { action: "status" };
}

export interface ManualAutoUpdateRunner {
  runManual(ctx: ExtensionCommandContext): Promise<AutoUpdateStatus>;
}

export async function handleAutoUpdate(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: { action: AutoUpdateAction },
  runner?: ManualAutoUpdateRunner,
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
    const status = runner
      ? await runner.runManual(ctx)
      : await runNativeAutoUpdate(pi, ctx, {
          canRunTarget: () => safeIsIdle(ctx),
        });
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
        "Native Auto Update is opt-in. Due work waits for Pi's next agent_settled boundary.",
        "First-party targets:",
        "  1. Pi runtime stays inside the audited 0.81 support window",
        "  2. compatibility preflight + pi update --extension <source> --no-approve",
        "  3. sf update stable",
        "Outdated, compatible, unpinned global npm packages such as Herdr are eligible.",
        "Pinned, local, git, project, incompatible, and unverifiable packages remain untouched.",
      ].join("\n"),
      "info",
    );
    return;
  }
  ctx.ui.notify(renderAutoUpdateStatus(), "info");
}

export function renderAutoUpdateStatus(
  prefix?: string,
  status: AutoUpdateStatus = readAutoUpdateStatus(),
): string {
  const enabled = readAutoUpdateEnabled();
  const lines = [
    prefix,
    `Auto Update: ${enabled ? "on" : "off"}`,
    `Last run: ${status.lastRunAt ?? "never"}`,
    `Last result: ${status.lastResult ?? "—"}`,
    status.pending ? "Pending: waiting for agent_settled" : undefined,
    status.running ? `Running: ${status.currentTarget ?? "update"}` : undefined,
    status.restartRecommended ? "Restart recommended: yes" : undefined,
    status.message ? `Message: ${status.message}` : undefined,
    ...(status.targets ?? []).map(
      (target) => `  ${target.target}: ${target.result} — ${target.message}`,
    ),
    "",
    "Native targets:",
    "  Pi runtime: retained inside the audited 0.81 window",
    "  Pi packages: compatibility preflight, then pi update --extension <source> --no-approve",
    "  Salesforce CLI: sf update stable",
  ].filter((line): line is string => !!line);
  return lines.join("\n");
}

function safeIsIdle(ctx: Pick<ExtensionContext, "isIdle">): boolean {
  try {
    return ctx.isIdle();
  } catch {
    return false;
  }
}
