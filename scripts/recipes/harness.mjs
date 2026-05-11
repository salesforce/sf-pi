#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Recipe lifecycle harness for sf-agentscript.
 *
 * Runs the full sf-agentscript pipeline against the trailheadapps
 * agent-script-recipes corpus to surface hardening issues:
 *
 *   Phase A — static (default):
 *     For every `.agent` file under <recipes_root>:
 *       - agentscript_compile   — must produce 0 sev-1 errors
 *       - agentscript_inspect   — must return a valid component graph
 *
 *   Phase B — lifecycle (opt-in via --with-org <alias>):
 *     For each recipe in LIVE_LIFECYCLE_RECIPES (curated set that does
 *     not require backing flows / Apex / custom objects):
 *       - copy bundle to a sandbox project under .pi/state/recipe-harness/
 *       - publish (creates new agent or new version)
 *       - activate
 *       - preview start  (one initial turn)
 *       - preview send   (one canned utterance)
 *       - preview end
 *       - deactivate
 *
 * Output:
 *   - Console summary table (one row per recipe)
 *   - Markdown report at .pi/state/recipe-harness/report-<ts>.md
 *
 * Usage:
 *   node scripts/recipes/harness.mjs                          # static sweep only
 *   node scripts/recipes/harness.mjs --with-org AgentforceSTDM  # static + live
 *   node scripts/recipes/harness.mjs --recipes-root <path>    # override default
 *   node scripts/recipes/harness.mjs --verbose
 */

import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

// -----------------------------------------------------------------------------
// CLI parsing
// -----------------------------------------------------------------------------

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = {
    withOrg: undefined,
    recipesRoot: "/tmp/pi-github-repos/trailheadapps/agent-script-recipes",
    verbose: false,
    onlyStatic: false,
    onlyLifecycle: false,
    recipeFilter: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--with-org") args.withOrg = argv[++i];
    else if (a === "--recipes-root") args.recipesRoot = argv[++i];
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--static-only") args.onlyStatic = true;
    else if (a === "--lifecycle-only") args.onlyLifecycle = true;
    else if (a === "--filter") args.recipeFilter = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: harness.mjs [options]
  --with-org <alias>     Salesforce org alias for live lifecycle phase (skipped without)
  --recipes-root <path>  Path to a clone of trailheadapps/agent-script-recipes
  --filter <substring>   Only run recipes whose name contains the substring
  --static-only          Skip the lifecycle phase even when --with-org is set
  --lifecycle-only       Skip the static phase
  --verbose              Print extra detail on each recipe
  -h, --help             Show this help`);
      process.exit(0);
    }
  }
  return args;
}

// -----------------------------------------------------------------------------
// Live-lifecycle recipe set — recipes that don't require backing metadata
// -----------------------------------------------------------------------------

// Recipes selected for live lifecycle. Curated to ones whose .agent file
// has zero `flow://` / `apex://` action targets (so the publish pre-flight
// doesn't block) AND no backing-metadata dependencies. Recipes with
// `generatePromptResponse://` URIs are still allowed because the pre-flight
// reports them as 'unverifiable' rather than 'missing'.
//
// Recipes with flow/apex deps that would block (SimpleQA, TemplateExpressions,
// ReasoningInstructions, MultiSubagentNavigation, BidirectionalNavigation, etc.)
// are exercised in a separate phase that uses skipPreflight=true to demo the
// escape hatch.
const LIVE_LIFECYCLE_RECIPES = [
  { name: "HelloWorld", utterance: "Tell me a poem about clouds." },
  { name: "LanguageSettings", utterance: "Hello!" },
  { name: "SystemInstructionOverrides", utterance: "Hi there." },
  { name: "VariableManagement", utterance: "Hello." },
  // PromptTemplateActions used to pass when generatePromptResponse:// was
  // unverifiable. After Phase 2 of the resolver rollout we actually query
  // Prompt.DeveloperName via Tooling, and the recipe references a template
  // that isn't deployed in a clean STDM org. Pre-flight correctly blocks
  // it; deploy the GenAiPromptTemplate first to add it back here.
];

// -----------------------------------------------------------------------------
// Imports — local SDK modules
// -----------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");
const SDK_LIB = path.join(REPO_ROOT, "extensions/sf-agentscript/lib");

async function loadSdk() {
  const { checkAgentScriptFile } = await import(`${SDK_LIB}/diagnostics.ts`);
  const { inspectFile } = await import(`${SDK_LIB}/inspect.ts`);
  const { publishAgent, activateVersion, deactivateVersion } = await import(
    `${SDK_LIB}/lifecycle.ts`
  );
  // connection.ts was lifted into lib/common/sf-conn during the @salesforce/core migration.
  const { connFromAlias } = await import(`${REPO_ROOT}/lib/common/sf-conn/connection.ts`);
  const { connForAgentApi } = await import(`${SDK_LIB}/agent-api-auth.ts`);
  const { startPreviewByApiName, sendMessage, endPreview } = await import(
    `${SDK_LIB}/preview/client.ts`
  );
  return {
    checkAgentScriptFile,
    inspectFile,
    publishAgent,
    activateVersion,
    deactivateVersion,
    connFromAlias,
    connForAgentApi,
    startPreviewByApiName,
    sendMessage,
    endPreview,
  };
}

// -----------------------------------------------------------------------------
// Recipe discovery
// -----------------------------------------------------------------------------

function discoverRecipes(root, filter) {
  const out = execSync(`find ${root}/force-app -name "*.agent" -type f`, {
    encoding: "utf-8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  let recipes = out.map((agentPath) => {
    const baseName = path.basename(agentPath, ".agent");
    const bundleDir = path.dirname(agentPath);
    const category = agentPath.split("/force-app/")[1]?.split("/").slice(0, 2).join("/") ?? "?";
    return { name: baseName, agentPath, bundleDir, category };
  });
  if (filter) {
    recipes = recipes.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()));
  }
  return recipes;
}

