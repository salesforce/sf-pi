/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Navigation Hardening Harness for SF Browser.
 *
 * Covers every navigation surface, selected with --surface (default all):
 *   - data-cloud         : the Data Cloud Destination Pack (verify + discover)
 *   - setup-destinations : the curated Setup Destination list (open + confirm)
 *   - routes             : structured route templates (home, object-list,
 *                          object-new, and sampled record-view / list-view /
 *                          record-related-list)
 *   - public-tools       : registered resolve → open → wait → snapshot lifecycle
 *                          using the model-facing schemas
 *   - chrome-navigation  : Setup category/item, top-right Setup, App Launcher,
 *                          and verified Lightning-app navigation
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
 *   node --experimental-strip-types scripts/e2e/sf-browser-pack-harden.ts --org <alias> --surface public-tools --classic-toggle
 *
 * See ADR 0030 and the CONTEXT.md term Navigation Hardening Harness.
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { findLatestBrowserSnapshotSession } from "../../lib/common/sf-browser-snapshot-state.ts";

import { connectSalesforce, type SalesforceSession } from "../../lib/common/sf-conn/index.ts";
import { runAgentBrowser } from "../../extensions/sf-browser/lib/agent-browser.ts";
import { findExpansionControlByLabel } from "../../extensions/sf-browser/lib/expanded-control.ts";
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
import { openOrgInAgentBrowser } from "../../extensions/sf-browser/lib/operations.ts";
import { registerSfBrowserNavigateSetupTool } from "../../extensions/sf-browser/lib/sf_browser_navigate_setup-tool.ts";
import { registerSfBrowserOpenOrgTool } from "../../extensions/sf-browser/lib/sf_browser_open_org-tool.ts";
import { registerSfBrowserResolvePathTool } from "../../extensions/sf-browser/lib/sf_browser_resolve_path-tool.ts";
import { registerSfBrowserSetExpandedTool } from "../../extensions/sf-browser/lib/sf_browser_set_expanded-tool.ts";
import { registerSfBrowserSetToggleTool } from "../../extensions/sf-browser/lib/sf_browser_set_toggle-tool.ts";
import { registerSfBrowserSnapshotTool } from "../../extensions/sf-browser/lib/sf_browser_snapshot-tool.ts";
import { registerSfBrowserWaitTool } from "../../extensions/sf-browser/lib/sf_browser_wait-tool.ts";
import type { SalesforceRoute } from "../../extensions/sf-browser/lib/salesforce-path-resolver.ts";
import { findSetupCategory } from "../../extensions/sf-browser/lib/setup-navigation.ts";
import { findToggleInSnapshot } from "../../extensions/sf-browser/lib/toggle-control.ts";
import { resolveVerifiedRoutePath } from "../../extensions/sf-browser/lib/salesforce-route-verifier.ts";
import { knownSetupDestinationRecords } from "../../extensions/sf-browser/lib/setup-destinations.ts";
import { markdownTableCell } from "../lib/text-escape.mjs";

// ---------------------------------------------------------------------------
// Thin pi/ctx shims so we can reuse the SF Browser lib without a live pi host.
// The lib only needs pi.exec(cmd, args, { cwd, signal, timeout }) and ctx.cwd.
// ---------------------------------------------------------------------------

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

let activeHarnessBrowserSession: string | undefined;

