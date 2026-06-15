#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Local/read-only Agent Script example sweep.
 *
 * Finds `.agent` files, runs the sf-pi compile + inspect pipeline, optionally
 * checks target readiness against an org, and writes durable JSONL results.
 * This is the non-mutating front half of the example hardening workflow; use
 * `agentscript-sweep-cleanup.mjs` after live publish/preview sweeps.
 *
 * Usage:
 *   node scripts/agentscript-example-sweep.mjs --repo /tmp/agentscript --limit 20
 *   node scripts/agentscript-example-sweep.mjs --repo /tmp/agentscript --org AgentforceSTDM --exclude-tests
 */

import { execFileSync } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect as nodeInspect } from "node:util";

import { markdownTableCell } from "./lib/text-escape.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");

function parseArgs(argv) {
  const out = {
    excludeTests: false,
    limit: undefined,
    outputDir: undefined,
    repo: undefined,
    org: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo" && argv[i + 1]) out.repo = argv[++i];
    else if (arg.startsWith("--repo=")) out.repo = arg.slice("--repo=".length);
    else if ((arg === "--org" || arg === "-o") && argv[i + 1]) out.org = argv[++i];
    else if (arg.startsWith("--org=")) out.org = arg.slice("--org=".length);
    else if (arg === "--limit" && argv[i + 1]) out.limit = Number.parseInt(argv[++i], 10);
    else if (arg.startsWith("--limit="))
      out.limit = Number.parseInt(arg.slice("--limit=".length), 10);
    else if (arg === "--output-dir" && argv[i + 1]) out.outputDir = argv[++i];
    else if (arg.startsWith("--output-dir=")) out.outputDir = arg.slice("--output-dir=".length);
    else if (arg === "--exclude-tests") out.excludeTests = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return [
    "Usage: node scripts/agentscript-example-sweep.mjs --repo <agentscript-repo> [options]",
    "",
    "Options:",
    "  --org <alias>        Run read-only target checks against this org.",
    "  --exclude-tests      Skip paths containing /test/ or /tests/.",
    "  --limit <n>          Limit number of files after filtering.",
    "  --output-dir <dir>   Override output dir. Default: .pi/state/sf-agentscript/example-sweeps/<run_id>",
  ].join("\n");
}

function runId() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}

function loadTsxRegister() {
  // The repo already uses tsx in dev/test workflows. Loading it lets this .mjs
  // script import TypeScript extension modules without requiring a build step.
  return import("tsx/esm/api").catch(() => null);
}

function findAgentFiles(repo) {
  const stdout = execFileSync("find", [repo, "-name", "*.agent"], { encoding: "utf8" });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function relativeTo(base, file) {
  return path.relative(base, file).replace(/\\/g, "/");
}

function isTestPath(file) {
  return /\/(?:test|tests)\//.test(file.replace(/\\/g, "/"));
}

async function optionalConn(orgAlias) {
  if (!orgAlias) return undefined;
  const { connFromAlias } = await import(
    pathToFileURL(path.join(ROOT, "lib/common/sf-conn/connection.ts")).href
  );
  return connFromAlias(orgAlias);
}

function increment(bag, key) {
  if (!key) return;
  bag[key] = (bag[key] ?? 0) + 1;
}

function sortCounts(bag, limit = 50) {
  return Object.fromEntries(
    Object.entries(bag)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit),
  );
}

function targetRef(target) {
  const idx = typeof target === "string" ? target.indexOf("://") : -1;
  return idx > 0 ? target.slice(idx + 3) : undefined;
}

function classifyTargetFailure(failure) {
  const detail = failure.detail ?? "";
  if (failure.status === "unverifiable")
    return `${failure.target?.split("://")[0] ?? "unknown"}:unverifiable`;
  if (detail.includes("standardInvocableAction")) return "standardInvocableAction:unverified";
  if (detail.includes("exists, but its active version does not match")) return "flow:io_mismatch";
  if (detail.includes("not found as an active Flow")) return "flow:missing";
  if (detail.includes("Apex class")) return "apex:missing";
  if (detail.includes("ExternalServiceRegistration")) return "externalService:missing";
  if (detail.includes("Placeholder")) return "placeholder:missing";
  return "other";
}

