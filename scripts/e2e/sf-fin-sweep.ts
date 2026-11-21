/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Recursive live sweep for sf_fin.
 *
 * Drives the real sf_fin tool (the same execute → card → model packet path Pi
 * uses) through every read-only action and every plan path for one explicit
 * Fin workspace and one explicit non-production Salesforce org, then checks
 * the invariants every result must keep:
 *
 *   - a Result Card and a bounded model packet on every result,
 *   - no secret-shaped text in model-visible output,
 *   - plans never mutate (a re-read after each plan is unchanged),
 *   - readiness, auth tokens, connectors, procedures, and error logs agree.
 *
 * Mutation is opt-in and self-cleaning only. `--live-safe` additionally runs
 * draft simulations and, per procedure, one Fin Agent API conversation when
 * the procedure is already live. It never publishes, pauses, deletes, or
 * changes org settings. It requires SF_FIN_SWEEP_LIVE_SAFE=<workspace>.
 *
 * Usage:
 *   npm run e2e:sf-fin -- --target-org <alias> --workspace <name>
 *     [--procedure <id>]... [--connector <id>]... [--live-safe] [--output <dir>]
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { maskFinSecrets } from "../../lib/common/fin-admin-surface.ts";
import { getPiAuthStorePath } from "../../lib/common/pi-auth-status.ts";
import { createFinService } from "../../extensions/sf-fin/lib/service.ts";
import { registerSfFinTool } from "../../extensions/sf-fin/lib/sf_fin-tool.ts";

interface Args {
  targetOrg?: string;
  workspace?: string;
  procedures: string[];
  connectors: string[];
  liveSafe: boolean;
  output?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { procedures: [], connectors: [], liveSafe: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--target-org") args.targetOrg = argv[++i];
    else if (flag === "--workspace") args.workspace = argv[++i];
    else if (flag === "--procedure") args.procedures.push(argv[++i] ?? "");
    else if (flag === "--connector") args.connectors.push(argv[++i] ?? "");
    else if (flag === "--live-safe") args.liveSafe = true;
    else if (flag === "--output") args.output = argv[++i];
  }
  return args;
}

type Status = "pass" | "fail" | "skip";
interface Step {
  id: string;
  status: Status;
  ms: number;
  note: string;
}

const SECRET_SHAPES = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/u,
  /\b3MVG[A-Za-z0-9._]{40,}/u, // Salesforce consumer key shape
  /\b00D[A-Za-z0-9]{12,15}![A-Za-z0-9._]{20,}/u, // Salesforce session id shape
  /https:\/\/[^\s"]*frontdoor\.jsp\?[^\s"]*sid=/u,
];

