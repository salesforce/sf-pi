/* SPDX-License-Identifier: Apache-2.0 */
/** High-level sf-lwc lifecycle operations. */

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { writeLwcArtifact, writeLwcBundle } from "./artifacts.ts";
import { inspectComponent } from "./component.ts";
import { diagnoseLocalFile } from "./diagnostics.ts";
import { buildDigest, row, section } from "./digest.ts";
import {
  analyzeBundleHealth,
  hasHealthWarnings,
  healthRows,
  healthSummary,
  primaryHealthReason,
  type LwcBundleHealthFinding,
} from "./health.ts";

interface LwcJestSetupGuidance {
  projectRoot: string;
  checked: string[];
  dependency: string;
  script: string;
  installCommand: string;
  copyPasteCommand: string;
  retryCommand: string;
}
import { scanProject, relativeToProject } from "./project.ts";
import { toolResultFromDigest } from "./result.ts";
import {
  clampTimeoutSeconds,
  discoverTests,
  planTest,
  runLocalJest,
  statusForWorkspace,
} from "./tests.ts";
import type {
  LwcBundleInfo,
  LwcDiagnostic,
  SfLwcParams,
  SfLwcSessionState,
  ToolResult,
} from "./types.ts";

export async function status(params: SfLwcParams, cwd: string): Promise<ToolResult> {
  const workspace = resolveWorkspace(params, cwd);
  const current = await statusForWorkspace(workspace);
  const digest = buildDigest({
    action: "status",
    status: current.error ? "warning" : "pass",
    icon: "🧩",
    title: "SF LWC Status",
    workspace: {
      root: workspace,
      project_root: current.projectRoot,
      api_version: current.apiVersion,
    },
    local_rail: [
      { kind: "workspace", target: workspace },
      {
        kind: "runner",
        target: current.runner ? "node_modules/.bin/lwc-jest" : "not found",
        detail: current.runner,
      },
      { kind: "compiler", target: "@lwc/compiler + @lwc/template-compiler" },
    ],
    sections: [
      section("🧭", "Readiness", [
        row(current.error ? "⚠️" : "✅", "SFDX project", current.error ?? "ready"),
        row(current.runner ? "✅" : "⚠️", "Local Jest", current.runner ? "available" : "not found"),
      ]),
    ],
    next_step: current.error
      ? "Run sf_lwc inside an SFDX project with sfdx-project.json."
      : "Use project.scan or component.inspect next.",
  });
  return toolResultFromDigest(digest, { status: current });
}

export async function projectScan(params: SfLwcParams, cwd: string): Promise<ToolResult> {
  const workspace = resolveWorkspace(params, cwd);
  const scan = await scanProject(workspace, params.package_dir);
  const limit = params.limit ?? 20;
  const artifacts = [await writeLwcArtifact("scans", "project-scan.json", scanForArtifact(scan))];
  const displayed = scan.bundles.slice(0, limit);
  const bundleHealth = await healthForBundles(scan.bundles, scan.project.projectRoot);
  const healthWarnings = bundleHealth.filter(({ health }) => hasHealthWarnings(health));
  const digest = buildDigest({
    action: "project.scan",
    status: healthWarnings.length ? "warning" : "pass",
    icon: "🔎",
    title: "LWC Project Scan",
    workspace: {
      root: workspace,
      project_root: scan.project.projectRoot,
      api_version: scan.project.sourceApiVersion,
    },
    local_rail: [
      { kind: "project", target: "sfdx-project.json" },
      { kind: "packages", target: scan.project.packageDirs.map((pkg) => pkg.path).join(", ") },
    ],
    sections: [
      section("📦", "Project", [
        row("📁", "Package dirs", scan.project.packageDirs.length),
        row("🧩", "Components", scan.bundles.length),
        row(
          "🧪",
          "With tests",
          scan.bundles.filter((bundle) => bundle.testFiles.length > 0).length,
        ),
        row("🌐", "Exposed", scan.bundles.filter((bundle) => bundle.metadata?.isExposed).length),
        row("🛡️", "Health warnings", healthWarnings.length),
      ]),
      section("🛡️", "Bundle Health", bundleHealthRows(bundleHealth)),
      section(
        "🧩",
        "Components",
        displayed.map((bundle) =>
          row(
            bundle.testFiles.length ? "🧪" : "🧩",
            bundle.name,
            bundleSummary(bundle, scan.project.projectRoot),
          ),
        ),
      ),
    ],
    artifacts,
    primary_reason: healthWarnings[0]
      ? `${healthWarnings[0].bundle.name}: ${primaryHealthReason(healthWarnings[0].health)}`
      : undefined,
    next_step: scan.bundles.length
      ? "Use component.inspect for a focused bundle."
      : "No LWC bundles found in registered package directories.",
  });
  return toolResultFromDigest(digest, { scan });
}