function markdownCounts(title, counts) {
  const rows = Object.entries(counts);
  if (rows.length === 0) return `\n## ${title}\n\n_None_\n`;
  return `\n## ${title}\n\n| Item | Count |\n| --- | ---: |\n${rows.map(([key, value]) => `| \`${markdownTableCell(key)}\` | ${value} |`).join("\n")}\n`;
}

function renderReport(summary) {
  return [
    `# Agent Script Example Sweep ${summary.run_id}`,
    "",
    `Repo: \`${summary.repo}\``,
    summary.org ? `Org: \`${summary.org}\`` : "Org: _(not checked)_",
    `Results: \`${summary.output_dir}/results.jsonl\``,
    "",
    "## Summary",
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| Total | ${summary.total} |`,
    `| Clean | ${summary.clean} |`,
    `| Warning only | ${summary.warning_only} |`,
    `| Severity 1 | ${summary.severity_1} |`,
    `| Compile failures | ${summary.compile_failures} |`,
    `| Target missing | ${summary.target_missing} |`,
    `| Target unverifiable | ${summary.target_unverifiable} |`,
    markdownCounts("Diagnostic Codes", summary.diagnostic_codes),
    markdownCounts("Target Failure Types", summary.target_failure_types),
    markdownCounts("Top Missing References", summary.top_missing_refs),
    "\n## Viable Files",
    "",
    ...(summary.viable_files.length
      ? summary.viable_files.map((file) => `- \`${file}\``)
      : ["_None_ "]),
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.repo) throw new Error("--repo is required");
  const repo = path.resolve(args.repo);
  await stat(repo);

  await loadTsxRegister();
  const [{ checkAgentScriptFile }, { inspectFile }, { checkActionTargets }] = await Promise.all([
    import(pathToFileURL(path.join(ROOT, "extensions/sf-agentscript/lib/diagnostics.ts")).href),
    import(pathToFileURL(path.join(ROOT, "extensions/sf-agentscript/lib/inspect.ts")).href),
    import(pathToFileURL(path.join(ROOT, "extensions/sf-agentscript/lib/preflight/index.ts")).href),
  ]);
  const conn = await optionalConn(args.org);

  let files = findAgentFiles(repo);
  if (args.excludeTests) files = files.filter((file) => !isTestPath(file));
  if (Number.isFinite(args.limit)) files = files.slice(0, args.limit);

  const id = runId();
  const outputDir = path.resolve(
    args.outputDir ?? path.join(ROOT, ".pi/state/sf-agentscript/example-sweeps", id),
  );
  await mkdir(outputDir, { recursive: true });
  const resultsPath = path.join(outputDir, "results.jsonl");
  const stream = createWriteStream(resultsPath, { flags: "w" });

  const summary = {
    run_id: id,
    repo,
    org: args.org,
    output_dir: outputDir,
    total: files.length,
    clean: 0,
    warning_only: 0,
    severity_1: 0,
    compile_failures: 0,
    target_missing: 0,
    target_unverifiable: 0,
    diagnostic_codes: {},
    target_failure_types: {},
    top_missing_refs: {},
    viable_files: [],
  };

  for (const file of files) {
    const compile = await checkAgentScriptFile(file);
    const inspect = await inspectFile(file);
    let targetCheck;
    if (conn && inspect.ok) {
      const actions = (inspect.components?.actions ?? []).filter((action) => action.target);
      targetCheck = await checkActionTargets(conn, actions);
    }

    const row = {
      file,
      relative_path: relativeTo(repo, file),
      compile: compile.ok
        ? {
            ok: true,
            severity_1: compile.diagnostics.filter((d) => d.severity === 1).length,
            severity_2: compile.diagnostics.filter((d) => d.severity === 2).length,
            quick_fixes: compile.quickFixes.length,
            codes: [
              ...new Set(compile.diagnostics.map((d) => d.code ?? "(no-code)").filter(Boolean)),
            ].sort(),
          }
        : { ok: false, failure_kind: compile.failureKind, reason: compile.unavailableReason },
      inspect: inspect.ok
        ? {
            ok: true,
            stats: inspect.stats,
            has_parse_errors: inspect.has_parse_errors ?? false,
            parse_error_count: inspect.parse_error_count ?? 0,
          }
        : { ok: false, reason: inspect.reason, reason_detail: inspect.reason_detail },
      targets: targetCheck
        ? {
            ok: targetCheck.ok,
            total: targetCheck.total,
            resolved: targetCheck.resolved,
            missing: targetCheck.missing,
            unverifiable: targetCheck.unverifiable,
            failures: targetCheck.targets
              .filter((target) => target.status !== "ok")
              .map((target) => ({
                name: target.name,
                target: target.target,
                status: target.status,
                detail: target.detail,
              })),
          }
        : undefined,
    };

    if (!compile.ok) summary.compile_failures++;
    else if (row.compile.severity_1 > 0) summary.severity_1++;
    else if (row.compile.severity_2 > 0) summary.warning_only++;
    else summary.clean++;
    for (const code of row.compile.ok ? row.compile.codes : [])
      increment(summary.diagnostic_codes, code);
    if (targetCheck?.missing) summary.target_missing++;
    if (targetCheck?.unverifiable) summary.target_unverifiable++;
    for (const failure of row.targets?.failures ?? []) {
      increment(summary.target_failure_types, classifyTargetFailure(failure));
      const ref = targetRef(failure.target);
      if (ref) increment(summary.top_missing_refs, ref);
    }
    if (
      row.compile.ok &&
      row.compile.severity_1 === 0 &&
      (!row.targets || (row.targets.missing === 0 && row.targets.unverifiable === 0))
    ) {
      summary.viable_files.push(row.relative_path);
    }

    stream.write(`${JSON.stringify(row)}\n`);
  }

  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.on("error", reject);
  });
  summary.diagnostic_codes = sortCounts(summary.diagnostic_codes);
  summary.target_failure_types = sortCounts(summary.target_failure_types);
  summary.top_missing_refs = sortCounts(summary.top_missing_refs, 25);
  writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(path.join(outputDir, "report.md"), renderReport(summary));
  console.log(JSON.stringify(summary, null, 2));
  console.error(`results: ${resultsPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : nodeInspect(err, { depth: 5 }));
  process.exit(1);
});