// -----------------------------------------------------------------------------
// Phase A — static
// -----------------------------------------------------------------------------

async function runStaticPhase(sdk, recipes, args) {
  const results = [];
  console.log(`\n━━━ Phase A: static sweep (${recipes.length} recipes) ━━━`);
  for (const r of recipes) {
    const t0 = performance.now();
    const compile = await sdk.checkAgentScriptFile(r.agentPath);
    const t1 = performance.now();
    const inspect = await sdk.inspectFile(r.agentPath);
    const t2 = performance.now();

    const sev1 = (compile.diagnostics ?? []).filter((d) => d.severity === 1).length;
    const sev2 = (compile.diagnostics ?? []).filter((d) => d.severity === 2).length;
    const codes = [...new Set((compile.diagnostics ?? []).map((d) => d.code).filter(Boolean))];
    const row = {
      ...r,
      compile_ok: compile.ok,
      sev1,
      sev2,
      diag_codes: codes,
      compile_ms: t1 - t0,
      inspect_ok: inspect.ok,
      inspect_ms: t2 - t1,
      stats: inspect.stats,
      parse_errors: inspect.has_parse_errors ?? false,
    };
    results.push(row);
    if (args.verbose || sev1 > 0) {
      const tag = sev1 > 0 ? "❌" : sev2 > 0 ? "⚠ " : "✓ ";
      console.log(
        `  ${tag} ${r.name.padEnd(30)} ${row.compile_ms.toFixed(0)}ms cmp · ${row.inspect_ms.toFixed(0)}ms ins  ${codes.length > 0 ? `[${codes.join(", ")}]` : ""}`,
      );
    }
  }
  const summary = {
    total: results.length,
    compile_clean: results.filter((r) => r.sev1 === 0).length,
    with_warnings: results.filter((r) => r.sev2 > 0).length,
    with_errors: results.filter((r) => r.sev1 > 0).length,
    inspect_ok: results.filter((r) => r.inspect_ok).length,
    parse_errors: results.filter((r) => r.parse_errors).length,
    compile_ms_total: results.reduce((s, r) => s + r.compile_ms, 0),
    inspect_ms_total: results.reduce((s, r) => s + r.inspect_ms, 0),
  };
  console.log(
    `\nStatic summary: ${summary.compile_clean}/${summary.total} compile clean · ` +
      `${summary.with_errors} with errors · ${summary.with_warnings} with warnings · ` +
      `compile ${summary.compile_ms_total.toFixed(0)}ms · inspect ${summary.inspect_ms_total.toFixed(0)}ms`,
  );
  return { results, summary };
}