export async function componentList(params: SfLwcParams, cwd: string): Promise<ToolResult> {
  const workspace = resolveWorkspace(params, cwd);
  const scan = await scanProject(workspace, params.package_dir);
  const query = params.component?.toLowerCase();
  const filtered = query
    ? scan.bundles.filter((bundle) => bundle.name.toLowerCase().includes(query))
    : scan.bundles;
  const limit = params.limit ?? 25;
  const bundleHealth = await healthForBundles(filtered, scan.project.projectRoot);
  const healthWarnings = bundleHealth.filter(({ health }) => hasHealthWarnings(health));
  const digest = buildDigest({
    action: "component.list",
    status: healthWarnings.length ? "warning" : "pass",
    icon: "🧩",
    title: "LWC Components",
    workspace: {
      root: workspace,
      project_root: scan.project.projectRoot,
      api_version: scan.project.sourceApiVersion,
    },
    scope: query ? `filter=${query}` : undefined,
    local_rail: [
      { kind: "packages", target: scan.project.packageDirs.map((pkg) => pkg.path).join(", ") },
    ],
    sections: [
      section("📊", "Inventory", [
        row("🧩", "Matched", filtered.length),
        row("🧪", "With tests", filtered.filter((bundle) => bundle.testFiles.length > 0).length),
        row("🌐", "Exposed", filtered.filter((bundle) => bundle.metadata?.isExposed).length),
        row("🛡️", "Health warnings", healthWarnings.length),
      ]),
      section("🛡️", "Bundle Health", bundleHealthRows(bundleHealth)),
      section(
        "🧩",
        "Matches",
        filtered
          .slice(0, limit)
          .map((bundle) =>
            row(
              bundle.testFiles.length ? "🧪" : "🧩",
              bundle.name,
              bundleSummary(bundle, scan.project.projectRoot),
            ),
          ),
      ),
    ],
    primary_reason: healthWarnings[0]
      ? `${healthWarnings[0].bundle.name}: ${primaryHealthReason(healthWarnings[0].health)}`
      : undefined,
    next_step: filtered.length
      ? "Use component.inspect for a focused bundle."
      : "Adjust component filter or run project.scan.",
  });
  return toolResultFromDigest(digest, { components: filtered });
}

