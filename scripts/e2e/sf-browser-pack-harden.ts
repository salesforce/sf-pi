/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Navigation Hardening Harness for SF Browser Destination Packs.
 *
 * Dev-time only. NOT a runtime tool, NOT in the manifest tool set, NOT in the
 * boot path, NOT in the default `npm test`. It drives a live, headless
 * agent-browser session against an explicitly targeted org and:
 *
 *   1. VERIFY  — opens each pack entry that has a path, applies the suggested
 *                Lightning-Aware Wait, screenshots it, classifies the surface,
 *                and marks the entry confirmed or broken.
 *   2. DISCOVER— opens the area's app, collects in-app Lightning nav links, and
 *                proposes resolved paths for candidate entries (matched by
 *                discovery hint nav label). Proposals are review state only.
 *   3. MUTATE  — (opt-in: --mutate) runs ONE representative safe mutation
 *                lifecycle: open a "New" form, capture before/after evidence,
 *                then cancel without saving.
 *
 * Output: per-entry Browser Evidence screenshots (reusing the existing evidence
 * pipeline) + a self-contained contact-sheet report (report.html / report.md) +
 * a pack proposal printed to stdout. Screenshots are NOT committed to git.
 *
 *   node --experimental-strip-types scripts/e2e/sf-browser-pack-harden.ts --org <alias>
 *   node --experimental-strip-types scripts/e2e/sf-browser-pack-harden.ts --org <alias> --mutate
 *
 * See ADR 0030 and the CONTEXT.md term Navigation Hardening Harness.
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { connFromAlias } from "../../lib/common/sf-conn/connection.ts";
import { runAgentBrowser } from "../../extensions/sf-browser/lib/agent-browser.ts";
import {
  commitEvidenceCapture,
  getEvidenceDir,
  planEvidenceCapture,
} from "../../extensions/sf-browser/lib/artifacts.ts";
import {
  dataCloudDestinationRecords,
  getDataCloudDestination,
  type DataCloudDestinationRecord,
} from "../../extensions/sf-browser/lib/data-cloud-pack.ts";
import {
  buildLightningOutcomeExpression,
  type LightningWaitModeValue,
} from "../../extensions/sf-browser/lib/lightning-wait.ts";
import { resolveOpenOrgUrl } from "../../extensions/sf-browser/lib/salesforce-open.ts";

// ---------------------------------------------------------------------------
// Thin pi/ctx shims so we can reuse the SF Browser lib without a live pi host.
// The lib only needs pi.exec(cmd, args, { cwd, signal, timeout }) and ctx.cwd.
// ---------------------------------------------------------------------------

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

function makeExec() {
  return (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; signal?: AbortSignal; timeout?: number },
  ): Promise<ExecResult> =>
    new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: opts?.cwd ?? process.cwd() });
      let stdout = "";
      let stderr = "";
      const timer = opts?.timeout
        ? setTimeout(() => child.kill("SIGKILL"), opts.timeout)
        : undefined;
      child.stdout?.on("data", (d) => (stdout += String(d)));
      child.stderr?.on("data", (d) => (stderr += String(d)));
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr });
      });
      child.on("error", (err) => {
        if (timer) clearTimeout(timer);
        resolve({ code: -1, stdout, stderr: `${stderr}\n${String(err)}`.trim() });
      });
      opts?.signal?.addEventListener("abort", () => child.kill("SIGKILL"));
    });
}

const pi = { exec: makeExec() } as unknown as ExtensionAPI;
const ctx = { cwd: process.cwd() } as unknown as ExtensionContext;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface HarnessOptions {
  targetOrg: string;
  pack: string;
  mutate: boolean;
  limit?: number;
}

function parseArgs(argv: string[]): HarnessOptions {
  const opts: Partial<HarnessOptions> = { pack: "data-cloud", mutate: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--org" || arg === "--target-org") opts.targetOrg = argv[++i];
    else if (arg === "--pack") opts.pack = argv[++i];
    else if (arg === "--mutate") opts.mutate = true;
    else if (arg === "--limit") opts.limit = Number(argv[++i]);
    else if (!arg.startsWith("--") && !opts.targetOrg) opts.targetOrg = arg;
  }
  if (!opts.targetOrg) {
    throw new Error(
      "Usage: sf-browser-pack-harden --org <alias> [--pack data-cloud] [--mutate] [--limit N]",
    );
  }
  if (opts.pack !== "data-cloud") {
    throw new Error(`Unknown pack ${JSON.stringify(opts.pack)}. Only 'data-cloud' is supported.`);
  }
  return opts as HarnessOptions;
}

