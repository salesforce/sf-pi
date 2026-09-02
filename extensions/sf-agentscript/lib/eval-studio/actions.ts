/* SPDX-License-Identifier: Apache-2.0 */
/** Effectful dispatcher for intents returned by the Eval Studio overlay. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  copyToClipboard,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { connFromAlias } from "../../../../lib/common/sf-conn/index.ts";
import { latestEvalSpec } from "../branch-state.ts";
import { handleReportAction } from "../command/report-action.ts";
import { resolveAgentIds } from "../eval/active-ids.ts";
import type { EvalStudioIntent } from "./component.ts";
import { discoverEvalStudio } from "./discovery.ts";
import { collectAuthoringBrief, handoffAuthoringBrief } from "./handoff.ts";
import { cancelStudioRun, startStudioBackgroundTask, startStudioRun } from "./run-coordinator.ts";
import { collectStudioRunTarget } from "./run-target.ts";
import { actionRunRelease } from "../eval/actions/run.ts";

const execFileAsync = promisify(execFile);

export async function handleEvalStudioIntent(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  intent: EvalStudioIntent,
): Promise<void> {
  if (intent.kind === "rerun") {
    const inventory = await discoverForContext(ctx);
    const suite = inventory.suites.find((candidate) =>
      candidate.runs.some((run) => run.run_id === intent.run_id),
    );
    const run = suite?.runs.find((candidate) => candidate.run_id === intent.run_id);
    if (!suite || !run)
      throw new Error(`Historical Run '${intent.run_id}' is not assigned to a current Suite.`);
    if (suite.identity_conflict) throw new Error(suite.identity_conflict);
    const target = await collectStudioRunTarget(ctx, suite, {
      target_org: run.target_org,
      version: run.bot_version_number,
    });
    if (!target) return;
    const runId = await startStudioRun(pi, ctx.cwd, {
      suite_path: suite.path,
      expected_source_digest: suite.source_digest,
      ...(run.scope === "scenario" && run.scenario_id ? { scenario_id: run.scenario_id } : {}),
      target,
    });
    ctx.ui.notify(
      `Historical target reviewed. Eval Run ${runId} started in the background.`,
      "info",
    );
    return;
  }

  if (intent.kind === "run_suite" || intent.kind === "run_scenario") {
    const inventory = await discoverForContext(ctx);
    const suite = inventory.suites.find((candidate) => candidate.path === intent.suite_path);
    if (!suite) throw new Error(`Eval Suite is no longer available: ${intent.suite_path}`);
    if (suite.identity_conflict) {
      ctx.ui.notify(suite.identity_conflict, "warning");
      return;
    }
    if (!suite.projection.projectable) {
      ctx.ui.notify(
        "This Suite is not Studio-projectable. Inspect blocking Scenario issues first.",
        "warning",
      );
      return;
    }
    const target = await collectStudioRunTarget(ctx, suite);
    if (!target) return;
    const runId = await startStudioRun(pi, ctx.cwd, {
      suite_path: suite.path,
      expected_source_digest: suite.source_digest,
      ...(intent.kind === "run_scenario" ? { scenario_id: intent.scenario_id } : {}),
      target,
    });
    ctx.ui.notify(
      `Eval Run ${runId} started in the background. Reopen Eval Studio to follow progress.`,
      "info",
    );
    return;
  }

  if (intent.kind === "cancel_run") {
    const confirmed = await ctx.ui.confirm(
      "Cancel Eval Run?",
      `Cancel ${intent.run_id}? Partial evidence remains available and cannot satisfy release readiness.`,
    );
    if (!confirmed) return;
    const cancelled = cancelStudioRun(ctx.cwd, intent.run_id);
    ctx.ui.notify(
      cancelled
        ? `Cancellation requested for ${intent.run_id}.`
        : "That Run is not owned by this process.",
      cancelled ? "info" : "warning",
    );
    return;
  }

  if (intent.kind === "author") {
    const brief = await collectAuthoringBrief(ctx, intent);
    if (brief) await handoffAuthoringBrief(ctx, brief);
    return;
  }

  if (intent.kind === "report") {
    await handleReportAction(ctx, ["eval", intent.run_id, "--save"]);
    return;
  }

  if (intent.kind === "copy_summary") {
    const inventory = await discoverForContext(ctx);
    const run = [
      ...inventory.suites.flatMap((suite) => suite.runs),
      ...inventory.unassigned_runs,
    ].find((candidate) => candidate.run_id === intent.run_id);
    if (!run) throw new Error(`Run '${intent.run_id}' is no longer available.`);
    const text = [
      `Agent Script Eval Run ${run.run_id}`,
      `Execution: ${run.execution_state ?? "unknown"}`,
      `Evidence: ${run.current_verdict ?? run.recorded_verdict ?? "unverified"}`,
      `Scope: ${run.scope}${run.scenario_id ? ` · ${run.scenario_id}` : ""}`,
      `Artifacts: ${run.run_dir}`,
    ].join("\n");
    await copyToClipboard(text);
    ctx.ui.notify("Run summary copied.", "info");
    return;
  }

  if (intent.kind === "open_artifacts") {
    await openDirectory(intent.run_dir);
    ctx.ui.notify(`Opened ${intent.run_dir}`, "info");
    return;
  }

  if (intent.kind === "release_contract") {
    await runReleaseContract(pi, ctx, intent.agent_api_name);
  }
}

async function runReleaseContract(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  agentApiName: string,
): Promise<void> {
  const targetOrg = (
    await ctx.ui.input("Release Contract · authenticated org alias", "default target org")
  )?.trim();
  if (targetOrg === undefined) return;
  const agentFile = (
    await ctx.ui.input("Release Contract · Agent Script source", "path/to/Agent.agent")
  )?.trim();
  if (!agentFile) return;
  const conn = await connFromAlias(targetOrg || undefined);
  const latest = await resolveAgentIds(conn, agentApiName, { status: "any" });
  if (latest.status === "Active") {
    ctx.ui.notify(
      `Release Contract is disabled: latest ${agentApiName} v${latest.version_number} is already Active.`,
      "warning",
    );
    return;
  }
  const confirmed = await ctx.ui.confirm(
    "Run exact-version Release Contract?",
    `Org: ${targetOrg || conn.getUsername() || "<default>"}\nAgent: ${agentApiName}\nPending: v${latest.version_number} · ${latest.status}\nBotVersion: ${latest.bot_version_id}\n\nGenerated Baseline runs first; the designated Suite runs only after it passes.`,
  );
  if (!confirmed) return;
  const taskId = await startStudioBackgroundTask(
    pi,
    ctx.cwd,
    "release-contract",
    async (signal, ownerToken) => {
      const result = await actionRunRelease(
        ctx as ExtensionContext,
        {
          action: "run_release",
          target_org: targetOrg || undefined,
          agent_api_name: agentApiName,
          agent_file: agentFile,
          release_version: latest.version_number,
          coordinator_token: ownerToken,
        } as never,
        undefined,
        undefined,
        signal,
      );
      const passed = (result.details as { ok?: boolean }).ok === true;
      return {
        title: passed
          ? "Agent Script Release Contract passed"
          : "Agent Script Release Contract failed",
        body: result.content.map((item) => item.text).join("\n"),
        severity: passed ? "success" : "warning",
      };
    },
  );
  ctx.ui.notify(`Release Contract ${taskId} started in the background.`, "info");
}

async function discoverForContext(ctx: ExtensionCommandContext) {
  const pointer = (ctx as ExtensionContext).sessionManager
    ? latestEvalSpec(ctx as ExtensionContext)
    : undefined;
  return await discoverEvalStudio(ctx.cwd, {
    branch_specs: pointer ? [{ spec_path: pointer.spec_path, agent_file: pointer.agent_file }] : [],
  });
}

async function openDirectory(directory: string): Promise<void> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  await execFileAsync(command, [directory]);
}
