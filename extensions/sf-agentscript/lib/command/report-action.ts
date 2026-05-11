/* SPDX-License-Identifier: Apache-2.0 */
/**
 * /sf-agentscript report eval <run_id> [--save]
 *
 * Re-render a past eval run as a Markdown report. Reads the persisted
 * failure records + run metadata from `.sfdx/agents/_runs/<run_id>/` and
 * emits the same Markdown the eval slash command produces, optionally
 * saving alongside the JSONL artifacts.
 *
 * Useful for: replaying an eval into a chat panel, attaching the result
 * to a PR description, or comparing two runs side-by-side.
 */

import path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readFailures, readMetadata } from "../eval/orchestrator.ts";
import { evalRunMarkdown, evalFailureMarkdown } from "../render/eval.ts";
import { evalReportPath, reportHeader, writeMarkdownReport } from "../render/report-writer.ts";
import { openInfoPanel } from "../../../../lib/common/info-panel.ts";

interface Args {
  kind?: "eval" | "preview";
  run_id?: string;
  test_id?: string;
  save: boolean;
}

function parseArgs(rawArgs: string[]): Args {
  const args: Args = { save: false };
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (!a) continue;
    if (a === "--save") args.save = true;
    else if (a === "--test-id" || a === "--test") args.test_id = rawArgs[++i];
    else if (!args.kind && (a === "eval" || a === "preview")) {
      args.kind = a as "eval" | "preview";
    } else if (!args.run_id) {
      args.run_id = a;
    }
  }
  return args;
}

export async function handleReportAction(
  ctx: ExtensionCommandContext,
  rawArgs: string[],
): Promise<void> {
  const args = parseArgs(rawArgs);
  if (!args.kind) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        "Usage: /sf-agentscript report eval <run_id> [--save] [--test-id <id>]",
        "warning",
      );
    }
    return;
  }
  if (args.kind === "preview") {
    if (ctx.hasUI) {
      ctx.ui.notify(
        "preview reports are saved automatically by `agentscript_preview send`. " +
          "Look under .sfdx/agents/<agent>/sessions/<sid>/reports/<plan_id>.md.",
        "info",
      );
    }
    return;
  }

  // kind === "eval"
  if (!args.run_id) {
    if (ctx.hasUI) ctx.ui.notify("Usage: /sf-agentscript report eval <run_id> [--save]", "warning");
    return;
  }

  let failures;
  let meta;
  try {
    failures = await readFailures(ctx.cwd, args.run_id);
    meta = await readMetadata(ctx.cwd, args.run_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (ctx.hasUI) ctx.ui.notify(`Cannot read run ${args.run_id}: ${msg}`, "error");
    return;
  }
  if (!meta) {
    if (ctx.hasUI) ctx.ui.notify(`No metadata for run ${args.run_id}.`, "warning");
    return;
  }

  // Single-test report
  if (args.test_id) {
    const f = failures.find((x) => x.test_id === args.test_id);
    if (!f) {
      if (ctx.hasUI) ctx.ui.notify(`No failure with test_id='${args.test_id}'`, "warning");
      return;
    }
    const md =
      reportHeader({
        kind: "eval",
        title: `Eval failure ${args.test_id} (run ${args.run_id})`,
        meta: { run_id: args.run_id, test_id: args.test_id },
      }) + evalFailureMarkdown(f);
    if (args.save) {
      const runDir = path.join(ctx.cwd, ".sfdx", "agents", "_runs", args.run_id);
      const file = path.join(runDir, "reports", `${args.test_id}.md`);
      await writeMarkdownReport(file, md);
      if (ctx.hasUI) {
        await openInfoPanel(ctx, {
          title: `Eval failure ${args.test_id}`,
          body: md + `\n\nSaved: ${file}`,
          severity: "warning",
        });
      }
    } else if (ctx.hasUI) {
      await openInfoPanel(ctx, {
        title: `Eval failure ${args.test_id}`,
        body: md,
        severity: "warning",
      });
    }
    return;
  }

  // Whole-run report
  const passed = meta.totals.test_fail === 0 && meta.totals.errors === 0;
  const niceMarkdown = evalRunMarkdown(
    {
      ok: passed,
      run_id: args.run_id,
      totals: meta.totals as never,
      latency: meta.latency_summary,
      failed_test_ids: failures.map((f) => f.test_id),
    },
    failures,
  );
  const header = reportHeader({
    kind: "eval",
    title: `Eval run ${args.run_id}`,
    meta: {
      run_id: args.run_id,
      org: meta.org,
      agent_api_name: meta.agent_api_name,
      bot_version_id: meta.bot_version_id,
      tests: meta.totals.tests,
      test_pass: meta.totals.test_pass,
      test_fail: meta.totals.test_fail,
    },
  });
  const md = header + niceMarkdown;

  let savedPath: string | undefined;
  if (args.save) {
    const runDir = path.join(ctx.cwd, ".sfdx", "agents", "_runs", args.run_id);
    const written = await writeMarkdownReport(evalReportPath(runDir), md);
    savedPath = written.path;
  }

  if (ctx.hasUI) {
    await openInfoPanel(ctx, {
      title: `🧪 Eval run ${args.run_id} — ${passed ? "✅ green" : "❌ red"}`,
      body: savedPath ? `${md}\n\nSaved: ${savedPath}` : md,
      severity: passed ? "info" : "warning",
    });
  }
}