// ---------------------------------------------------------------------------
// Per-entry result model
// ---------------------------------------------------------------------------

type EntryResult = {
  id: string;
  label: string;
  surface: string;
  status: DataCloudDestinationRecord["status"];
  path: string;
  outcome: "confirmed" | "broken" | "proposed" | "needs-review" | "skipped";
  expected: string;
  observedOutcome?: string;
  observedUrl?: string;
  screenshot?: string;
  note?: string;
};

// ---------------------------------------------------------------------------
// Browser steps (reuse the real SF Browser lib path)
// ---------------------------------------------------------------------------

async function openPath(targetOrg: string, pathValue: string): Promise<void> {
  const open = await resolveOpenOrgUrl(pi, ctx, { target_org: targetOrg, path: pathValue });
  await runAgentBrowser(pi, ["open", open.url], { cwd: ctx.cwd, timeoutMs: 90_000 });
}

/** Apply a Lightning-Aware Wait, then classify the observed outcome. */
async function waitAndClassify(
  mode: LightningWaitModeValue,
): Promise<{ outcome: string; url?: string }> {
  // Poll the outcome classifier a few times rather than a single hard wait so
  // a slow Lightning render does not read as broken.
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await runAgentBrowser(pi, ["eval", buildLightningOutcomeExpression(mode)], {
      cwd: ctx.cwd,
      timeoutMs: 20_000,
    });
    const parsed = safeJson(result.stdout);
    const outcome = parsed?.outcome ?? "ambiguous";
    if (outcome !== "ambiguous") return { outcome, url: parsed?.matched?.url };
    await sleep(1_000);
  }
  return { outcome: "ambiguous" };
}

async function currentUrlPath(): Promise<string | undefined> {
  try {
    const result = await runAgentBrowser(pi, ["eval", "location.pathname"], {
      cwd: ctx.cwd,
      timeoutMs: 15_000,
    });
    return result.stdout.trim().replace(/^"|"$/g, "") || undefined;
  } catch {
    return undefined;
  }
}