export async function componentInspect(params: SfLwcParams, cwd: string): Promise<ToolResult> {
  if (!params.component) throw new Error("component.inspect requires component.");
  const workspace = resolveWorkspace(params, cwd);
  const { scan, inspection } = await inspectComponent({
    workspace,
    component: params.component,
    packageDir: params.package_dir,
    includeSource: params.include_source,
  });
  const artifacts = await writeLwcBundle("components", inspection.bundle.name, [
    { filename: "inspection.json", kind: "inspection", content: inspection },
    { filename: "dependencies.json", kind: "dependencies", content: dependencySummary(inspection) },
  ]);
  const health = await analyzeBundleHealth(
    inspection.bundle,
    scan.project.projectRoot,
    inspection.diagnostics,
  );
  const digest = buildDigest({
    action: "component.inspect",
    status: hasHealthWarnings(health) ? "warning" : "pass",
    icon: "🧩",
    title: `LWC Component · ${inspection.bundle.name}`,
    workspace: {
      root: workspace,
      project_root: scan.project.projectRoot,
      api_version: scan.project.sourceApiVersion,
    },
    scope: inspection.bundle.name,
    local_rail: [
      {
        kind: "bundle",
        target: relativeToProject(scan.project.projectRoot, inspection.bundle.bundlePath),
      },
      {
        kind: "files",
        target: String(inspection.bundle.files.length),
        detail: `${inspection.bundle.testFiles.length} test file(s)`,
      },
    ],
    sections: [
      section("📄", "Bundle", [
        row("📁", "Package", inspection.bundle.packageDir),
        row("🌐", "Exposed", inspection.bundle.metadata?.isExposed === true ? "true" : "false"),
        row("🎯", "Targets", inspection.bundle.metadata?.targets.join(", ") || "—"),
        row("🧪", "Tests", inspection.bundle.testFiles.length),
      ]),
      section("🔌", "Local Shape", [
        row("🧷", "@api", inspection.publicApi.join(", ") || "—"),
        row("⚡", "Apex imports", inspection.apexImports.join(", ") || "—"),
        row("🧾", "Schema imports", inspection.schemaImports.join(", ") || "—"),
        row("🏷️", "Labels", inspection.labelImports.join(", ") || "—"),
        row("🧩", "Child tags", inspection.childComponents.join(", ") || "—"),
      ]),
      section("🛡️", "Bundle Health", healthRows(health)),
      section("🎨", "Style Signals", styleSignalRows(inspection.styleSignals)),
      section("🩺", "Diagnostics", diagnosticsRows(inspection.diagnostics)),
    ],
    artifacts,
    primary_reason: primaryHealthReason(health),
    recommended_tools: recommendedTools(
      inspection.apexImports,
      inspection.schemaImports,
      inspection.diagnostics,
      inspection.styleSignals,
    ),
    recommended_skills: recommendedSkillsForAction(params.action, inspection.styleSignals),
    next_step: inspection.bundle.testFiles.length
      ? "Run test.plan or test.run for this component."
      : "Add or locate a colocated LWC Jest test before risky edits.",
  });
  return toolResultFromDigest(digest, { inspection });
}

export async function fileDiagnose(params: SfLwcParams, cwd: string): Promise<ToolResult> {
  const workspace = resolveWorkspace(params, cwd);
  const files = params.files?.length ? params.files : params.file ? [params.file] : [];
  if (!files.length) throw new Error("file.diagnose requires file or files.");
  const diagnostics = (
    await Promise.all(
      files.map((file) => diagnoseLocalFile(path.resolve(workspace, file), workspace)),
    )
  ).flat();
  const artifacts = [await writeLwcArtifact("diagnostics", "diagnostics.json", diagnostics)];
  const errorCount = diagnostics.filter((diag) => diag.severity === "error").length;
  const digest = buildDigest({
    action: "file.diagnose",
    status: errorCount ? "fail" : diagnostics.length ? "warning" : "pass",
    icon: "🩺",
    title: "LWC File Diagnostics",
    workspace: { root: workspace },
    scope: files.join(", "),
    local_rail: files.map((file) => ({ kind: "file", target: file })),
    sections: [section("🩺", "Diagnostics", diagnosticsRows(diagnostics))],
    artifacts,
    primary_reason: diagnostics.find((diag) => diag.severity === "error")?.message,
    recommended_skills: recommendedSkillsForAction(
      params.action,
      styleSignalsForFiles(files, diagnostics),
    ),
    recommended_tools: diagnostics.some((diag) => diag.severity === "error")
      ? ["code_analyzer"]
      : [],
    next_step: errorCount
      ? "Fix the first error and rerun file.diagnose."
      : "Run component.inspect or the related local LWC test next.",
  });
  return toolResultFromDigest(digest, { diagnostics });
}

