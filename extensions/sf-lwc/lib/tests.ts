/* SPDX-License-Identifier: Apache-2.0 */
/** Local LWC Jest discovery, planning, and bounded execution. */

import { mkdtemp, readFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeLwcBundle } from "./artifacts.ts";
import { scanProject, relativeToProject, resolveProject } from "./project.ts";
import type {
  LwcArtifact,
  LwcJestSummary,
  LwcTestDiscovery,
  LwcTestFile,
  SfLwcParams,
} from "./types.ts";

const DEFAULT_TIMEOUT_SECONDS = 120;
const MIN_TIMEOUT_SECONDS = 1;
const MAX_TIMEOUT_SECONDS = 300;

export async function discoverTests(
  workspace: string,
  packageDir?: string,
): Promise<LwcTestDiscovery> {
  const scan = await scanProject(workspace, packageDir);
  const runner = await findRunner(scan.project.projectRoot);
  const testFiles: LwcTestFile[] = [];
  for (const bundle of scan.bundles) {
    for (const testFile of bundle.testFiles) {
      testFiles.push({
        path: testFile,
        component: bundle.name,
        tests: extractTestNames(await readFile(testFile, "utf8")),
      });
    }
  }
  testFiles.sort((a, b) => a.path.localeCompare(b.path));
  return { project: scan.project, runner, runnable: Boolean(runner), testFiles };
}

export async function planTest(
  params: SfLwcParams,
  workspace: string,
): Promise<{
  discovery: LwcTestDiscovery;
  selected?: LwcTestFile;
  reason: string;
}> {
  const discovery = await discoverTests(workspace, params.package_dir);
  if (params.test_file) {
    const selected = discovery.testFiles.find(
      (file) =>
        samePath(file.path, path.resolve(workspace, params.test_file ?? "")) ||
        file.path.endsWith(params.test_file ?? ""),
    );
    return {
      discovery,
      selected,
      reason: selected
        ? "Explicit test_file matched."
        : "Explicit test_file did not match a discovered LWC Jest test.",
    };
  }
  if (params.component) {
    const selected = discovery.testFiles.find(
      (file) => file.component?.toLowerCase() === params.component?.toLowerCase(),
    );
    return {
      discovery,
      selected,
      reason: selected
        ? "Component has a colocated LWC Jest test."
        : "No colocated LWC Jest test found for component.",
    };
  }
  if (params.file) {
    const base = inferComponentFromPath(params.file);
    const selected = base
      ? discovery.testFiles.find((file) => file.component?.toLowerCase() === base.toLowerCase())
      : undefined;
    return {
      discovery,
      selected,
      reason: selected
        ? "Changed file maps to a component with tests."
        : "Changed file did not map to a discovered component test.",
    };
  }
  return {
    discovery,
    selected: discovery.testFiles[0],
    reason: discovery.testFiles.length
      ? "Defaulting to the first discovered test file."
      : "No LWC Jest tests discovered.",
  };
}

export async function runLocalJest(
  params: SfLwcParams,
  workspace: string,
): Promise<{
  discovery: LwcTestDiscovery;
  selected?: LwcTestFile;
  summary?: LwcJestSummary;
  artifacts: LwcArtifact[];
  stdout: string;
  stderr: string;
  exitCode?: number | null;
}> {
  const plan = await planTest(params, workspace);
  const runner = plan.discovery.runner;
  if (!runner) throw new Error("Local LWC Jest runner not found at node_modules/.bin/lwc-jest.");
  if (!plan.selected) throw new Error(plan.reason);

  const temp = await mkdtemp(path.join(os.tmpdir(), "sf-lwc-jest-"));
  const outputFile = path.join(temp, `jest-${randomUUID()}.json`);
  const args = [
    "--json",
    "--outputFile",
    outputFile,
    "--testLocationInResults",
    "--runTestsByPath",
    normalizeRunTestsByPath(plan.discovery.project.projectRoot, plan.selected.path),
  ];
  if (params.test_name) args.push("--testNamePattern", escapeRegExp(params.test_name));
  if (params.test_pattern) args.push("--testNamePattern", params.test_pattern);

  const timeoutSeconds = clampTimeoutSeconds(params.timeout_seconds);
  const exec = await runProcess(
    runner,
    args,
    plan.discovery.project.projectRoot,
    timeoutSeconds * 1000,
  );
  const rawJson = await readOptional(outputFile);
  const parsed = rawJson ? parseJestResult(rawJson) : undefined;
  const summary = parsed
    ? summarizeJest(parsed)
    : fallbackSummary(exec.exitCode, exec.stdout, exec.stderr);
  const markdown = renderTestSummaryMarkdown(
    summary,
    plan.selected.path,
    plan.discovery.project.projectRoot,
  );
  const artifacts = await writeLwcBundle("tests", plan.selected.component ?? "lwc-test", [
    {
      filename: "jest-result.json",
      kind: "jest-json",
      content: rawJson ? JSON.parse(rawJson) : { missing: true },
    },
    { filename: "stdout.txt", kind: "stdout", content: exec.stdout },
    { filename: "stderr.txt", kind: "stderr", content: exec.stderr },
    { filename: "summary.md", kind: "summary", content: markdown },
  ]);
  return {
    discovery: plan.discovery,
    selected: plan.selected,
    summary,
    artifacts,
    stdout: exec.stdout,
    stderr: exec.stderr,
    exitCode: exec.exitCode,
  };
}

