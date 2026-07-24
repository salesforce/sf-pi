/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded, abortable execution of independent first-party update targets. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getInstalledPiVersion } from "../../../lib/common/pi-compat.ts";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import {
  markAutoUpdateResult,
  markAutoUpdateRunning,
  type AutoUpdateStatus,
  type AutoUpdateTarget,
  type AutoUpdateTargetResult,
} from "../../../lib/common/auto-update/store.ts";
import {
  planCompatiblePiPackageUpdates,
  type PiPackageUpdatePlan,
  type PiPackageUpdatePlanOptions,
} from "./auto-update-package-plan.ts";

const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

export interface NativeAutoUpdatePlan {
  offline: boolean;
  packages: PiPackageUpdatePlan;
}

export interface NativeAutoUpdateRunOptions {
  signal?: AbortSignal;
  canRunTarget?: (target: AutoUpdateTarget) => boolean;
  env?: NodeJS.ProcessEnv;
  onPlan?: (plan: NativeAutoUpdatePlan) => void;
  planPackages?: (
    pi: ExtensionAPI,
    cwd: string,
    options: PiPackageUpdatePlanOptions,
  ) => Promise<PiPackageUpdatePlan>;
}

export async function runNativeAutoUpdate(
  pi: ExtensionAPI,
  ctx: Pick<ExtensionContext, "cwd" | "ui" | "hasUI">,
  options: NativeAutoUpdateRunOptions = {},
): Promise<AutoUpdateStatus> {
  const env = options.env ?? process.env;
  const results: AutoUpdateTargetResult[] = [
    {
      target: "pi-runtime",
      result: "skipped",
      message: "Retained the audited Pi 0.81 runtime; no bounded native self-update was attempted.",
    },
  ];
  let interrupted = false;
  let packageMutationSucceeded = false;

  const setStatus = (message: string | undefined) => {
    if (ctx.hasUI) ctx.ui.setStatus("sf-pi-auto-update", message);
  };

  const mayRun = (target: AutoUpdateTarget): boolean => {
    if (options.signal?.aborted) return false;
    return options.canRunTarget?.(target) ?? true;
  };

  const runPackageTarget = async (): Promise<void> => {
    if (!mayRun("pi-packages")) {
      interrupted = true;
      results.push({
        target: "pi-packages",
        result: "skipped",
        message: "Skipped because Pi was no longer settled or consented.",
      });
      return;
    }

    setStatus("Auto Update: checking Pi package compatibility…");
    const planPackages = options.planPackages ?? planCompatiblePiPackageUpdates;
    let plan: PiPackageUpdatePlan;
    let planFailed = false;
    try {
      plan = await planPackages(pi, ctx.cwd, {
        piVersion: getInstalledPiVersion(),
        signal: options.signal,
      });
    } catch {
      planFailed = true;
      plan = emptyPackagePlan();
    }
    if (!mayRun("pi-packages")) {
      interrupted = true;
      results.push({
        target: "pi-packages",
        result: "skipped",
        message: "Compatibility check stopped because Pi was no longer settled or consented.",
      });
      return;
    }
    options.onPlan?.({ offline: false, packages: plan });
    if (plan.sources.length === 0) {
      results.push({
        target: "pi-packages",
        result: "skipped",
        message: planFailed
          ? "Skipped because package compatibility could not be established."
          : `No compatible unpinned global npm package updates were available (${plan.configuredCount} configured).`,
      });
      return;
    }

    let succeeded = 0;
    let failed = 0;
    const deadline = Date.now() + UPDATE_TIMEOUT_MS;
    for (const source of plan.sources) {
      if (!mayRun("pi-packages") || Date.now() >= deadline) {
        interrupted = true;
        break;
      }
      markAutoUpdateRunning("pi-packages");
      setStatus("Auto Update: updating one compatible Pi package…");
      try {
        const result = await pi.exec("pi", ["update", "--extension", source, "--no-approve"], {
          cwd: globalAgentPath(),
          timeout: Math.max(1, deadline - Date.now()),
          signal: options.signal,
        });
        if (options.signal?.aborted || result.killed) {
          interrupted = true;
          break;
        }
        if (result.code === 0) {
          succeeded += 1;
          packageMutationSucceeded = true;
        } else failed += 1;
      } catch {
        if (options.signal?.aborted) {
          interrupted = true;
          break;
        }
        failed += 1;
      }
    }

    results.push({
      target: "pi-packages",
      result: interrupted ? "skipped" : failed > 0 ? "failed" : "success",
      message: interrupted
        ? `Pi package updates paused after ${succeeded} completed and ${failed} failed.`
        : failed > 0
          ? `Pi package updates completed with ${succeeded} succeeded and ${failed} failed.`
          : `Pi updated ${succeeded} compatible unpinned global package(s); pins and unverifiable packages were untouched.`,
    });
  };

  const runSfCliTarget = async (): Promise<void> => {
    if (!mayRun("sf-cli")) {
      interrupted = true;
      results.push({
        target: "sf-cli",
        result: "skipped",
        message: "Skipped because Pi was no longer settled or consented.",
      });
      return;
    }

    markAutoUpdateRunning("sf-cli");
    setStatus("Auto Update: sf update stable…");
    try {
      const result = await pi.exec("sf", ["update", "stable"], {
        cwd: ctx.cwd,
        timeout: UPDATE_TIMEOUT_MS,
        signal: options.signal,
      });
      if (options.signal?.aborted || result.killed) {
        interrupted = true;
        results.push({
          target: "sf-cli",
          result: "skipped",
          message: "Cancelled when agent activity resumed or the session stopped.",
        });
      } else if (result.code === 0) {
        results.push({
          target: "sf-cli",
          result: "success",
          message: "Salesforce CLI stable-channel update completed.",
        });
      } else {
        results.push({
          target: "sf-cli",
          result: "failed",
          message: "Salesforce CLI update failed without exposing command output.",
        });
      }
    } catch {
      results.push({
        target: "sf-cli",
        result: options.signal?.aborted ? "skipped" : "failed",
        message: options.signal?.aborted
          ? "Cancelled when agent activity resumed or the session stopped."
          : "Salesforce CLI update failed without exposing command output.",
      });
      if (options.signal?.aborted) interrupted = true;
    }
  };

  try {
    if (env.PI_OFFLINE) {
      options.onPlan?.({ offline: true, packages: emptyPackagePlan() });
      results.push(
        {
          target: "pi-packages",
          result: "skipped",
          message: "Skipped because PI_OFFLINE is active.",
        },
        {
          target: "sf-cli",
          result: "skipped",
          message: "Skipped because PI_OFFLINE is active.",
        },
      );
    } else {
      await runPackageTarget();
      if (!interrupted) {
        await runSfCliTarget();
      } else {
        results.push({
          target: "sf-cli",
          result: "skipped",
          message: "Deferred because the previous target was cancelled.",
        });
      }
    }

    const failedCount = results.filter((result) => result.result === "failed").length;
    const successCount = results.filter((result) => result.result === "success").length;
    const result = interrupted
      ? "skipped"
      : failedCount > 0
        ? "failed"
        : successCount > 0
          ? "success"
          : "skipped";
    const message = interrupted
      ? "Auto Update paused because agent activity or consent changed."
      : failedCount > 0
        ? `Auto Update completed with ${failedCount} failed target(s).`
        : successCount > 0
          ? "Eligible update targets completed; Pi runtime stayed on the audited 0.81 line."
          : "Auto Update skipped all network targets. Pi runtime was unchanged.";

    return markAutoUpdateResult({
      result,
      message,
      targets: results,
      restartRecommended: packageMutationSucceeded,
    });
  } finally {
    setStatus(undefined);
  }
}

function emptyPackagePlan(): PiPackageUpdatePlan {
  return {
    sources: [],
    configuredCount: 0,
    eligibleCount: 0,
    currentCount: 0,
    skippedCount: 0,
  };
}