export async function testDiscover(params: SfLwcParams, cwd: string): Promise<ToolResult> {
  const workspace = resolveWorkspace(params, cwd);
  const discovery = await discoverTests(workspace, params.package_dir);
  const artifacts = [await writeLwcArtifact("tests", "test-discovery.json", discovery)];
  const digest = buildDigest({
    action: "test.discover",
    status: discovery.runnable ? "pass" : "warning",
    icon: "🧪",
    title: "LWC Test Discovery",
    workspace: {
      root: workspace,
      project_root: discovery.project.projectRoot,
      api_version: discovery.project.sourceApiVersion,
    },
    local_rail: [
      {
        kind: "runner",
        target: discovery.runnable ? "node_modules/.bin/lwc-jest" : "not found",
        detail: discovery.runner,
      },
      { kind: "pattern", target: "**/{lwc,modules}/**/*.test.{js,ts}" },
    ],
    sections: [
      section("🧪", "Tests", [
        row("📄", "Files", discovery.testFiles.length),
        row(
          "🧪",
          "Cases",
          discovery.testFiles.reduce((sum, file) => sum + file.tests.length, 0),
        ),
        row(
          discovery.runnable ? "✅" : "⚠️",
          "Runnable",
          discovery.runnable ? "yes" : "no local lwc-jest runner",
        ),
      ]),
      section(
        "📄",
        "Test Files",
        discovery.testFiles
          .slice(0, params.limit ?? 20)
          .map((file) =>
            row(
              "🧪",
              file.component ?? "test",
              relativeToProject(discovery.project.projectRoot, file.path),
            ),
          ),
      ),
    ],
    artifacts,
    primary_reason: discovery.runnable ? undefined : "no local lwc-jest runner",
    recommended_skills: recommendedSkillsForAction(params.action),
    next_step: discovery.runnable
      ? "Use test.plan or test.run for the changed component."
      : "Install project LWC Jest dependencies outside sf-lwc, then rerun test.discover.",
  });
  return toolResultFromDigest(digest, { discovery });
}

export async function testPlan(params: SfLwcParams, cwd: string): Promise<ToolResult> {
  const workspace = resolveWorkspace(params, cwd);
  const plan = await planTest(params, workspace);
  const digest = buildDigest({
    action: "test.plan",
    status: plan.selected ? "pass" : "warning",
    icon: "🧪",
    title: "LWC Test Plan",
    workspace: {
      root: workspace,
      project_root: plan.discovery.project.projectRoot,
      api_version: plan.discovery.project.sourceApiVersion,
    },
    scope: params.component ?? params.file ?? params.test_file,
    local_rail: [
      {
        kind: "runner",
        target: plan.discovery.runnable ? "node_modules/.bin/lwc-jest" : "not found",
        detail: plan.discovery.runner,
      },
    ],
    sections: [
      section("🎯", "Recommendation", [
        row(
          plan.selected ? "✅" : "⚠️",
          "Selected",
          plan.selected
            ? relativeToProject(plan.discovery.project.projectRoot, plan.selected.path)
            : "none",
        ),
        row("💡", "Reason", plan.reason),
        row("🧪", "Test cases", plan.selected?.tests.length ?? 0),
      ]),
    ],
    primary_reason: plan.selected ? undefined : plan.reason,
    recommended_skills: recommendedSkillsForAction(params.action),
    next_step: plan.selected
      ? "Run sf_lwc test.run with this component or test_file."
      : "Run test.discover or add a colocated LWC Jest test.",
  });
  return toolResultFromDigest(digest, { plan });
}