/** Collect in-app Lightning nav links for the DISCOVER pass. */
async function collectNavLinks(): Promise<Array<{ label: string; href: string }>> {
  const collector = `(() => {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/lightning/"]')) {
      const label = (a.getAttribute('title') || a.textContent || '').trim().replace(/\\s+/g, ' ');
      const href = a.getAttribute('href') || '';
      if (!label || !href || seen.has(label)) continue;
      seen.add(label);
      out.push({ label, href });
    }
    return JSON.stringify(out.slice(0, 200));
  })()`;
  try {
    const result = await runAgentBrowser(pi, ["eval", collector], {
      cwd: ctx.cwd,
      timeoutMs: 20_000,
    });
    const parsed = safeJson<Array<{ label: string; href: string }>>(result.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function screenshot(id: string, sessionId: string): Promise<string> {
  const planned = planEvidenceCapture(id, sessionId);
  await runAgentBrowser(pi, ["screenshot", planned.path], { cwd: ctx.cwd, timeoutMs: 60_000 });
  commitEvidenceCapture(
    {
      id: planned.id,
      label: planned.label,
      path: planned.path,
      createdAt: new Date().toISOString(),
      imageMode: "artifact",
      includedImage: false,
    },
    sessionId,
  );
  return planned.path;
}

// ---------------------------------------------------------------------------
// App resolution (org-specific; never hardcoded)
// ---------------------------------------------------------------------------

async function resolveAppPath(targetOrg: string, appDevName: string): Promise<string | undefined> {
  try {
    const conn = await connFromAlias(targetOrg);
    const result = (await conn.query(
      `SELECT DurableId FROM AppDefinition WHERE DeveloperName = '${appDevName.replace(/'/g, "")}' LIMIT 1`,
    )) as { records?: Array<{ DurableId?: string }> };
    const durableId = result.records?.[0]?.DurableId;
    return durableId ? `/lightning/app/${durableId}` : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const sessionId = `harden-${opts.pack}-${timestamp()}`;
  const evidenceDir = getEvidenceDir(sessionId);
  const records = dataCloudDestinationRecords().slice(0, opts.limit ?? Infinity);
  const results: EntryResult[] = [];
  const navLinks: Array<{ label: string; href: string }> = [];

  console.log(`SF Browser pack hardening — pack=${opts.pack} org=${opts.targetOrg}`);
  console.log(`Evidence dir: ${evidenceDir}\n`);

  // Resolve the app open path once for app-tab discovery.
  const appRecord = records.find((r) => r.discoveryHint?.app);
  const appDevName = appRecord?.discoveryHint?.app;
  const appPath = appDevName ? await resolveAppPath(opts.targetOrg, appDevName) : undefined;
  if (appDevName && !appPath) {
    console.warn(`! Could not resolve app path for ${appDevName}; app-tab discovery limited.\n`);
  }

  // If we have the app record and a resolved app path, open it once and collect
  // nav links for discovery.
  if (appRecord && appPath) {
    try {
      await openPath(opts.targetOrg, appPath);
      const observed = await waitAndClassify("app-ready");
      const shot = await screenshot("app", sessionId);
      navLinks.push(...(await collectNavLinks()));
      results.push({
        id: appRecord.id,
        label: appRecord.label,
        surface: appRecord.surface,
        status: appRecord.status,
        path: appPath,
        outcome: observed.outcome === "ambiguous" ? "needs-review" : "confirmed",
        expected: appRecord.expectedSurface,
        observedOutcome: observed.outcome,
        observedUrl: await currentUrlPath(),
        screenshot: path.basename(shot),
        note: `Resolved app path via AppDefinition. Collected ${navLinks.length} nav links.`,
      });
    } catch (error) {
      results.push(brokenResult(appRecord, appPath, errorText(error)));
    }
  }

  for (const record of records) {
    if (record.id === appRecord?.id) continue; // already handled above

    // VERIFY entries that have a concrete path.
    if (record.path) {
      results.push(await verifyEntry(opts.targetOrg, record, sessionId));
      continue;
    }

    // DISCOVER candidate entries without a path via nav-label match.
    const navLabel = record.discoveryHint?.navLabel;
    const match = navLabel ? matchNavLink(navLinks, navLabel) : undefined;
    if (match) {
      results.push({
        id: record.id,
        label: record.label,
        surface: record.surface,
        status: record.status,
        path: match.href,
        outcome: "proposed",
        expected: record.expectedSurface,
        note: `Proposed from in-app nav link '${match.label}'. Re-run to verify after promotion.`,
      });
    } else {
      results.push({
        id: record.id,
        label: record.label,
        surface: record.surface,
        status: record.status,
        path: "",
        outcome: "needs-review",
        expected: record.expectedSurface,
        note: navLabel
          ? `No in-app nav link matched '${navLabel}'. Open the app screenshot and confirm the tab label.`
          : "No path and no discovery hint; add a hint or a path.",
      });
    }
  }

  // DISCOVER setup-node children from the Data Cloud Setup Home left nav.
  // These are real /lightning/setup/... anchors (reliable, unlike JS app tabs),
  // so they are proposed as setup-node entries the human can promote directly.
  results.push(...(await discoverSetupNodes(opts.targetOrg)));

  if (opts.mutate) {
    results.push(await runMutationLifecycle(opts.targetOrg, sessionId));
  }

  writeReport(evidenceDir, opts, results);
  printSummary(results, evidenceDir);
}

/**
 * Open the Data Cloud Setup Home and collect its left-nav setup-node links.
 * Generic platform nodes and ids already in the pack are skipped so proposals
 * are net-new Data Cloud settings entries.
 */
async function discoverSetupNodes(targetOrg: string): Promise<EntryResult[]> {
  const generic = new Set([
    "home",
    "data-cloud-setup-home",
    "object-manager",
    "permission-sets",
    "users",
  ]);
  try {
    await openPath(targetOrg, "/lightning/setup/CDPSetupHome/home");
    await waitAndClassify("navigation-ready");
    const links = await collectSetupNodeLinks();
    const out: EntryResult[] = [];
    for (const link of links) {
      const id = idFromLabel(link.label);
      if (!id || generic.has(id) || getDataCloudDestination(id)) continue;
      if (out.some((r) => r.id === id)) continue;
      out.push({
        id,
        label: link.label,
        surface: "setup-node",
        status: "candidate",
        path: link.href,
        outcome: "proposed",
        expected: "Lightning Setup page",
        note: "Discovered from Data Cloud Setup Home left nav. Promote to verified and re-run.",
      });
    }
    return out;
  } catch (error) {
    return [
      {
        id: "setup-node-discovery",
        label: "Setup node discovery",
        surface: "setup-node",
        status: "candidate",
        path: "",
        outcome: "broken",
        expected: "Lightning Setup page",
        note: errorText(error),
      },
    ];
  }
}

async function collectSetupNodeLinks(): Promise<Array<{ label: string; href: string }>> {
  const collector = `(() => {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/lightning/setup/"]')) {
      const label = (a.getAttribute('title') || a.textContent || '').trim().replace(/\\s+/g, ' ');
      const href = a.getAttribute('href') || '';
      if (!label || !href || seen.has(label)) continue;
      seen.add(label);
      out.push({ label, href });
    }
    return JSON.stringify(out.slice(0, 200));
  })()`;
  try {
    const result = await runAgentBrowser(pi, ["eval", collector], {
      cwd: ctx.cwd,
      timeoutMs: 20_000,
    });
    const parsed = safeJson<Array<{ label: string; href: string }>>(result.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function idFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function verifyEntry(
  targetOrg: string,
  record: DataCloudDestinationRecord,
  sessionId: string,
): Promise<EntryResult> {
  try {
    await openPath(targetOrg, record.path);
    const observed = await waitAndClassify(record.suggestedWait.lightning);
    const shot = await screenshot(record.id, sessionId);
    const observedUrl = await currentUrlPath();
    const reachable = observed.outcome !== "ambiguous";
    return {
      id: record.id,
      label: record.label,
      surface: record.surface,
      status: record.status,
      path: record.path,
      outcome: reachable ? "confirmed" : "needs-review",
      expected: record.expectedSurface,
      observedOutcome: observed.outcome,
      observedUrl,
      screenshot: path.basename(shot),
      note: reachable
        ? undefined
        : "Lightning wait stayed ambiguous; inspect the screenshot before trusting this path.",
    };
  } catch (error) {
    return brokenResult(record, record.path, errorText(error));
  }
}

/**
 * One representative safe, reversible mutation lifecycle:
 *   navigate to the Data Spaces settings node (a known mutable surface) ->
 *   before evidence -> click "New" to open the create form -> after evidence ->
 *   press Escape to cancel. Nothing is saved, so org state is unchanged.
 * Use a disposable, safe-to-mutate sandbox/dev org as the testbed for this.
 */
async function runMutationLifecycle(targetOrg: string, sessionId: string): Promise<EntryResult> {
  const id = "mutation-lifecycle";
  const mutablePath = "/lightning/setup/CdpDataSpaces/home";
  try {
    await openPath(targetOrg, mutablePath);
    await waitAndClassify("navigation-ready");
    const before = await screenshot(`${id}-1-before`, sessionId);

    // Click the first visible "New" affordance by text (no CSS guessing).
    const clicked = await runAgentBrowser(
      pi,
      [
        "eval",
        `(() => { const el = Array.from(document.querySelectorAll('button,a,[role="button"]')).find(e => /^\\s*new\\s*$/i.test((e.textContent||'').trim())); if (!el) return 'not-found'; el.click(); return 'clicked'; })()`,
      ],
      { cwd: ctx.cwd, timeoutMs: 15_000 },
    );
    const clickOutcome = (safeJson<string>(clicked.stdout) ?? clicked.stdout).toString().trim();

    const formState = await waitAndClassify("modal-open");
    const after = await screenshot(`${id}-2-form`, sessionId);

    // Cancel without saving. Escape closes the Salesforce create modal.
    await runAgentBrowser(pi, ["press", "Escape"], { cwd: ctx.cwd, timeoutMs: 10_000 });
    const closed = await waitAndClassify("modal-closed");
    const final = await screenshot(`${id}-3-cancelled`, sessionId);

    const reversible = closed.outcome === "modal-closed";
    return {
      id,
      label: "Mutation lifecycle (Data Spaces, no-save)",
      surface: "builder-page",
      status: "candidate",
      path: mutablePath,
      outcome: clickOutcome === "clicked" && reversible ? "confirmed" : "needs-review",
      expected: "Unknown Salesforce page",
      observedOutcome: `new:${clickOutcome} form:${formState.outcome} closed:${closed.outcome}`,
      screenshot: path.basename(after),
      note: `Reversible lifecycle on Data Spaces. Evidence: ${path.basename(before)} -> ${path.basename(after)} -> ${path.basename(final)}. No save performed; org state unchanged.`,
    };
  } catch (error) {
    return {
      id,
      label: "Mutation lifecycle (Data Spaces, no-save)",
      surface: "builder-page",
      status: "candidate",
      path: mutablePath,
      outcome: "broken",
      expected: "Unknown Salesforce page",
      note: errorText(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Report + summary
// ---------------------------------------------------------------------------

function writeReport(evidenceDir: string, opts: HarnessOptions, results: EntryResult[]): void {
  const mdPath = path.join(evidenceDir, "report.md");
  const htmlPath = path.join(evidenceDir, "report.html");
  writeFileSync(mdPath, renderMarkdown(opts, results));
  writeFileSync(htmlPath, renderHtml(opts, results));
}

function renderMarkdown(opts: HarnessOptions, results: EntryResult[]): string {
  const lines = [
    `# SF Browser pack hardening — ${opts.pack}`,
    ``,
    `Org: ${opts.targetOrg}  ·  Generated: ${new Date().toISOString()}`,
    ``,
    `| id | surface | outcome | observed | path | note |`,
    `| --- | --- | --- | --- | --- | --- |`,
  ];
  for (const r of results) {
    lines.push(
      `| ${r.id} | ${r.surface} | ${r.outcome} | ${r.observedOutcome ?? ""} | ${r.path || ""} | ${(r.note ?? "").replace(/\|/g, "\\|")} |`,
    );
  }
  return lines.join("\n") + "\n";
}

function renderHtml(opts: HarnessOptions, results: EntryResult[]): string {
  const cards = results
    .map((r) => {
      const img = r.screenshot
        ? `<img src="${r.screenshot}" alt="${r.id}" loading="lazy" />`
        : `<div class="noimg">no screenshot</div>`;
      return `<figure class="card ${r.outcome}">
        ${img}
        <figcaption>
          <strong>${r.id}</strong> <span class="badge">${r.outcome}</span><br/>
          <small>${r.surface} · observed: ${r.observedOutcome ?? "—"}</small><br/>
          <code>${r.path || "(no path)"}</code>
          ${r.note ? `<p>${escapeHtml(r.note)}</p>` : ""}
        </figcaption>
      </figure>`;
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>SF Browser pack hardening — ${opts.pack}</title>
<style>
  body { font: 14px/1.4 -apple-system, system-ui, sans-serif; margin: 24px; background: #0b1021; color: #e6e9f5; }
  h1 { font-size: 18px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
  .card { margin: 0; background: #161c33; border-radius: 10px; overflow: hidden; border: 1px solid #263056; }
  .card img { width: 100%; display: block; border-bottom: 1px solid #263056; }
  .noimg { padding: 40px; text-align: center; color: #8893b8; }
  figcaption { padding: 10px 12px; }
  code { color: #9ad; word-break: break-all; }
  .badge { float: right; font-size: 11px; padding: 1px 8px; border-radius: 10px; background: #334; }
  .confirmed .badge { background: #1f7a4d; }
  .broken .badge { background: #a23; }
  .proposed .badge { background: #2a5fa3; }
  .needs-review .badge { background: #9a7d1f; }
  p { color: #b9c0db; font-size: 12px; }
</style></head><body>
<h1>SF Browser pack hardening — ${opts.pack}</h1>
<p>Org: ${escapeHtml(opts.targetOrg)} · Generated: ${new Date().toISOString()}</p>
<div class="grid">${cards}</div>
</body></html>`;
}

function printSummary(results: EntryResult[], evidenceDir: string): void {
  const by = (o: EntryResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  console.log(`\nResults: ${results.length} entries`);
  console.log(
    `  confirmed=${by("confirmed")} proposed=${by("proposed")} needs-review=${by("needs-review")} broken=${by("broken")}`,
  );
  console.log(`\nReport: ${path.join(evidenceDir, "report.html")}`);

  const proposals = results.filter((r) => r.outcome === "proposed" || r.outcome === "confirmed");
  if (proposals.length) {
    console.log(`\nPack proposal (review, then promote to status:"verified" with these paths):`);
    for (const r of proposals) {
      console.log(`  ${r.id.padEnd(22)} ${r.path}`);
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function brokenResult(
  record: DataCloudDestinationRecord,
  pathValue: string,
  note: string,
): EntryResult {
  return {
    id: record.id,
    label: record.label,
    surface: record.surface,
    status: record.status,
    path: pathValue,
    outcome: "broken",
    expected: record.expectedSurface,
    note,
  };
}

function matchNavLink(
  links: Array<{ label: string; href: string }>,
  navLabel: string,
): { label: string; href: string } | undefined {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(navLabel);
  return links.find((l) => norm(l.label) === target || norm(l.label).includes(target));
}

function safeJson<T = { outcome?: string; matched?: { url?: string } }>(
  raw: string,
): T | undefined {
  // agent-browser eval JSON-encodes its result. Our expressions already return
  // a JSON string, so the output is doubly-encoded: the first parse yields the
  // inner JSON string, the second yields the object. Unwrap until not a string.
  try {
    let value: unknown = JSON.parse(raw);
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        // first parse already produced the final string payload
      }
    }
    return value as T;
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