const exec = (cmd: string, args: string[], options?: { cwd?: string; timeout?: number }) =>
  new Promise<{ stdout: string; stderr: string; code: number }>((resolve) =>
    execFile(
      cmd,
      args,
      { cwd: options?.cwd, timeout: options?.timeout, maxBuffer: 16_000_000 },
      (error, stdout, stderr) =>
        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
          code: error ? Number((error as { code?: number }).code ?? 1) : 0,
        }),
    ),
  );

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown> & { card?: { title?: string; status?: string } };
  isError?: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.targetOrg || !args.workspace) {
    throw new Error(
      "Pass --target-org <alias> and --workspace <name>. This sweep never assumes a default org or workspace.",
    );
  }
  if (args.liveSafe && process.env.SF_FIN_SWEEP_LIVE_SAFE !== args.workspace) {
    throw new Error(
      `--live-safe requires SF_FIN_SWEEP_LIVE_SAFE=${args.workspace} (it runs draft simulations and Fin Agent API conversations).`,
    );
  }
  const targetOrg = args.targetOrg;
  const workspace = args.workspace;
  const outDir = args.output ?? mkdtempSync(path.join(tmpdir(), "sf-fin-sweep-"));
  mkdirSync(outDir, { recursive: true });

  let tool: { execute: (...a: unknown[]) => Promise<ToolResult> } | undefined;
  const pi = { registerTool: (t: never) => (tool = t) } as never;
  const service = createFinService({ exec: exec as never });
  registerSfFinTool(pi, service, () => ({}));
  const sfFin = tool;
  if (!sfFin) throw new Error("sf_fin tool did not register.");
  // Pi owns credentials: resolve the workspace's providers from Pi's auth store,
  // exactly as an extension context would. Values stay inside sf_fin.
  const modelRegistry = {
    async getProviderAuth(provider: string) {
      const stored = readStoredCredential(provider, getPiAuthStorePath()) as
        { key?: unknown; env?: Record<string, string> } | undefined;
      const apiKey = typeof stored?.key === "string" ? stored.key : undefined;
      return apiKey ? { auth: { apiKey }, source: "pi-auth", env: stored?.env } : undefined;
    },
  };
  const ctx = { cwd: process.cwd(), modelRegistry, hasUI: false, ui: undefined };

  const steps: Step[] = [];
  const results = new Map<string, ToolResult>();

  const call = async (
    id: string,
    input: Record<string, unknown>,
    check: (r: ToolResult) => string | undefined = () => undefined,
    { allowError = false }: { allowError?: boolean } = {},
  ): Promise<ToolResult | undefined> => {
    const started = Date.now();
    try {
      if (input.allow_mutation === true && !args.liveSafe) {
        steps.push({ id, status: "skip", ms: 0, note: "mutation needs --live-safe" });
        return undefined;
      }
      const result = await sfFin.execute(id, { workspace, ...input }, undefined, undefined, ctx);
      results.set(id, result);
      const text = result.content.map((c) => c.text).join("\n");
      const problems: string[] = [];
      if (!result.details.card?.title) problems.push("no Result Card");
      if (text.length > 6_500) problems.push(`model packet too long (${text.length})`);
      for (const shape of SECRET_SHAPES) {
        if (shape.test(text)) problems.push(`secret-shaped text (${shape.source.slice(0, 20)}…)`);
      }
      if (maskFinSecrets(text) !== text) problems.push("unmasked secret-shaped run in output");
      if (result.isError && !allowError) problems.push(`isError: ${text.split("\n")[0]}`);
      const extra = check(result);
      if (extra) problems.push(extra);
      steps.push({
        id,
        status: problems.length ? "fail" : "pass",
        ms: Date.now() - started,
        note: problems.join("; ") || (text.split("\n")[0] ?? "").slice(0, 140),
      });
      return result;
    } catch (error) {
      steps.push({
        id,
        status: "fail",
        ms: Date.now() - started,
        note: `threw: ${error instanceof Error ? error.message : String(error)}`,
      });
      return undefined;
    }
  };
  const textOf = (r?: ToolResult) => (r ? r.content.map((c) => c.text).join("\n") : "");

  // ── Workspace and CLI ────────────────────────────────────────────────────
  await call("status", { action: "status" });
  await call("doctor", { action: "doctor" }, (r) =>
    /Fin CLI/u.test(textOf(r)) ? undefined : "doctor did not report the CLI",
  );
  await call("surfaces", { action: "surfaces" }, (r) =>
    /0 unmapped/u.test(textOf(r)) || !/unmapped/u.test(textOf(r))
      ? undefined
      : "surface map has unmapped CLI commands",
  );
  await call("workspace.list", { action: "workspace", operation: "list" });
  await call("setup", { action: "setup" }, undefined, { allowError: true });
  await call("install.plan", { action: "install" });

  // ── Fin SDK reads ────────────────────────────────────────────────────────
  const manifest = await call("sdk.manifest", { action: "sdk", operation: "manifest" });
  await call("sdk.download", { action: "sdk", operation: "download" });
  const tokens = await call("sdk.auth_tokens", { action: "sdk", operation: "auth_tokens" }, (r) =>
    /could not read/u.test(textOf(r)) ? "a connector could not be read" : undefined,
  );

  // The manifest lists ids per section ("procedures:", "data_connectors:" …).
  const section = (name: string) => {
    const text = textOf(manifest);
    const start = text.indexOf(`\n${name}:`);
    if (start < 0) return [] as Array<{ id: string; state?: string }>;
    const body = text.slice(start + name.length + 2).split(/\n\S[^\n]*:\n/u)[0] ?? "";
    return [...body.matchAll(/•\s+.+?\s+\[(\d+)\](?:\s+·\s+(\w+))?/gu)].flatMap((m) =>
      m[1] ? [{ id: m[1], state: m[2] }] : [],
    );
  };
  const procedures = args.procedures.length
    ? args.procedures
    : section("procedures").map((p) => p.id);
  const connectors = args.connectors.length
    ? args.connectors
    : section("data_connectors")
        .filter((c) => c.state === "live")
        .map((c) => c.id);

  for (const id of connectors) {
    await call(`sdk.connector_logs ${id}`, {
      action: "sdk",
      operation: "connector_logs",
      connector_id: id,
      since_hours: 24,
    });
    const before = await call(`sdk.connector_state plan ${id}`, {
      action: "sdk",
      operation: "connector_state",
      connector_id: id,
      state: "live",
    });
    // A plan must not change anything: the token binding reads the same after it.
    const after = await call(`sdk.auth_tokens after-plan ${id}`, {
      action: "sdk",
      operation: "auth_tokens",
    });
    if (before && textOf(after) !== textOf(tokens)) {
      steps.push({
        id: `invariant plan-no-mutation ${id}`,
        status: "fail",
        ms: 0,
        note: "auth token bindings changed after a plan",
      });
    }
  }

  for (const id of procedures) {
    const status = await call(`sdk.agent_status ${id}`, {
      action: "sdk",
      operation: "agent_status",
      procedure_id: id,
    });
    for (const target of ["publish", "pause"] as const) {
      await call(
        `sdk.${target} plan ${id}`,
        { action: "sdk", operation: target, procedure_id: id },
        undefined,
        { allowError: true },
      );
    }
    if (args.liveSafe) {
      await call(
        `sdk.simulate ${id}`,
        { action: "sdk", operation: "simulate", procedure_id: id, generate: false },
        (r) => {
          const passed = Number(r.details.passed);
          const total = Number(r.details.total);
          if (!Number.isFinite(total) || total === 0) return "no simulations ran";
          return passed === total ? undefined : `simulations ${passed}/${total} passed`;
        },
      );
      // State comes from agent_status details, never a text match (its text
      // also names channels such as "Fin Agent API").
      const procedureState = (status?.details.procedure as { state?: string } | undefined)?.state;
      const channels = (status?.details.channels as string[] | undefined) ?? [];
      if (procedureState === "live" && channels.includes("fin_agent_api")) {
        await call(`agent.run ${id}`, {
          action: "agent",
          operation: "run",
          procedure_id: id,
          message: "What can you help me with?",
        });
      } else {
        steps.push({
          id: `agent.run ${id}`,
          status: "skip",
          ms: 0,
          note: "procedure is not live on fin_agent_api; the sweep never publishes",
        });
      }
    }
  }

  await call("agent.access", { action: "agent", operation: "access" }, undefined, {
    allowError: true,
  });

  // ── Fin admin pages (read-only, masked) ─────────────────────────────────
  await call("admin.pages", { action: "admin", operation: "pages" });
  for (const page of ["error-logs", "data-connectors", "salesforce-cases", "help-centers"]) {
    await call(`admin.read ${page}`, { action: "admin", operation: "read", page });
  }

  // ── Salesforce: readiness, observe, every plan ──────────────────────────
  const readiness = await call(
    "salesforce.readiness",
    { action: "salesforce", operation: "readiness", target_org: targetOrg },
    undefined,
    { allowError: true },
  );
  await call("salesforce.observe", {
    action: "salesforce",
    operation: "observe",
    target_org: targetOrg,
  });
  for (const operation of [
    "audit_fields_enable",
    "digital_experiences_enable",
    "enhanced_email_enable",
    "handoff_queue_create",
    "permissions_apply",
  ]) {
    await call(
      `salesforce.${operation} plan`,
      { action: "salesforce", operation, target_org: targetOrg },
      undefined,
      { allowError: true },
    );
  }
  const again = await call(
    "salesforce.readiness after plans",
    { action: "salesforce", operation: "readiness", target_org: targetOrg },
    undefined,
    { allowError: true },
  );
  if (readiness && again && textOf(readiness) !== textOf(again)) {
    steps.push({
      id: "invariant salesforce plans are read-only",
      status: "fail",
      ms: 0,
      note: "readiness changed after running every plan",
    });
  } else if (readiness && again) {
    steps.push({
      id: "invariant salesforce plans are read-only",
      status: "pass",
      ms: 0,
      note: "readiness identical before and after every plan",
    });
  }

  // ── Report ──────────────────────────────────────────────────────────────
  const failed = steps.filter((s) => s.status === "fail");
  const report = {
    targetOrg,
    workspace,
    liveSafe: args.liveSafe,
    totals: {
      pass: steps.filter((s) => s.status === "pass").length,
      fail: failed.length,
      skip: steps.filter((s) => s.status === "skip").length,
    },
    steps,
  };
  writeFileSync(path.join(outDir, "sf-fin-sweep.json"), JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  const md = [
    `# sf_fin live sweep`,
    ``,
    `pass ${report.totals.pass} · fail ${report.totals.fail} · skip ${report.totals.skip}${args.liveSafe ? " · live-safe" : ""}`,
    ``,
    `| | step | ms | note |`,
    `|---|---|---|---|`,
    ...steps.map(
      (s) =>
        `| ${s.status === "pass" ? "✅" : s.status === "fail" ? "❌" : "⏭️"} | ${s.id} | ${s.ms} | ${s.note.replace(/\|/gu, "\\|")} |`,
    ),
  ].join("\n");
  writeFileSync(path.join(outDir, "sf-fin-sweep.md"), md, { mode: 0o600 });
  for (const s of steps) {
    console.log(
      `${s.status === "pass" ? "✅" : s.status === "fail" ? "❌" : "⏭️ "} ${s.id} — ${s.note}`,
    );
  }
  console.log(
    `\n${report.totals.pass} pass · ${report.totals.fail} fail · ${report.totals.skip} skip`,
  );
  console.log(`Report: ${path.join(outDir, "sf-fin-sweep.md")}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