export async function testRun(
  params: SfLwcParams,
  cwd: string,
  state: SfLwcSessionState,
): Promise<ToolResult> {
  const workspace = resolveWorkspace(params, cwd);
  const run = await runLocalJest(params, workspace).catch(async (error: unknown) => {
    if (isMissingRunnerError(error)) return blockedLocalJestRun(params, workspace, error);
    throw error;
  });
  if (run.selected) state.lastRunnable = { ...params, action: "test.run" };
  const summary = run.summary;
  const digest = buildDigest({
    action: "test.run",
    status: summary?.success ? "pass" : "fail",
    icon: "🧪",
    title: "LWC Jest",
    workspace: {
      root: workspace,
      project_root: run.discovery.project.projectRoot,
      api_version: run.discovery.project.sourceApiVersion,
    },
    scope: run.selected
      ? relativeToProject(run.discovery.project.projectRoot, run.selected.path)
      : undefined,
    local_rail: [
      { kind: "runner", target: "node_modules/.bin/lwc-jest", detail: run.discovery.runner },
      { kind: "timeout", target: `${clampTimeoutSeconds(params.timeout_seconds)}s` },
    ],
    sections: [
      section("🧪", "Run Summary", [
        row(summary?.success ? "✅" : "❌", "Result", summary?.success ? "passed" : "failed"),
        row(
          "🧪",
          "Tests",
          summary ? `${summary.passedTests}/${summary.totalTests} passing` : "unknown",
        ),
        row(
          "📦",
          "Suites",
          summary ? `${summary.passedSuites}/${summary.totalSuites} passing` : "unknown",
        ),
        row("🚪", "Exit code", run.exitCode ?? "—"),
      ]),
      section(
        "🔥",
        "Failures",
        (summary?.failures ?? [])
          .slice(0, 5)
          .map((failure) => row("🔥", failure.title, firstLine(failure.message))),
      ),
      section(
        "🛠️",
        "Setup Guidance",
        "setupGuidance" in run ? setupGuidanceRows(run.setupGuidance) : [],
      ),
    ],
    artifacts: run.artifacts,
    primary_reason: "primaryReason" in run ? run.primaryReason : undefined,
    recommended_skills: recommendedSkillsForAction(params.action),
    next_step: summary?.success
      ? "Continue the LWC edit loop or inspect another component."
      : "setupGuidance" in run
        ? "Run the Copy/paste command in Setup Guidance, then retry test.run."
        : "Open the Jest JSON/stdout artifacts, fix the first failing test, and rerun test.run.",
  });
  state.lastDigest = digest;
  return toolResultFromDigest(digest, {
    run: { summary, selected: run.selected, exitCode: run.exitCode },
  });
}

export function historyLast(state: SfLwcSessionState): ToolResult {
  if (!state.lastDigest) {
    return toolResultFromDigest(
      buildDigest({
        action: "history.last",
        status: "warning",
        icon: "🕘",
        title: "LWC History",
        sections: [section("🕘", "History", [row("⚠️", "Last run", "none")])],
      }),
    );
  }
  return toolResultFromDigest({
    ...state.lastDigest,
    action: "history.last",
    title: `LWC History · ${state.lastDigest.title}`,
  });
}

export async function historyRerun(
  params: SfLwcParams,
  cwd: string,
  state: SfLwcSessionState,
): Promise<ToolResult> {
  if (!state.lastRunnable) throw new Error("No previous runnable LWC action in this session.");
  return testRun({ ...state.lastRunnable, ...params, action: "test.run" }, cwd, state);
}

async function blockedLocalJestRun(
  params: SfLwcParams,
  workspace: string,
  error: unknown,
): Promise<{
  discovery: Awaited<ReturnType<typeof planTest>>["discovery"];
  selected?: Awaited<ReturnType<typeof planTest>>["selected"];
  summary: {
    success: boolean;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    pendingTests: number;
    totalSuites: number;
    passedSuites: number;
    failedSuites: number;
    failures: Array<{ title: string; message: string }>;
  };
  artifacts: [];
  stdout: string;
  stderr: string;
  exitCode?: number;
  primaryReason: string;
  setupGuidance: LwcJestSetupGuidance;
}> {
  const plan = await planTest(params, workspace);
  const setupGuidance = await buildJestSetupGuidance(plan.discovery.project.projectRoot, params);
  const reason = "local lwc-jest runner not found";
  const message = error instanceof Error ? error.message : String(error);
  return {
    discovery: plan.discovery,
    selected: plan.selected,
    summary: {
      success: false,
      totalTests: 0,
      passedTests: 0,
      failedTests: 1,
      pendingTests: 0,
      totalSuites: 0,
      passedSuites: 0,
      failedSuites: 1,
      failures: [
        {
          title: "LWC Jest runner",
          message,
        },
      ],
    },
    artifacts: [],
    stdout: "",
    stderr: message,
    primaryReason: reason,
    setupGuidance,
  };
}

function isMissingRunnerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /lwc[- ]jest runner not found/i.test(message);
}

async function buildJestSetupGuidance(
  projectRoot: string,
  params: SfLwcParams,
): Promise<LwcJestSetupGuidance> {
  const checked = ["node_modules/.bin/lwc-jest", "node_modules/.bin/sfdx-lwc-jest"];
  const packageInfo = await readPackageInfo(projectRoot);
  const installCommand = await recommendedInstallCommand(projectRoot);
  return {
    projectRoot,
    checked,
    dependency: packageInfo.declaresJest
      ? "@salesforce/sfdx-lwc-jest declared"
      : "@salesforce/sfdx-lwc-jest not declared",
    script: packageInfo.testScript
      ? `test:unit=${packageInfo.testScript}`
      : "test:unit script not found",
    installCommand,
    copyPasteCommand: `cd ${bashQuote(projectRoot)} && ${installCommand}`,
    retryCommand: retryCommandFor(params),
  };
}

function setupGuidanceRows(guidance: LwcJestSetupGuidance) {
  return [
    row("📁", "Run from", guidance.projectRoot),
    row("🔎", "Checked", guidance.checked.join(", ")),
    row("📦", "Dependency", guidance.dependency),
    row("🧪", "Script", guidance.script),
    row("💻", "Copy/paste", guidance.copyPasteCommand),
    row("➡️", "Retry", guidance.retryCommand),
  ];
}

