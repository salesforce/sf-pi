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
import { buildExecFn } from "../../../../lib/common/exec-adapter.ts";
import { runEval, recordRunInIndex } from "../eval/orchestrator.ts";
import { renderReport } from "../eval/render.ts";
import type { EvalSpec, TracesMode } from "../eval/types.ts";
import { openInfoPanel } from "../../../../lib/common/info-panel.ts";

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
  pi: ExtensionAPI,
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

  const exec = buildExecFn(pi, ctx.cwd);
  const targetOrg = args.target_org ?? (await getDefaultOrg(exec));
  if (!targetOrg) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        "No target org. Pass --org <alias> or run `sf config set target-org=<alias>`.",
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
    const result = await runEval(exec, {
      spec,
      targetOrg,
      agentApiName: args.agent_api_name,
      tracesMode: args.traces_mode,
      concurrency: args.concurrency,
      promptChars: args.prompt_chars,
      cwd: ctx.cwd,
      specPath: args.spec_path,
      log: (m) => {
        // Surface progress via lightweight notifications in interactive mode
        if (ctx.hasUI) ctx.ui.notify(m, "info");
      },
    });
    await recordRunInIndex(ctx.cwd, result.run_id);

    const tracesDir =
      result.run_dir && args.traces_mode !== "off"
        ? path.join(result.run_dir, "traces")
        : undefined;
    const { report } = renderReport(result.merged, {
      promptChars: args.prompt_chars,
      verbose: args.verbose,
      tracesDir,
    });

    const passed = result.totals.test_fail === 0 && result.totals.errors === 0;
    if (ctx.hasUI) {
      await openInfoPanel(ctx, {
        title: `🧪 Eval run ${result.run_id} — ${passed ? "✅ green" : "❌ red"}`,
        body: `${headline(result, passed)}\n\nArtifacts: ${result.run_dir}\n\n${report}`,
        severity: passed ? "info" : "warning",
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (ctx.hasUI) ctx.ui.notify(`Eval failed: ${msg}`, "error");
  }
}

function headline(
  result: {
    totals: { tests: number; test_pass: number; ev_pass: number; evals: number; errors: number };
    latency: { count: number; p50_ms?: number; p95_ms?: number };
    failed_batches: number;
  },
  _passed: boolean,
): string {
  const t = result.totals;
  const lat = result.latency;
  const latPart = lat.count > 0 ? `  |  latency p50=${lat.p50_ms}ms p95=${lat.p95_ms}ms` : "";
  const head = `Tests: ${t.test_pass}/${t.tests} passed  |  Evaluators: ${t.ev_pass}/${t.evals} passed  |  Step errors: ${t.errors}${latPart}`;
  return result.failed_batches > 0
    ? `${head}\n⚠ ${result.failed_batches} batch(es) returned non-200 (some tests may be missing)`
    : head;
}

async function getDefaultOrg(exec: ReturnType<typeof buildExecFn>): Promise<string | undefined> {
  try {
    const r = await exec("sf", ["config", "get", "target-org", "--json"], { timeout: 10_000 });
    if (r.code !== 0) return undefined;
    const parsed = JSON.parse(r.stdout) as { result?: Array<{ name?: string; value?: string }> };
    return parsed.result?.find((x) => x.name === "target-org")?.value;
  } catch {
    return undefined;
  }
}