// -----------------------------------------------------------------------------
// Phase B — lifecycle
// -----------------------------------------------------------------------------

async function runLifecyclePhase(sdk, recipes, args) {
  const orgAlias = args.withOrg;
  console.log(`\n━━━ Phase B: live lifecycle on org=${orgAlias} ━━━`);

  const sandboxRoot = path.join(REPO_ROOT, ".pi", "state", "recipe-harness");
  await mkdir(sandboxRoot, { recursive: true });

  const conn = await sdk.connFromAlias(orgAlias);
  const targetUser = conn.getUsername() ?? orgAlias;
  console.log(`  org user: ${targetUser}`);

  const results = [];
  // Filter recipes to LIVE_LIFECYCLE_RECIPES that exist in the corpus.
  const byName = new Map(recipes.map((r) => [r.name, r]));
  const live = LIVE_LIFECYCLE_RECIPES.map((spec) => {
    const recipe = byName.get(spec.name);
    if (!recipe) return null;
    return { ...recipe, utterance: spec.utterance };
  }).filter(Boolean);
  if (args.recipeFilter) {
    const f = args.recipeFilter.toLowerCase();
    live.length = 0;
    live.push(
      ...LIVE_LIFECYCLE_RECIPES.filter((s) => s.name.toLowerCase().includes(f))
        .map((spec) => {
          const r = byName.get(spec.name);
          return r ? { ...r, utterance: spec.utterance } : null;
        })
        .filter(Boolean),
    );
  }

  for (const recipe of live) {
    const aliasName = `Pi_Recipe_${recipe.name}`;
    const stages = {
      copy: { ok: false },
      compile: { ok: false },
      publish: { ok: false },
      activate: { ok: false },
      preview_start: { ok: false },
      preview_send: { ok: false },
      preview_end: { ok: false },
      deactivate: { ok: false },
    };
    const startTs = performance.now();

    console.log(`\n  ▶ ${recipe.name} → ${aliasName}`);

    try {
      // Copy bundle into sandbox with renamed identifiers.
      const sandboxBundleDir = path.join(sandboxRoot, aliasName);
      await mkdir(sandboxBundleDir, { recursive: true });
      const sourceText = await readFile(recipe.agentPath, "utf-8");
      const renamedSource = renameDeveloperName(sourceText, recipe.name, aliasName);
      const sandboxAgentPath = path.join(sandboxBundleDir, `${aliasName}.agent`);
      await writeFile(sandboxAgentPath, renamedSource, "utf-8");
      await writeFile(
        path.join(sandboxBundleDir, `${aliasName}.bundle-meta.xml`),
        `<?xml version="1.0" encoding="UTF-8"?>
<AiAuthoringBundle xmlns="http://soap.sforce.com/2006/04/metadata">
  <bundleType>AGENT</bundleType>
</AiAuthoringBundle>
`,
        "utf-8",
      );
      stages.copy = { ok: true };

      // Compile in sandbox to confirm rename didn't break anything.
      const compile = await sdk.checkAgentScriptFile(sandboxAgentPath);
      const sev1 = (compile.diagnostics ?? []).filter((d) => d.severity === 1).length;
      stages.compile = {
        ok: sev1 === 0,
        sev1,
        sev2: (compile.diagnostics ?? []).filter((d) => d.severity === 2).length,
      };
      if (!stages.compile.ok) {
        stages.compile.error = (compile.diagnostics ?? [])
          .filter((d) => d.severity === 1)
          .map((d) => `${d.code}@L${d.range.start.line + 1}`)
          .join(", ");
        console.log(`    ✗ compile: ${stages.compile.error}`);
        results.push({ recipe: recipe.name, stages, total_ms: performance.now() - startTs });
        continue;
      }
      console.log(`    ✓ compile (${stages.compile.sev2} warnings)`);

      // Publish (with activation).
      const apiConn = await sdk.connForAgentApi(orgAlias);
      const pubResult = await sdk.publishAgent({
        conn,
        agentApiConn: apiConn.conn,
        agentSource: renamedSource,
        bundleDir: sandboxBundleDir,
        agentApiName: aliasName,
        activate: true,
        log: (m) => args.verbose && console.log(`        ${m}`),
      });
      stages.publish = {
        ok: true,
        bot_version_id: pubResult.bot_version_id,
        was_new_agent: pubResult.was_new_agent,
        bundle_deployed: pubResult.authoring_bundle && !pubResult.authoring_bundle.error,
        bundle_error: pubResult.authoring_bundle?.error,
      };
      stages.activate = { ok: pubResult.activated === true };
      console.log(
        `    ✓ publish v${pubResult.version_developer_name ?? "?"} ${pubResult.was_new_agent ? "(new)" : "(version)"}` +
          (stages.publish.bundle_deployed
            ? ""
            : ` ⚠ bundle: ${stages.publish.bundle_error ?? "skipped"}`),
      );

      // Preview start.
      const startResult = await sdk.startPreviewByApiName({
        conn: apiConn.conn,
        cwd: sandboxRoot,
        agentApiName: aliasName,
        agentName: aliasName,
      });
      stages.preview_start = {
        ok: true,
        session_id: startResult.sessionId,
        initial_response_chars: startResult.agentResponse?.length ?? 0,
      };
      console.log(
        `    ✓ preview start  (${startResult.agentResponse?.slice(0, 80) ?? "<no initial response>"}…)`,
      );

      // Preview send.
      try {
        const sendResult = await sdk.sendMessage({
          conn: apiConn.conn,
          cwd: sandboxRoot,
          agentName: aliasName,
          sessionId: startResult.sessionId,
          message: recipe.utterance,
        });
        stages.preview_send = {
          ok: true,
          response_chars: sendResult.agentResponse?.length ?? 0,
          plan_id: sendResult.planId,
          latency_ms: sendResult.latencyMs,
        };
        console.log(
          `    ✓ preview send   (${sendResult.latencyMs}ms, ${sendResult.agentResponse?.slice(0, 80) ?? ""})`,
        );
      } catch (err) {
        stages.preview_send = { ok: false, error: err.message };
        console.log(`    ✗ preview send: ${err.message}`);
      }

      // Preview end.
      try {
        const endResult = await sdk.endPreview({
          conn: apiConn.conn,
          cwd: sandboxRoot,
          agentName: aliasName,
          sessionId: startResult.sessionId,
        });
        stages.preview_end = { ok: true, turns: endResult.summary.turns };
      } catch (err) {
        stages.preview_end = { ok: false, error: err.message };
      }

      // Deactivate (cleanup).
      try {
        await sdk.deactivateVersion({ conn, agentApiName: aliasName });
        stages.deactivate = { ok: true };
        console.log(`    ✓ deactivate`);
      } catch (err) {
        stages.deactivate = { ok: false, error: err.message };
        console.log(`    ✗ deactivate: ${err.message}`);
      }
    } catch (err) {
      console.log(`    ✗ FATAL: ${err.message}`);
      // Best-effort cleanup: if we got far enough to publish, deactivate so
      // the org doesn't accumulate stale Active versions.
      if (stages.publish?.ok) {
        try {
          await sdk.deactivateVersion({ conn, agentApiName: aliasName });
          stages.deactivate = { ok: true };
          console.log(`    ✓ cleanup deactivate`);
        } catch (cleanupErr) {
          console.log(`    ✗ cleanup deactivate: ${cleanupErr.message}`);
        }
      }
    }

    const total_ms = performance.now() - startTs;
    results.push({ recipe: recipe.name, stages, total_ms });
  }

  const okCount = results.filter((r) => Object.values(r.stages).every((s) => s.ok)).length;
  console.log(`\nLifecycle summary: ${okCount}/${results.length} recipes completed every stage`);
  return { results, summary: { total: results.length, ok: okCount } };
}