async function readPackageInfo(
  projectRoot: string,
): Promise<{ declaresJest: boolean; testScript?: string }> {
  try {
    const raw = await readFile(path.join(projectRoot, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      declaresJest: Boolean(
        pkg.dependencies?.["@salesforce/sfdx-lwc-jest"] ??
        pkg.devDependencies?.["@salesforce/sfdx-lwc-jest"],
      ),
      testScript: pkg.scripts?.["test:unit"],
    };
  } catch {
    return { declaresJest: false };
  }
}

async function recommendedInstallCommand(projectRoot: string): Promise<string> {
  if (await fileExists(path.join(projectRoot, "package-lock.json"))) return "npm ci";
  if (await fileExists(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm install";
  if (await fileExists(path.join(projectRoot, "yarn.lock"))) return "yarn install";
  return "npm install";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function retryCommandFor(params: SfLwcParams): string {
  const target = params.component
    ? ` component=${params.component}`
    : params.test_file
      ? ` test_file=${params.test_file}`
      : "";
  return `sf_lwc test.discover, then sf_lwc test.run${target}`;
}

function bashQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function resolveWorkspace(params: SfLwcParams, cwd: string): string {
  return path.resolve(params.workspace ?? cwd);
}

function scanForArtifact(scan: Awaited<ReturnType<typeof scanProject>>): unknown {
  return {
    project: scan.project,
    bundles: scan.bundles.map((bundle) => ({
      ...bundle,
      files: bundle.files.map((file) => relativeToProject(scan.project.projectRoot, file)),
      testFiles: bundle.testFiles.map((file) => relativeToProject(scan.project.projectRoot, file)),
    })),
    omitted: scan.omitted.map((file) => relativeToProject(scan.project.projectRoot, file)),
  };
}

async function healthForBundles(
  bundles: LwcBundleInfo[],
  projectRoot: string,
): Promise<Array<{ bundle: LwcBundleInfo; health: LwcBundleHealthFinding[] }>> {
  return Promise.all(
    bundles.map(async (bundle) => ({
      bundle,
      health: await analyzeBundleHealth(bundle, projectRoot),
    })),
  );
}

function bundleHealthRows(
  bundleHealth: Array<{ bundle: LwcBundleInfo; health: LwcBundleHealthFinding[] }>,
) {
  const warnings = bundleHealth.filter(({ health }) => hasHealthWarnings(health));
  if (!warnings.length) return [row("✅", "Status", "healthy")];
  return warnings
    .slice(0, 8)
    .map(({ bundle, health }) =>
      row("⚠️", bundle.name, `${healthSummary(health)} · ${primaryHealthReason(health)}`),
    );
}

function bundleSummary(bundle: LwcBundleInfo, projectRoot: string): string {
  const bits = [
    bundle.metadata?.isExposed ? "exposed" : "not exposed",
    `files=${bundle.files.length}`,
    `tests=${bundle.testFiles.length}`,
  ];
  const targets = bundle.metadata?.targets ?? [];
  if (targets.length)
    bits.push(`targets=${targets.slice(0, 2).join(",")}${targets.length > 2 ? "+" : ""}`);
  bits.push(relativeToProject(projectRoot, bundle.bundlePath));
  return bits.join(" · ");
}

function diagnosticsRows(diagnostics: LwcDiagnostic[]) {
  if (!diagnostics.length) return [row("✅", "Status", "clean")];
  return diagnostics
    .slice(0, 8)
    .map((diag) =>
      row(
        diag.severity === "error" ? "❌" : diag.severity === "warning" ? "⚠️" : "ℹ️",
        diag.file,
        `${diag.message}${diag.line ? ` (${diag.line}:${diag.column ?? 1})` : ""}`,
      ),
    );
}

function styleSignalRows(signals: string[]) {
  if (!signals.length) return [row("✅", "Status", "none detected")];
  return signals.map((signal) => row("🎨", signal, styleSignalLabel(signal)));
}

function dependencySummary(inspection: {
  apexImports: string[];
  schemaImports: string[];
  labelImports: string[];
  resourceImports: string[];
  childComponents: string[];
  lightningTags: string[];
}): unknown {
  return {
    apexImports: inspection.apexImports,
    schemaImports: inspection.schemaImports,
    labelImports: inspection.labelImports,
    resourceImports: inspection.resourceImports,
    childComponents: inspection.childComponents,
    lightningTags: inspection.lightningTags,
  };
}

function recommendedTools(
  apexImports: string[],
  schemaImports: string[],
  diagnostics: LwcDiagnostic[],
  styleSignals: string[] = [],
): string[] {
  const tools = new Set<string>();
  if (apexImports.length) tools.add("sf_apex");
  if (schemaImports.length) tools.add("sf_soql");
  if (diagnostics.some((diag) => diag.severity === "error") || styleSignals.length) {
    tools.add("code_analyzer");
  }
  return [...tools];
}

function recommendedSkillsForAction(
  action: SfLwcParams["action"],
  styleSignals: string[] = [],
): string[] {
  const skills = new Set<string>();
  if (
    [
      "component.inspect",
      "file.diagnose",
      "test.discover",
      "test.plan",
      "test.run",
      "history.rerun",
    ].includes(action)
  ) {
    skills.add("generating-lwc-components");
  }
  if (styleSignals.length) skills.add("uplifting-components-to-slds2");
  return [...skills];
}

function styleSignalsForFiles(files: string[], diagnostics: LwcDiagnostic[]): string[] {
  const signals = new Set<string>();
  if (files.some((file) => /\.css$/i.test(file))) signals.add("css-file");
  for (const diagnostic of diagnostics) {
    if (/SLDS class override/i.test(diagnostic.message)) signals.add("slds-class-override");
    if (/LWC design token/i.test(diagnostic.message)) signals.add("lwc-design-token");
    if (/Legacy token/i.test(diagnostic.message)) signals.add("legacy-token-syntax");
    if (/Hardcoded style value/i.test(diagnostic.message)) signals.add("hardcoded-style-value");
  }
  return [...signals].sort();
}

function styleSignalLabel(signal: string): string {
  switch (signal) {
    case "css-file":
      return "CSS present; consider SLDS2 uplift guidance when editing styles";
    case "slds-class-override":
      return "SLDS class override candidate";
    case "slds-class-usage":
      return "SLDS class usage in markup";
    case "lwc-design-token":
      return "Deprecated --lwc token candidate";
    case "legacy-token-syntax":
      return "Legacy t()/token() syntax candidate";
    case "hardcoded-style-value":
      return "Hardcoded style value candidate";
    default:
      return "Style-related signal";
  }
}

function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.slice(0, 240) ?? "See Jest artifacts."
  );
}