function makeExec() {
  return (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; signal?: AbortSignal; timeout?: number },
  ): Promise<ExecResult> =>
    new Promise((resolve) => {
      const effectiveArgs =
        cmd === "agent-browser" && activeHarnessBrowserSession
          ? rewriteAgentBrowserSession(args, activeHarnessBrowserSession)
          : args;
      const child = spawn(cmd, effectiveArgs, { cwd: opts?.cwd ?? process.cwd() });
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

function rewriteAgentBrowserSession(args: string[], sessionName: string): string[] {
  const rewritten = [...args];
  for (const option of ["--session", "--session-name"]) {
    const index = rewritten.indexOf(option);
    if (index >= 0 && index + 1 < rewritten.length) rewritten[index + 1] = sessionName;
  }
  return rewritten;
}

const pi = { exec: makeExec() } as unknown as ExtensionAPI;
const ctx = { cwd: process.cwd() } as unknown as ExtensionContext;

interface PublicToolResult {
  content?: Array<{ type: string; text?: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}

interface PublicToolDefinition {
  name: string;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: ExtensionContext,
  ): Promise<PublicToolResult>;
}

function registerPublicBrowserTools(): {
  host: ExtensionAPI;
  tools: Map<string, PublicToolDefinition>;
} {
  const tools = new Map<string, PublicToolDefinition>();
  const host = {
    exec: makeExec(),
    registerTool(definition: PublicToolDefinition) {
      tools.set(definition.name, definition);
    },
  } as unknown as ExtensionAPI;
  registerSfBrowserOpenOrgTool(host);
  registerSfBrowserNavigateSetupTool(host);
  registerSfBrowserResolvePathTool(host);
  registerSfBrowserWaitTool(host);
  registerSfBrowserSnapshotTool(host);
  registerSfBrowserSetExpandedTool(host);
  registerSfBrowserSetToggleTool(host);
  return { host, tools };
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

type Surface =
  "data-cloud" | "setup-destinations" | "routes" | "public-tools" | "chrome-navigation";
const ALL_SURFACES: Surface[] = [
  "data-cloud",
  "setup-destinations",
  "routes",
  "public-tools",
  "chrome-navigation",
];

interface HarnessOptions {
  targetOrg: string;
  surfaces: Surface[];
  object: string;
  mutate: boolean;
  classicToggle: boolean;
  limit?: number;
  publicPath?: string;
}

function parseArgs(argv: string[]): HarnessOptions {
  const opts: Partial<HarnessOptions> = {
    mutate: false,
    classicToggle: false,
    object: "Account",
  };
  let surface = "all";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--org" || arg === "--target-org") opts.targetOrg = argv[++i];
    else if (arg === "--surface") surface = argv[++i];
    else if (arg === "--pack")
      surface = argv[++i]; // back-compat alias (e.g. --pack data-cloud)
    else if (arg === "--object") opts.object = argv[++i];
    else if (arg === "--mutate") opts.mutate = true;
    else if (arg === "--classic-toggle") opts.classicToggle = true;
    else if (arg === "--limit") opts.limit = Number(argv[++i]);
    else if (arg === "--public-path") opts.publicPath = argv[++i];
    else if (!arg.startsWith("--") && !opts.targetOrg) opts.targetOrg = arg;
  }
  if (!opts.targetOrg) {
    throw new Error(
      "Usage: sf-browser-pack-harden --org <alias> [--surface all|data-cloud|setup-destinations|routes|public-tools|chrome-navigation] [--object <ApiName>] [--public-path </lightning/...>] [--mutate] [--classic-toggle] [--limit N]",
    );
  }
  opts.surfaces =
    surface === "all"
      ? [...ALL_SURFACES]
      : (surface.split(",").map((s) => s.trim()) as Surface[]).filter((s) =>
          ALL_SURFACES.includes(s),
        );
  if (!opts.surfaces.length) {
    throw new Error(
      `Unknown surface ${JSON.stringify(surface)}. Use all, ${ALL_SURFACES.join(", ")}.`,
    );
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
  /** Which suite produced this row: data-cloud | setup-destination | route | mutation. */
  group: string;
  status: DataCloudDestinationRecord["status"];
  path: string;
  outcome: "confirmed" | "broken" | "proposed" | "needs-review" | "skipped";
  expected: string;
  observedOutcome?: string;
  observedUrl?: string;
  screenshot?: string;
  note?: string;
};

/** Generic navigable check shared by every suite. */
interface NavCheck {
  id: string;
  label: string;
  surface: string;
  path: string;
  waitMode: LightningWaitModeValue;
  expectedSurface: string;
  group: string;
  status?: DataCloudDestinationRecord["status"];
}

// ---------------------------------------------------------------------------
// Browser steps (reuse the real SF Browser lib path)
// ---------------------------------------------------------------------------

async function openPath(targetOrg: string, pathValue: string): Promise<void> {
  await openOrgInAgentBrowser(
    pi,
    {
      cwd: ctx.cwd,
      sessionManager: { getSessionId: () => activeHarnessBrowserSession ?? "sf-browser-harden" },
    } as unknown as ExtensionContext,
    { target_org: targetOrg, target: { type: "path", path: pathValue } },
  );
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

function urlPath(value: string): string | undefined {
  try {
    return new URL(value, "https://sf-pi.invalid").pathname;
  } catch {
    return undefined;
  }
}

async function currentUrlValue(): Promise<string | undefined> {
  try {
    const result = await runAgentBrowser(pi, ["get", "url"], {
      cwd: ctx.cwd,
      timeoutMs: 15_000,
    });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function currentUrlPath(): Promise<string | undefined> {
  const current = await currentUrlValue();
  return current ? urlPath(current) : undefined;
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
    const conn = await connectSalesforce({ cwd: process.cwd(), targetOrg });
    const result = await conn.query<{ DurableId?: string }>({
      soql: `SELECT DurableId FROM AppDefinition WHERE DeveloperName = '${appDevName.replace(/'/g, "")}' LIMIT 1`,
      api: "rest",
      maxRows: 1,
    });
    const durableId = result.records[0]?.DurableId;
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
  const sessionId = `harden-${timestamp()}`;
  activeHarnessBrowserSession = sessionId;
  const evidenceDir = getEvidenceDir(sessionId);
  mkdirSync(evidenceDir, { recursive: true });
  const results: EntryResult[] = [];

  console.log(
    `SF Browser navigation hardening — surfaces=${opts.surfaces.join(",")} org=${opts.targetOrg}`,
  );
  console.log(`Evidence dir: ${evidenceDir}\n`);

  const want = (s: Surface) => opts.surfaces.includes(s);
  if (want("data-cloud")) {
    results.push(...(await runDataCloudSuite(opts.targetOrg, sessionId, opts.limit)));
  }
  if (want("setup-destinations")) {
    results.push(...(await runSetupDestinationsSuite(opts.targetOrg, sessionId, opts.limit)));
  }
  if (want("routes")) {
    results.push(...(await runRoutesSuite(opts.targetOrg, sessionId, opts.object)));
  }
  if (want("public-tools")) {
    results.push(await runPublicToolsSuite(opts.targetOrg, sessionId, opts.publicPath));
  }
  if (want("chrome-navigation")) {
    results.push(...(await runChromeNavigationSuite(opts.targetOrg, sessionId, opts.limit)));
  }
  if (opts.mutate) results.push(await runMutationLifecycle(opts.targetOrg, sessionId));
  if (opts.mutate || opts.classicToggle) {
    results.push(await runClassicToggleLifecycle(opts.targetOrg, sessionId));
  }

  writeReport(evidenceDir, opts, results);
  printSummary(results, evidenceDir);
  try {
    await runAgentBrowser(pi, ["close"], { cwd: ctx.cwd, timeoutMs: 15_000 });
  } catch {
    // The report is authoritative; best-effort isolated browser cleanup must not mask it.
  } finally {
    activeHarnessBrowserSession = undefined;
  }
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

async function runPublicToolsSuite(
  targetOrg: string,
  sessionId: string,
  publicPath?: string,
): Promise<EntryResult> {
  const { tools } = registerPublicBrowserTools();
  const execute = async (
    name: string,
    params: Record<string, unknown>,
  ): Promise<PublicToolResult> => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Public SF Browser tool ${name} was not registered.`);
    const result = await tool.execute(`harden-${name}`, params, undefined, undefined, {
      cwd: process.cwd(),
      sessionManager: { getSessionId: () => sessionId },
    } as unknown as ExtensionContext);
    if (result.isError || result.details?.ok === false) {
      const text = result.content
        ?.map((item) => item.text ?? "")
        .join("\n")
        .trim();
      throw new Error(text || `${name} returned an unsuccessful result.`);
    }
    return result;
  };

  const expectedPath = publicPath ?? "/lightning/setup/SetupOneHome/home";
  const base = {
    id: publicPath ? "public-tools-candidate-path" : "public-tools-setup-home",
    label: publicPath
      ? "Public tool lifecycle — Candidate Path"
      : "Public tool lifecycle — Setup Home",
    surface: "setup-node",
    group: "public-tools",
    status: "verified" as const,
    path: expectedPath,
    expected: "Registered tools resolve, open, wait, and snapshot through model-facing schemas",
  };
  try {
    const target = publicPath
      ? ({ type: "path", path: publicPath } as const)
      : ({ type: "setup", destination: "setup-home" } as const);
    const resolved = await execute("sf_browser_resolve_path", { target });
    if (resolved.details?.path !== base.path) {
      throw new Error(`resolve_path returned ${String(resolved.details?.path)}.`);
    }
    const opened = await execute("sf_browser_open_org", {
      target_org: targetOrg,
      target,
      purpose: "SF Browser public-tool hardening",
    });
    if (opened.details?.path !== base.path) {
      throw new Error(`open_org returned ${String(opened.details?.path)}.`);
    }
    const waited = await execute("sf_browser_wait", {
      condition: { type: "lightning", value: "navigation-ready" },
      checkpointEvidence: false,
    });
    const snapshot = await execute("sf_browser_snapshot", {
      interactive: true,
      compact: true,
      maxDepth: 8,
      outputMode: "summary",
      focus: ["Setup", "Quick Find", "Object Manager", "MCP Servers"],
    });
    const observedUrl = String(snapshot.details?.currentUrl ?? "");
    if (urlPath(observedUrl) !== expectedPath) {
      throw new Error(`snapshot observed ${urlPath(observedUrl) ?? "no path"}.`);
    }
    const shot = await screenshot(base.id, sessionId);
    return {
      ...base,
      outcome: "confirmed",
      observedOutcome: String(waited.details?.status ?? "matched"),
      observedUrl,
      screenshot: path.basename(shot),
      note: `Public registerTool interfaces completed resolve → open → wait → snapshot using ${String(opened.details?.openMethod ?? "unknown open method")} (open ${String(opened.details?.durationText ?? "n/a")}; snapshot ${String(snapshot.details?.durationText ?? "n/a")}; classic polls ${String(snapshot.details?.classicSetupPolls ?? 0)}).`,
    };
  } catch (error) {
    return { ...base, outcome: "broken", note: errorText(error) };
  }
}

async function runChromeNavigationSuite(
  targetOrg: string,
  sessionId: string,
  limit?: number,
): Promise<EntryResult[]> {
  const { tools } = registerPublicBrowserTools();
  const context = {
    cwd: process.cwd(),
    sessionManager: { getSessionId: () => sessionId },
  } as unknown as ExtensionContext;
  const execute = async (
    name: string,
    params: Record<string, unknown>,
  ): Promise<PublicToolResult> => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Public SF Browser tool ${name} was not registered.`);
    const result = await tool.execute(
      `harden-${name}-${Date.now()}`,
      params,
      undefined,
      undefined,
      context,
    );
    if (result.isError || result.details?.ok === false) {
      const text = result.content
        ?.map((item) => item.text ?? "")
        .join("\n")
        .trim();
      throw new Error(text || `${name} returned an unsuccessful result.`);
    }
    return result;
  };

  const results: EntryResult[] = [];
  const categories = [
    "Custom Code",
    "Development",
    "Scale",
    "Environments",
    "User Engagement",
    "Data Mask",
    "Identity",
    "Security",
  ].slice(0, limit ?? Infinity);
  for (const label of categories) {
    const id = `chrome-category-${idFromLabel(label)}`;
    try {
      await execute("sf_browser_navigate_setup", {
        target_org: targetOrg,
        target: { type: "category", label, desiredState: true },
      });
      const expandedSession = findLatestBrowserSnapshotSession(sessionId);
      const expandedSnapshot = expandedSession?.fullSnapshotPath
        ? readFileSync(expandedSession.fullSnapshotPath, "utf8")
        : "";
      const category = findSetupCategory(expandedSnapshot, label);
      if (!category?.treeRef) throw new Error(`${label} did not publish a fresh tree-item ref.`);
      const collapsed = await execute("sf_browser_set_expanded", {
        ref: category.treeRef,
        desiredState: false,
        reason: "Navigation hardening expand/collapse proof",
      });
      const shot = await screenshot(id, sessionId);
      results.push({
        id,
        label: `${label} category expand/collapse`,
        surface: "setup-category",
        group: "chrome-navigation",
        status: "candidate",
        path: "/lightning/setup/SetupOneHome/home",
        outcome: "confirmed",
        expected: "Category expands and collapses through desired-state public tools",
        observedOutcome: `expanded:true collapsed:${String(collapsed.details?.observedState)}`,
        screenshot: path.basename(shot),
      });
    } catch (error) {
      results.push({
        id,
        label: `${label} category expand/collapse`,
        surface: "setup-category",
        group: "chrome-navigation",
        status: "candidate",
        path: "/lightning/setup/SetupOneHome/home",
        outcome: "broken",
        expected: "Category expands and collapses through desired-state public tools",
        note: errorText(error),
      });
    }
  }

  try {
    const item = await execute("sf_browser_navigate_setup", {
      target_org: targetOrg,
      target: { type: "item", label: "Health Check", category: "Security" },
    });
    const shot = await screenshot("chrome-setup-item", sessionId);
    results.push({
      id: "chrome-setup-item",
      label: "Security / Health Check",
      surface: "setup-item",
      group: "chrome-navigation",
      status: "candidate",
      path: String(item.details?.expectedPath ?? ""),
      outcome: "confirmed",
      expected: "Exact Setup child navigation with selected item or URL proof",
      observedOutcome: String(item.details?.status ?? "reached"),
      observedUrl: String(item.details?.observedUrl ?? ""),
      screenshot: path.basename(shot),
    });
  } catch (error) {
    results.push({
      id: "chrome-setup-item",
      label: "Security / Health Check",
      surface: "setup-item",
      group: "chrome-navigation",
      status: "candidate",
      path: "",
      outcome: "broken",
      expected: "Exact Setup child navigation with selected item or URL proof",
      note: errorText(error),
    });
  }

  try {
    const tool = tools.get("sf_browser_navigate_setup");
    if (!tool) throw new Error("Public SF Browser Setup navigation tool was not registered.");
    const missing = await tool.execute(
      `harden-sf_browser_navigate_setup-not-found-${Date.now()}`,
      {
        target_org: targetOrg,
        target: { type: "item", label: "Security Center", category: "Security" },
      },
      undefined,
      undefined,
      context,
    );
    if (missing.details?.status !== "not-found" || missing.isError === true) {
      throw new Error(
        `Expected non-error not-found, observed ${String(missing.details?.status ?? "unknown")}.`,
      );
    }
    const shot = await screenshot("chrome-setup-item-not-found", sessionId);
    results.push({
      id: "chrome-setup-item-not-found",
      label: "Missing Setup item classification",
      surface: "setup-item",
      group: "chrome-navigation",
      status: "candidate",
      path: "",
      outcome: "confirmed",
      expected: "Unavailable exact item returns typed non-error not-found",
      observedOutcome: "not-found",
      screenshot: path.basename(shot),
    });
  } catch (error) {
    results.push({
      id: "chrome-setup-item-not-found",
      label: "Missing Setup item classification",
      surface: "setup-item",
      group: "chrome-navigation",
      status: "candidate",
      path: "",
      outcome: "broken",
      expected: "Unavailable exact item returns typed non-error not-found",
      note: errorText(error),
    });
  }

  try {
    const entry = await execute("sf_browser_navigate_setup", {
      target_org: targetOrg,
      target: { type: "global-entry", label: "Setup" },
    });
    const shot = await screenshot("chrome-global-setup-entry", sessionId);
    results.push({
      id: "chrome-global-setup-entry",
      label: "Top-right Setup entry",
      surface: "global-navigation",
      group: "chrome-navigation",
      status: "candidate",
      path: String(entry.details?.expectedPath ?? ""),
      outcome: "confirmed",
      expected: "Top-right Setup menu entry reaches its observed href",
      observedOutcome: String(entry.details?.status ?? "reached"),
      observedUrl: String(entry.details?.observedUrl ?? ""),
      screenshot: path.basename(shot),
    });
  } catch (error) {
    results.push({
      id: "chrome-global-setup-entry",
      label: "Top-right Setup entry",
      surface: "global-navigation",
      group: "chrome-navigation",
      status: "candidate",
      path: "",
      outcome: "broken",
      expected: "Top-right Setup menu entry reaches its observed href",
      note: errorText(error),
    });
  }

  try {
    await execute("sf_browser_open_org", {
      target_org: targetOrg,
      target: { type: "setup", destination: "setup-home" },
      purpose: "App Launcher desired-state hardening",
    });
    await execute("sf_browser_wait", {
      condition: { type: "lightning", value: "navigation-ready" },
      checkpointEvidence: false,
    });
    await execute("sf_browser_snapshot", {
      interactive: true,
      compact: true,
      outputMode: "summary",
      focus: ["App Launcher", "Setup"],
    });
    const launcherSession = findLatestBrowserSnapshotSession(sessionId);
    const launcherSnapshot = launcherSession?.fullSnapshotPath
      ? readFileSync(launcherSession.fullSnapshotPath, "utf8")
      : "";
    const launcher = findExpansionControlByLabel(launcherSnapshot, "App Launcher", "button");
    if (!launcher) throw new Error("App Launcher did not publish an expandable button ref.");
    await execute("sf_browser_set_expanded", { ref: launcher.targetRef, desiredState: true });
    const openedSession = findLatestBrowserSnapshotSession(sessionId);
    const openedSnapshot = openedSession?.fullSnapshotPath
      ? readFileSync(openedSession.fullSnapshotPath, "utf8")
      : "";
    const openedLauncher = findExpansionControlByLabel(openedSnapshot, "App Launcher", "button");
    if (!openedLauncher) throw new Error("Open App Launcher did not publish a fresh ref.");
    const closed = await execute("sf_browser_set_expanded", {
      ref: openedLauncher.targetRef,
      desiredState: false,
    });
    const shot = await screenshot("chrome-app-launcher", sessionId);
    results.push({
      id: "chrome-app-launcher",
      label: "App Launcher expand/collapse",
      surface: "global-navigation",
      group: "chrome-navigation",
      status: "candidate",
      path: "/lightning/setup/SetupOneHome/home",
      outcome: "confirmed",
      expected: "App Launcher opens and closes through desired-state public tools",
      observedOutcome: `expanded:true collapsed:${String(closed.details?.observedState)}`,
      screenshot: path.basename(shot),
    });
  } catch (error) {
    results.push({
      id: "chrome-app-launcher",
      label: "App Launcher expand/collapse",
      surface: "global-navigation",
      group: "chrome-navigation",
      status: "candidate",
      path: "/lightning/setup/SetupOneHome/home",
      outcome: "broken",
      expected: "App Launcher opens and closes through desired-state public tools",
      note: errorText(error),
    });
  }

  try {
    const app = await execute("sf_browser_open_org", {
      target_org: targetOrg,
      target: { type: "lightning-app", appDeveloperName: "AppLauncher" },
      purpose: "Verified Lightning app route hardening",
    });
    await execute("sf_browser_wait", {
      condition: { type: "lightning", value: "app-ready" },
      checkpointEvidence: false,
    });
    const snapshot = await execute("sf_browser_snapshot", {
      interactive: true,
      compact: true,
      outputMode: "summary",
      focus: ["App Launcher"],
    });
    const shot = await screenshot("chrome-lightning-app", sessionId);
    results.push({
      id: "chrome-lightning-app",
      label: "Verified Lightning app route",
      surface: "lightning-app",
      group: "chrome-navigation",
      status: "candidate",
      path: String(app.details?.path ?? ""),
      outcome: "confirmed",
      expected: "AppDefinition-verified route reaches an app-ready surface",
      observedUrl: String(snapshot.details?.currentUrl ?? ""),
      screenshot: path.basename(shot),
    });
  } catch (error) {
    results.push({
      id: "chrome-lightning-app",
      label: "Verified Lightning app route",
      surface: "lightning-app",
      group: "chrome-navigation",
      status: "candidate",
      path: "",
      outcome: "broken",
      expected: "AppDefinition-verified route reaches an app-ready surface",
      note: errorText(error),
    });
  }

  return results;
}

/** Generic open -> wait -> screenshot -> classify, shared by every suite. */
async function verifyNav(
  targetOrg: string,
  sessionId: string,
  check: NavCheck,
): Promise<EntryResult> {
  const base = {
    id: check.id,
    label: check.label,
    surface: check.surface,
    group: check.group,
    status: check.status ?? ("verified" as const),
    path: check.path,
    expected: check.expectedSurface,
  };
  try {
    await openPath(targetOrg, check.path);
    const observed = await waitAndClassify(check.waitMode);
    const shot = await screenshot(check.id, sessionId);
    const currentUrl = await currentUrlValue();
    const observedPath = currentUrl ? urlPath(currentUrl) : undefined;
    const correctPath = observedPath === urlPath(check.path);
    const reachable = observed.outcome !== "ambiguous" && correctPath;
    return {
      ...base,
      outcome: reachable ? "confirmed" : correctPath ? "needs-review" : "broken",
      observedOutcome: observed.outcome,
      observedUrl: observedPath,
      screenshot: path.basename(shot),
      note: !correctPath
        ? `Observed ${observedPath ?? "no path"}.`
        : reachable
          ? undefined
          : "Lightning wait stayed ambiguous; inspect the screenshot before trusting this path.",
    };
  } catch (error) {
    return { ...base, outcome: "broken", note: errorText(error) };
  }
}

/** Curated Setup Destinations: open each known path and confirm it renders. */
async function runSetupDestinationsSuite(
  targetOrg: string,
  sessionId: string,
  limit?: number,
): Promise<EntryResult[]> {
  const records = knownSetupDestinationRecords().slice(0, limit ?? Infinity);
  const out: EntryResult[] = [];
  for (const d of records) {
    const check: NavCheck = {
      id: `setup-${d.id}`,
      label: d.label,
      surface: "setup-node",
      path: d.path,
      waitMode: d.suggestedWait.lightning,
      expectedSurface: d.expectedSurface,
      group: "setup-destination",
    };
    const first = await verifyNav(targetOrg, sessionId, check);
    if (first.outcome !== "broken") {
      out.push(first);
      continue;
    }
    const retried = await verifyNav(targetOrg, sessionId, check);
    out.push({
      ...retried,
      note:
        retried.outcome === "confirmed"
          ? `Recovered after one bounded retry. First attempt: ${first.note ?? "broken"}`
          : retried.note,
    });
  }
  return out;
}

/** Structured routes: open template routes, sampling live data where needed. */
async function runRoutesSuite(
  targetOrg: string,
  sessionId: string,
  object: string,
): Promise<EntryResult[]> {
  const out: EntryResult[] = [];
  const G = "route";

  out.push(
    await verifyNav(targetOrg, sessionId, {
      id: "route-home",
      label: "Home",
      surface: "home",
      path: "/lightning/page/home",
      waitMode: "app-ready",
      expectedSurface: "Lightning home page",
      group: G,
    }),
  );
  out.push(
    await verifyRoute(
      targetOrg,
      sessionId,
      "route-object-list",
      `Object list (${object})`,
      { type: "object-list", objectApiName: object },
      "app-ready",
      G,
    ),
  );
  out.push(
    await verifyRoute(
      targetOrg,
      sessionId,
      "route-object-new",
      `New ${object}`,
      { type: "object-new", objectApiName: object },
      "navigation-ready",
      G,
    ),
  );

  // Routes that need live data: sample from the org, skip cleanly if absent.
  const conn = await connectSalesforce({ cwd: process.cwd(), targetOrg });
  const recordId = await sampleRecordId(conn, object);
  out.push(
    recordId
      ? await verifyRoute(
          targetOrg,
          sessionId,
          "route-record-view",
          `${object} record view`,
          { type: "record-view", objectApiName: object, recordId },
          "record-view",
          G,
        )
      : skippedRoute("route-record-view", `No ${object} record to sample`, G),
  );

  const listView = await sampleListView(conn, object);
  out.push(
    listView
      ? await verifyRoute(
          targetOrg,
          sessionId,
          "route-list-view",
          `${object} list view`,
          { type: "list-view", objectApiName: object, filterName: listView },
          "app-ready",
          G,
        )
      : skippedRoute("route-list-view", `No list view found for ${object}`, G),
  );

  const related = await sampleRelatedList(conn, object);
  out.push(
    recordId && related
      ? await verifyRoute(
          targetOrg,
          sessionId,
          "route-related-list",
          `${object} related list`,
          {
            type: "record-related-list",
            objectApiName: object,
            recordId,
            relatedListApiName: related,
          },
          "app-ready",
          G,
        )
      : skippedRoute("route-related-list", `No related list / record to sample for ${object}`, G),
  );

  return out;
}

/** Resolve a structured route to a verified path, then open + classify it. */
async function verifyRoute(
  targetOrg: string,
  sessionId: string,
  id: string,
  label: string,
  route: SalesforceRoute,
  waitMode: LightningWaitModeValue,
  group: string,
): Promise<EntryResult> {
  try {
    const verified = await resolveVerifiedRoutePath(targetOrg, route, process.cwd());
    return await verifyNav(targetOrg, sessionId, {
      id,
      label,
      surface: route.type,
      path: verified.path,
      waitMode,
      expectedSurface: "Lightning page",
      group,
    });
  } catch (error) {
    return {
      id,
      label,
      surface: route.type,
      group,
      status: "verified",
      path: "",
      outcome: "broken",
      expected: "Lightning page",
      note: errorText(error),
    };
  }
}

function skippedRoute(id: string, note: string, group: string): EntryResult {
  return {
    id,
    label: id,
    surface: "route",
    group,
    status: "candidate",
    path: "",
    outcome: "skipped",
    expected: "Lightning page",
    note,
  };
}

async function sampleRecordId(
  conn: SalesforceSession,
  object: string,
): Promise<string | undefined> {
  try {
    const result = await conn.query<{ Id?: string }>({
      soql: `SELECT Id FROM ${object} LIMIT 1`,
      maxRows: 1,
    });
    return result.records[0]?.Id;
  } catch {
    return undefined;
  }
}

async function sampleListView(
  conn: SalesforceSession,
  object: string,
): Promise<string | undefined> {
  try {
    const response = await conn.request<{
      lists?: Array<{ id?: string; apiName?: string; developerName?: string }>;
    }>({ method: "GET", path: `/ui-api/list-info/${object}`, query: { pageSize: 5 } });
    const first = response.body.lists?.[0];
    return first?.apiName || first?.developerName || first?.id || undefined;
  } catch {
    return undefined;
  }
}

async function sampleRelatedList(
  conn: SalesforceSession,
  object: string,
): Promise<string | undefined> {
  try {
    const response = await conn.request<{ relatedLists?: Array<{ relatedListId?: string }> }>({
      method: "GET",
      path: `/ui-api/related-list-info/${object}`,
    });
    return response.body.relatedLists?.[0]?.relatedListId || undefined;
  } catch {
    return undefined;
  }
}

/** Data Cloud pack suite: verify pack entries + discover app/setup nav. */
async function runDataCloudSuite(
  targetOrg: string,
  sessionId: string,
  limit?: number,
): Promise<EntryResult[]> {
  const records = dataCloudDestinationRecords().slice(0, limit ?? Infinity);
  const results: EntryResult[] = [];
  const navLinks: Array<{ label: string; href: string }> = [];

  // Resolve the app open path once for app-tab discovery.
  const appRecord = records.find((r) => r.discoveryHint?.app);
  const appDevName = appRecord?.discoveryHint?.app;
  const appPath = appDevName ? await resolveAppPath(targetOrg, appDevName) : undefined;
  if (appDevName && !appPath) {
    console.warn(`! Could not resolve app path for ${appDevName}; app-tab discovery limited.\n`);
  }

  // If we have the app record and a resolved app path, open it once and collect
  // nav links for discovery.
  if (appRecord && appPath) {
    try {
      await openPath(targetOrg, appPath);
      const observed = await waitAndClassify("app-ready");
      const shot = await screenshot("app", sessionId);
      navLinks.push(...(await collectNavLinks()));
      results.push({
        id: appRecord.id,
        label: appRecord.label,
        surface: appRecord.surface,
        group: "data-cloud",
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
      results.push(await verifyEntry(targetOrg, record, sessionId));
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
        group: "data-cloud",
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
        group: "data-cloud",
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
  results.push(...(await discoverSetupNodes(targetOrg)));

  return results;
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
        group: "data-cloud",
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
        group: "data-cloud",
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
      group: "data-cloud",
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
      group: "mutation",
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
      group: "mutation",
      status: "candidate",
      path: mutablePath,
      outcome: "broken",
      expected: "Unknown Salesforce page",
      note: errorText(error),
    };
  }
}

async function runClassicToggleLifecycle(
  targetOrg: string,
  sessionId: string,
): Promise<EntryResult> {
  const id = "classic-toggle-lifecycle";
  const pathValue = "/lightning/setup/SecuritySession/home";
  const label = "Disable session timeout warning popup";
  const { tools } = registerPublicBrowserTools();
  const context = {
    cwd: process.cwd(),
    sessionManager: { getSessionId: () => sessionId },
  } as unknown as ExtensionContext;
  const execute = async (
    name: string,
    params: Record<string, unknown>,
  ): Promise<PublicToolResult> => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Public SF Browser tool ${name} was not registered.`);
    const result = await tool.execute(
      `harden-${name}-${Date.now()}`,
      params,
      undefined,
      undefined,
      context,
    );
    if (result.isError || result.details?.ok === false) {
      const text = result.content
        ?.map((item) => item.text ?? "")
        .join("\n")
        .trim();
      throw new Error(text || `${name} returned an unsuccessful result.`);
    }
    return result;
  };

  try {
    const opened = await execute("sf_browser_open_org", {
      target_org: targetOrg,
      target: { type: "path", path: pathValue },
      purpose: "Reversible Classic Setup toggle hardening",
    });
    await execute("sf_browser_wait", {
      condition: { type: "lightning", value: "navigation-ready" },
      checkpointEvidence: false,
    });
    const snapshot = await execute("sf_browser_snapshot", {
      interactive: true,
      compact: true,
      outputMode: "summary",
      focus: [label, "Save"],
    });
    const fullSnapshotPath = String(snapshot.details?.fullSnapshotPath ?? "");
    const rawSnapshot = readFileSync(fullSnapshotPath, "utf8");
    const initial = findToggleInSnapshot(rawSnapshot, label);
    if (!initial || initial.disabled)
      throw new Error(`Editable toggle ${JSON.stringify(label)} was not found.`);

    const changed = await execute("sf_browser_set_toggle", {
      ref: initial.ref,
      desiredState: !initial.checked,
      reason: "Reversible no-save hardening probe",
    });
    const latest = findLatestBrowserSnapshotSession(sessionId);
    const currentRef = latest?.refs.find((entry) => entry.label === label)?.ref;
    if (!currentRef)
      throw new Error("Fresh toggle ref was not published after the first state change.");
    const restored = await execute("sf_browser_set_toggle", {
      ref: currentRef,
      desiredState: initial.checked,
      reason: "Restore original no-save form state",
    });
    const after = restored.details?.afterActionEvidence as { path?: string } | undefined;
    const recovered = changed.details?.recoveredClassicSetup === true;
    const restoredState = restored.details?.observedState === initial.checked;
    return {
      id,
      label: "Classic Setup toggle lifecycle (reversible, no-save)",
      surface: "setup-node",
      group: "mutation",
      status: "candidate",
      path: pathValue,
      outcome: recovered && restoredState ? "confirmed" : "needs-review",
      expected: "Classic Setup iframe checkbox with original state restored",
      observedOutcome: `open:${String(opened.details?.openMethod ?? "unknown")}(${String(opened.details?.durationText ?? "n/a")}) classic-adapter:${recovered ? "used" : "not-used"} restored:${restoredState}`,
      screenshot: after?.path ? path.basename(after.path) : undefined,
      note: "Toggled one Session Settings checkbox, verified it, restored the original form state, and did not click Save.",
    };
  } catch (error) {
    return {
      id,
      label: "Classic Setup toggle lifecycle (reversible, no-save)",
      surface: "setup-node",
      group: "mutation",
      status: "candidate",
      path: pathValue,
      outcome: "broken",
      expected: "Classic Setup iframe checkbox with original state restored",
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
    `# SF Browser navigation hardening — ${opts.surfaces.join(", ")}`,
    ``,
    `Org: ${opts.targetOrg}  ·  Generated: ${new Date().toISOString()}`,
    ``,
    `| group | id | surface | outcome | observed | path | note |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
  ];
  for (const r of sortByGroup(results)) {
    lines.push(
      `| ${markdownTableCell(r.group)} | ${markdownTableCell(r.id)} | ${markdownTableCell(r.surface)} | ${markdownTableCell(r.outcome)} | ${markdownTableCell(r.observedOutcome ?? "")} | ${markdownTableCell(r.path || "")} | ${markdownTableCell(r.note ?? "")} |`,
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
          <small>${r.group} · ${r.surface} · observed: ${r.observedOutcome ?? "—"}</small><br/>
          <code>${r.path || "(no path)"}</code>
          ${r.note ? `<p>${escapeHtml(r.note)}</p>` : ""}
        </figcaption>
      </figure>`;
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>SF Browser navigation hardening — ${escapeHtml(opts.surfaces.join(", "))}</title>
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
<h1>SF Browser navigation hardening — ${escapeHtml(opts.surfaces.join(", "))}</h1>
<p>Org: ${escapeHtml(opts.targetOrg)} · Generated: ${new Date().toISOString()}</p>
<div class="grid">${cards}</div>
</body></html>`;
}

function printSummary(results: EntryResult[], evidenceDir: string): void {
  const count = (rows: EntryResult[], o: EntryResult["outcome"]) =>
    rows.filter((r) => r.outcome === o).length;
  const groups = [...new Set(results.map((r) => r.group))];
  console.log(`\nResults: ${results.length} entries`);
  for (const group of groups) {
    const rows = results.filter((r) => r.group === group);
    console.log(
      `  [${group}] confirmed=${count(rows, "confirmed")} proposed=${count(rows, "proposed")} needs-review=${count(rows, "needs-review")} skipped=${count(rows, "skipped")} broken=${count(rows, "broken")}`,
    );
  }
  console.log(`\nReport: ${path.join(evidenceDir, "report.html")}`);

  const proposals = results.filter((r) => r.outcome === "proposed" || r.outcome === "confirmed");
  if (proposals.length) {
    console.log(`\nProposals / confirmed paths (review before promoting to status:"verified"):`);
    for (const r of sortByGroup(proposals)) {
      console.log(`  [${r.group}] ${r.id.padEnd(24)} ${r.path}`);
    }
  }
}

function sortByGroup(results: EntryResult[]): EntryResult[] {
  return [...results].sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
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
    group: "data-cloud",
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
  const message = error instanceof Error ? error.message : String(error);
  const compact = message.replace(/\s+/gu, " ").trim();
  return compact.length > 1000 ? `${compact.slice(0, 999)}…` : compact;
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