function renameDeveloperName(source, oldName, newName) {
  // Replace developer_name and agent_label in config block.
  return source.replace(/(developer_name|agent_label):\s*"([^"]*)"/g, (_match, key, value) => {
    const updated = value === oldName ? newName : value;
    return `${key}: "${updated}"`;
  });
}

// -----------------------------------------------------------------------------
// Markdown report
// -----------------------------------------------------------------------------

async function writeReport(staticPhase, lifecyclePhase, args) {
  const outDir = path.join(REPO_ROOT, ".pi", "state", "recipe-harness");
  await mkdir(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `report-${ts}.md`);
  const lines = [];
  lines.push(`# Recipe lifecycle harness — report`);
  lines.push("");
  lines.push(`_Generated: ${new Date().toISOString()}_`);
  lines.push(`_Recipes root: ${args.recipesRoot}_`);
  if (args.withOrg) lines.push(`_Org: ${args.withOrg}_`);
  lines.push("");
  lines.push(`## Phase A — static`);
  lines.push("");
  if (staticPhase) {
    const s = staticPhase.summary;
    lines.push(
      `**${s.compile_clean}/${s.total} compile clean** · ${s.with_errors} with errors · ${s.with_warnings} with warnings`,
    );
    lines.push("");
    lines.push(
      "| Recipe | Category | Topics | Subagents | Actions | Variables | Compile (ms) | Inspect (ms) | Errors | Warnings | Codes |",
    );
    lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");
    for (const r of staticPhase.results) {
      const codes = r.diag_codes.length ? "`" + r.diag_codes.join("`, `") + "`" : "";
      const stats = r.stats ?? {};
      lines.push(
        `| ${r.name} | ${r.category} | ${stats.topics ?? 0} | ${stats.subagents ?? 0} | ${stats.actions ?? 0} | ${stats.variables ?? 0} | ${r.compile_ms.toFixed(1)} | ${r.inspect_ms.toFixed(1)} | ${r.sev1} | ${r.sev2} | ${codes} |`,
      );
    }
  } else {
    lines.push("_(skipped)_");
  }
  lines.push("");
  lines.push(`## Phase B — live lifecycle`);
  lines.push("");
  if (lifecyclePhase) {
    lines.push(
      `**${lifecyclePhase.summary.ok}/${lifecyclePhase.summary.total} recipes passed every stage**`,
    );
    lines.push("");
    lines.push(
      "| Recipe | Compile | Publish | Activate | Preview start | Preview send | Preview end | Deactivate | ms |",
    );
    lines.push("|---|---|---|---|---|---|---|---|---:|");
    for (const r of lifecyclePhase.results) {
      const flag = (s) => (s?.ok ? "✓" : "✗");
      const note = (s) => (s?.ok ? "" : ` (${s?.error ?? ""})`);
      lines.push(
        `| ${r.recipe} | ${flag(r.stages.compile)}${note(r.stages.compile)} | ${flag(r.stages.publish)}${note(r.stages.publish)} | ${flag(r.stages.activate)} | ${flag(r.stages.preview_start)} | ${flag(r.stages.preview_send)}${note(r.stages.preview_send)} | ${flag(r.stages.preview_end)} | ${flag(r.stages.deactivate)} | ${r.total_ms.toFixed(0)} |`,
      );
    }
  } else {
    lines.push("_(skipped — pass --with-org to enable)_");
  }
  lines.push("");
  await writeFile(outPath, lines.join("\n"), "utf-8");
  console.log(`\n📄 Report written to ${outPath}`);
  return outPath;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  if (!existsSync(args.recipesRoot)) {
    console.error(`✗ Recipes root not found: ${args.recipesRoot}`);
    console.error(`  Hint: clone the repo first via:`);
    console.error(
      `    git clone https://github.com/trailheadapps/agent-script-recipes ${args.recipesRoot}`,
    );
    process.exit(1);
  }
  const sdk = await loadSdk();
  const recipes = discoverRecipes(args.recipesRoot, args.recipeFilter);
  if (recipes.length === 0) {
    console.error(`✗ No recipes found under ${args.recipesRoot}/force-app`);
    process.exit(1);
  }
  let staticPhase;
  if (!args.onlyLifecycle) {
    staticPhase = await runStaticPhase(sdk, recipes, args);
  }
  let lifecyclePhase;
  if (args.withOrg && !args.onlyStatic) {
    lifecyclePhase = await runLifecyclePhase(sdk, recipes, args);
  }
  await writeReport(staticPhase, lifecyclePhase, args);
}

main().catch((err) => {
  console.error("\n✗ Harness crashed:", err);
  process.exit(1);
});