export async function findRunner(projectRoot: string): Promise<string | undefined> {
  const bin = path.join(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "lwc-jest.cmd" : "lwc-jest",
  );
  try {
    await access(bin);
    return bin;
  } catch {
    return undefined;
  }
}

export async function statusForWorkspace(
  workspace: string,
): Promise<{ projectRoot?: string; apiVersion?: string; runner?: string; error?: string }> {
  try {
    const project = await resolveProject(workspace);
    return {
      projectRoot: project.projectRoot,
      apiVersion: project.sourceApiVersion,
      runner: await findRunner(project.projectRoot),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function extractTestNames(source: string): string[] {
  const tests: string[] = [];
  for (const match of source.matchAll(/\b(?:it|test)\s*\(\s*(["'`])([^"'`]+)\1/g))
    tests.push(match[2]);
  return [...new Set(tests)];
}

function inferComponentFromPath(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const lwcIndex = parts.lastIndexOf("lwc");
  if (lwcIndex < 0) return undefined;
  return parts[lwcIndex + 1];
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function normalizeRunTestsByPath(cwd: string, testFsPath: string): string {
  if (process.platform.startsWith("win32")) return path.relative(cwd, testFsPath);
  if (process.platform === "darwin" && testFsPath.startsWith("/var/"))
    return `/private${testFsPath}`;
  return testFsPath;
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      stderr += `\nSF LWC timeout after ${timeoutMs}ms.`;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${error.message}`, exitCode: 1 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

function parseJestResult(raw: string): unknown {
  return JSON.parse(raw);
}

function summarizeJest(raw: unknown): LwcJestSummary {
  const result = raw as {
    success?: boolean;
    numTotalTests?: number;
    numPassedTests?: number;
    numFailedTests?: number;
    numPendingTests?: number;
    numTotalTestSuites?: number;
    numPassedTestSuites?: number;
    numFailedTestSuites?: number;
    startTime?: number;
    testResults?: Array<{
      name?: string;
      assertionResults?: Array<{
        title?: string;
        fullName?: string;
        failureMessages?: string[];
        status?: string;
      }>;
    }>;
  };
  const failures: LwcJestSummary["failures"] = [];
  for (const suite of result.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status === "failed")
        failures.push({
          file: suite.name,
          title: assertion.fullName ?? assertion.title ?? "failed test",
          message: (assertion.failureMessages ?? []).join("\n").slice(0, 2000),
        });
    }
  }
  return {
    success: result.success === true,
    totalTests: result.numTotalTests ?? 0,
    passedTests: result.numPassedTests ?? 0,
    failedTests: result.numFailedTests ?? failures.length,
    pendingTests: result.numPendingTests ?? 0,
    totalSuites: result.numTotalTestSuites ?? 0,
    passedSuites: result.numPassedTestSuites ?? 0,
    failedSuites: result.numFailedTestSuites ?? 0,
    failures,
  };
}

function fallbackSummary(
  exitCode: number | null | undefined,
  stdout: string,
  stderr: string,
): LwcJestSummary {
  return {
    success: exitCode === 0,
    totalTests: 0,
    passedTests: 0,
    failedTests: exitCode === 0 ? 0 : 1,
    pendingTests: 0,
    totalSuites: 0,
    passedSuites: 0,
    failedSuites: exitCode === 0 ? 0 : 1,
    failures:
      exitCode === 0
        ? []
        : [{ title: "LWC Jest runner", message: `${stderr || stdout}`.slice(0, 2000) }],
  };
}

function renderTestSummaryMarkdown(
  summary: LwcJestSummary,
  testFile: string,
  projectRoot: string,
): string {
  const lines = [
    `# LWC Jest Summary`,
    "",
    `- Test file: ${relativeToProject(projectRoot, testFile)}`,
    `- Result: ${summary.success ? "passed" : "failed"}`,
    `- Tests: ${summary.passedTests}/${summary.totalTests} passing`,
    `- Suites: ${summary.passedSuites}/${summary.totalSuites} passing`,
  ];
  if (summary.failures.length) {
    lines.push("", "## Failures");
    for (const failure of summary.failures.slice(0, 10))
      lines.push("", `### ${failure.title}`, "", "```", failure.message, "```");
  }
  return `${lines.join("\n")}\n`;
}

async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function clampTimeoutSeconds(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TIMEOUT_SECONDS;
  return Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, Math.trunc(value)));
}
