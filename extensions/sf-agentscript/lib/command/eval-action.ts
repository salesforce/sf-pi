/* SPDX-License-Identifier: Apache-2.0 */
/**
 * /sf-agentscript eval <spec.json> [--org <alias>] [--agent <name>] [--traces all|failed|off]
 *
 * Human-driven counterpart to the agentscript_eval_run tool. Runs the same
 * orchestrator and renders the LLM-shaped report inline so the user can read
 * and the LLM in pi can react in the same turn.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { connFromAlias } from "../connection.ts";
import { runEval, recordRunInIndex } from "../eval/orchestrator.ts";
import { renderReport } from "../eval/render.ts";
import type { EvalSpec, TracesMode } from "../eval/types.ts";
import { openInfoPanel } from "../../../../lib/common/info-panel.ts";
import { evalRunMarkdown } from "../render/eval.ts";
import { evalReportPath, reportHeader, writeMarkdownReport } from "../render/report-writer.ts";

interface Args {
  spec_path?: string;
  target_org?: string;
  agent_api_name?: string;
  traces_mode: TracesMode;
  concurrency: number;
  prompt_chars: number;
  verbose: boolean;
}

function parseArgs(rawArgs: string[]): Args {
  const args: Args = {
    traces_mode: "failed",
    concurrency: 8,
    prompt_chars: 600,
    verbose: false,
  };
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (!a) continue;
    if (a === "--org" || a === "--target-org") args.target_org = rawArgs[++i];
    else if (a === "--agent" || a === "--agent-api-name") args.agent_api_name = rawArgs[++i];
    else if (a === "--traces") {
      const v = rawArgs[++i];
      if (v === "all" || v === "failed" || v === "off") args.traces_mode = v;
    } else if (a === "--concurrency") {
      const n = parseInt(rawArgs[++i] ?? "", 10);
      if (Number.isFinite(n) && n > 0) args.concurrency = n;
    } else if (a === "--prompt-chars") {
      const n = parseInt(rawArgs[++i] ?? "", 10);
      if (Number.isFinite(n) && n > 0) args.prompt_chars = n;
    } else if (a === "--verbose") args.verbose = true;
    else if (!args.spec_path) args.spec_path = a;
  }
  return args;
}

export async function handleEvalAction(
  _pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  rawArgs: string[],
): Promise<void> {
  const args = parseArgs(rawArgs);
  if (!args.spec_path) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        "Usage: /sf-agentscript eval <spec.json> [--org <alias>] [--agent <name>] " +
          "[--traces failed|all|off] [--concurrency N] [--prompt-chars N] [--verbose]",
        "warning",
      );
    }
    return;
  }

  let spec: EvalSpec;
  try {
    const abs = path.isAbsolute(args.spec_path)
      ? args.spec_path
      : path.resolve(ctx.cwd, args.spec_path);
    spec = JSON.parse(await readFile(abs, "utf-8")) as EvalSpec;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (ctx.hasUI) ctx.ui.notify(`Failed to read spec: ${msg}`, "error");
    return;
  }

  if (ctx.hasUI) ctx.ui.notify(`Running eval suite (${spec.tests?.length ?? 0} tests)…`, "info");

  try {
    const conn = await connFromAlias(args.target_org);
    const result = await runEval({
      conn,
      targetOrg: args.target_org ?? conn.getUsername() ?? "<default>",
      spec,
      agentApiName: args.agent_api_name,
      tracesMode: args.traces_mode,
      concurrency: args.concurrency,
      promptChars: args.prompt_chars,
      cwd: ctx.cwd,
      specPath: args.spec_path,
      log: (m) => {
        if (ctx.hasUI) ctx.ui.notify(m, "info");
      },
    });
    await recordRunInIndex(ctx.cwd, result.run_id);

    const tracesDir =
      result.run_dir && args.traces_mode !== "off"
        ? path.join(result.run_dir, "traces")
        : undefined;
    // Keep the legacy text-style report for the JSONL artifacts (existing
    // failure-record renderer). The new beautiful renderer runs alongside
    // and is what we show in the panel + save to disk.
    const { report: legacyReport } = renderReport(result.merged, {
      promptChars: args.prompt_chars,
      verbose: args.verbose,
      tracesDir,
    });
    void legacyReport;

    const passed = result.totals.test_fail === 0 && result.totals.errors === 0;
    const niceMarkdown = evalRunMarkdown(
      {
        ok: passed,
        run_id: result.run_id,
        run_dir: result.run_dir,
        totals: result.metadata.totals as never,
        latency: result.latency,
        failed_test_ids: result.failures.map((f) => f.test_id),
      },
      result.failures,
    );

    // Save the rendered markdown alongside the run's JSONL artifacts so it
    // can be re-opened later, copy/pasted into a doc, or attached to a PR.
    let savedReportPath: string | undefined;
    try {
      const reportPath = evalReportPath(result.run_dir);
      const md =
        reportHeader({
          kind: "eval",
          title: `Eval run ${result.run_id}`,
          meta: {
            run_dir: result.run_dir,
            org: args.target_org,
            spec_path: args.spec_path,
            agent_api_name: args.agent_api_name,
            tests: result.metadata.totals.tests,
            test_pass: result.metadata.totals.test_pass,
            test_fail: result.metadata.totals.test_fail,
          },
        }) + niceMarkdown;
      const written = await writeMarkdownReport(reportPath, md);
      savedReportPath = written.path;
    } catch {
      // Report-writing is best-effort; never fail the eval over it.
    }

    if (ctx.hasUI) {
      const body = [
        niceMarkdown,
        "",
        `Artifacts: ${result.run_dir}`,
        savedReportPath ? `Saved report: ${savedReportPath}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      await openInfoPanel(ctx, {
        title: `🧪 Eval run ${result.run_id} — ${passed ? "✅ green" : "❌ red"}`,
        body,
        severity: passed ? "info" : "warning",
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (ctx.hasUI) ctx.ui.notify(`Eval failed: ${msg}`, "error");
  }
}
