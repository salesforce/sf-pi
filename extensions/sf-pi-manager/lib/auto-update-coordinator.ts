/* SPDX-License-Identifier: Apache-2.0 */
/** Consent-preserving Auto Update scheduling at Pi's agent_settled seam. */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { tryAcquireAutoUpdateLock } from "../../../lib/common/auto-update/lock.ts";
import {
  clearAutoUpdatePending,
  markAutoUpdatePending,
  markAutoUpdateResult,
  readAutoUpdateEnabled,
  readAutoUpdateStatus,
  shouldRunAutoUpdate,
  type AutoUpdateStatus,
} from "../../../lib/common/auto-update/store.ts";
import type { HumanOnlyCommandOutput } from "../../../lib/common/human-only-command-output.ts";
import type { ManualAutoUpdateRunner } from "./auto-update-command.ts";
import { runNativeAutoUpdate, type NativeAutoUpdateRunOptions } from "./auto-update-runner.ts";
import { appendAutoUpdateTranscript } from "./auto-update-transcript.ts";

export interface AgentSettledUpdateCoordinator extends ManualAutoUpdateRunner {
  onSessionStart(reason: string, ctx: ExtensionContext): void;
  onAgentStart(): void;
  onAgentSettled(ctx: ExtensionContext): Promise<void>;
  onSessionShutdown(): void;
}

export function createAgentSettledUpdateCoordinator(
  pi: ExtensionAPI,
  deps: { planPackages?: NativeAutoUpdateRunOptions["planPackages"] } = {},
): AgentSettledUpdateCoordinator {
  let pending = false;
  let running = false;
  let agentActive = false;
  let disposed = false;
  let abortController: AbortController | undefined;

  const append = (output: HumanOnlyCommandOutput): void => {
    appendAutoUpdateTranscript(pi, output);
  };

  const execute = async (
    ctx: ExtensionContext | ExtensionCommandContext,
    automatic: boolean,
  ): Promise<AutoUpdateStatus> => {
    if (running) return readAutoUpdateStatus();
    if (!safeIsIdle(ctx)) {
      return markAutoUpdateResult({
        result: "skipped",
        message: "Auto Update skipped because Pi is not idle.",
        restartRecommended: false,
      });
    }
    if (automatic && !readAutoUpdateEnabled()) {
      pending = false;
      return clearAutoUpdatePending("Auto Update disabled before execution.");
    }

    const lock = tryAcquireAutoUpdateLock();
    if (!lock) return readAutoUpdateStatus();

    running = true;
    pending = false;
    abortController = new AbortController();

    try {
      const status = await runNativeAutoUpdate(pi, ctx, {
        signal: abortController.signal,
        planPackages: deps.planPackages,
        onPlan: automatic
          ? (plan) => {
              const eligible = plan.packages.eligibleCount;
              append({
                title: "Auto Update planned",
                body: [
                  "Pi runtime: retain the audited 0.81 line",
                  plan.offline
                    ? "Pi packages: skip because PI_OFFLINE is active"
                    : eligible > 0
                      ? `Pi packages: ${eligible} compatible package update${eligible === 1 ? "" : "s"} through Pi`
                      : "Pi packages: no compatible updates available",
                  plan.offline
                    ? "Salesforce CLI: skip because PI_OFFLINE is active"
                    : "Salesforce CLI: update the stable channel",
                ].join("\n"),
                severity: "info",
              });
            }
          : undefined,
        canRunTarget: () =>
          !disposed && !agentActive && (!automatic || readAutoUpdateEnabled()) && safeIsIdle(ctx),
      });
      const shouldDefer =
        automatic && abortController.signal.aborted && !disposed && readAutoUpdateEnabled();
      if (shouldDefer) {
        pending = true;
        markAutoUpdatePending();
      }
      if (automatic && !disposed) {
        append({
          title: shouldDefer ? "Auto Update deferred" : "Auto Update complete",
          body: formatFinalTranscript(status),
          severity:
            status.lastResult === "failed" || shouldDefer
              ? "warning"
              : status.lastResult === "success"
                ? "success"
                : "info",
        });
      }
      return status;
    } finally {
      abortController = undefined;
      running = false;
      lock.release();
    }
  };

  return {
    onSessionStart(reason, ctx) {
      disposed = false;
      pending = reason === "startup" && ctx.hasUI && shouldRunAutoUpdate();
      if (pending) markAutoUpdatePending();
    },
    onAgentStart() {
      agentActive = true;
      if (running) abortController?.abort();
    },
    async onAgentSettled(ctx) {
      agentActive = false;
      if (!pending || running || disposed) return;
      if (!readAutoUpdateEnabled()) {
        pending = false;
        clearAutoUpdatePending("Auto Update disabled before execution.");
        return;
      }
      if (!safeIsIdle(ctx)) return;
      await execute(ctx, true);
    },
    async runManual(ctx) {
      return execute(ctx, false);
    },
    onSessionShutdown() {
      disposed = true;
      pending = false;
      abortController?.abort();
      if (readAutoUpdateStatus().pending) {
        clearAutoUpdatePending("Pending Auto Update cancelled during session shutdown.");
      }
    },
  };
}

function formatFinalTranscript(status: AutoUpdateStatus): string {
  return [
    status.message ?? "Auto Update completed.",
    ...(status.targets ?? []).map(
      (target) => `${target.target}: ${target.result} — ${target.message}`,
    ),
    `Restart recommended: ${status.restartRecommended ? "yes" : "no"}`,
  ].join("\n");
}

function safeIsIdle(ctx: Pick<ExtensionContext, "isIdle">): boolean {
  try {
    return ctx.isIdle();
  } catch {
    return false;
  }
}
