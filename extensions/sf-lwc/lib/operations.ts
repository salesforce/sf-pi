/* SPDX-License-Identifier: Apache-2.0 */
/** High-level sf-lwc lifecycle operations. */

import path from "node:path";
import { writeLwcArtifact, writeLwcBundle } from "./artifacts.ts";
import { inspectComponent } from "./component.ts";
import { diagnoseLocalFile } from "./diagnostics.ts";
import { buildDigest, row, section } from "./digest.ts";
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
  const digest = buildDigest({
    action: "project.scan",
    status: "pass",
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
      ]),
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
  const digest = buildDigest({
    action: "component.list",
    status: "pass",
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
      ]),
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
  const failures = inspection.diagnostics.filter((diag) => diag.severity === "error");
  const digest = buildDigest({
    action: "component.inspect",
    status: failures.length ? "warning" : "pass",
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
      section("🎨", "Style Signals", styleSignalRows(inspection.styleSignals)),
      section("🩺", "Diagnostics", diagnosticsRows(inspection.diagnostics)),
    ],
    artifacts,
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
  const run = await runLocalJest(params, workspace);
  state.lastRunnable = { ...params, action: "test.run" };
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
    ],
    artifacts: run.artifacts,
    recommended_skills: recommendedSkillsForAction(params.action),
    next_step: summary?.success
      ? "Continue the LWC edit loop or inspect another component."
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
