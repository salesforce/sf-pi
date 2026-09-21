/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded SFDX package-directory Flow discovery. */

import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { artifactTimestamp, writeFlowArtifact } from "./artifacts.ts";
import { buildFlowDigest, row, section, toolResultFromDigest } from "./digest.ts";
import { isFlowFile } from "./analyzer.ts";
import type { FlowArtifact, SfFlowParams, ToolResult } from "./types.ts";

const MAX_FILES = 1_000;

export async function projectScan(
  params: SfFlowParams,
  cwd: string,
  dependencies: {
    writeArtifact?: (kind: string, filename: string, content: unknown) => Promise<FlowArtifact>;
  } = {},
): Promise<ToolResult> {
  const root = await resolveWorkspace(params.workspace, cwd);
  const projectFile = path.join(root, "sfdx-project.json");
  const project = JSON.parse(await readFile(projectFile, "utf8")) as {
    packageDirectories?: Array<{ path?: unknown }>;
    sourceApiVersion?: unknown;
  };
  const packageDirs = (project.packageDirectories ?? [])
    .map((entry) => (typeof entry.path === "string" ? entry.path : undefined))
    .filter((entry): entry is string => Boolean(entry));
  if (!packageDirs.length) throw new Error("sfdx-project.json declares no package directories");

  const flows: string[] = [];
  for (const packageDir of packageDirs) {
    const absolute = path.resolve(root, packageDir);
    const relative = path.relative(root, absolute);
    if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`Package directory escapes the workspace: ${packageDir}`);
    }
    await walkFlows(absolute, root, flows);
    if (flows.length >= MAX_FILES) break;
  }
  flows.sort();
  const truncated = flows.length >= MAX_FILES;
  const artifact = await (dependencies.writeArtifact ?? writeFlowArtifact)(
    "scans",
    `${artifactTimestamp()}-project-scan.json`,
    {
      root,
      package_directories: packageDirs,
      source_api_version: project.sourceApiVersion,
      flows,
      truncated,
    },
  );
  const limit = Math.max(1, Math.min(Math.floor(params.limit ?? 25), 100));
  const digest = buildFlowDigest({
    action: "project.scan",
    kind: "flow_project_scan",
    status: "pass",
    icon: "🌊",
    title: "Flow Project Scan",
    meta: [`${flows.length} flow${flows.length === 1 ? "" : "s"}`],
    rail: packageDirs.map((dir) => ({ kind: "Package", target: dir })),
    sections: [
      section(
        "📁",
        "Flows",
        flows.slice(0, limit).map((flow) => row("🌊", "Flow", flow)),
      ),
      section("📊", "Scope", [
        row("📦", "Packages", packageDirs.length),
        row("🌊", "Flows", flows.length),
        row("✂️", "Truncated", truncated ? "yes" : "no"),
      ]),
    ],
    artifacts: [artifact],
    next_step: flows.length
      ? "Inspect or diagnose the smallest relevant Flow."
      : "Add a Flow under a declared package directory.",
  });
  return toolResultFromDigest(digest, {
    workspace: root,
    package_directories: packageDirs,
    source_api_version: project.sourceApiVersion,
    flows: flows.slice(0, limit),
    total: flows.length,
    truncated,
    artifacts: [artifact],
  });
}

export async function resolveFlowWorkspace(
  input: string | undefined,
  cwd: string,
): Promise<string> {
  if (!input) return cwd;
  return resolveWorkspace(input, cwd);
}

async function resolveWorkspace(input: string | undefined, cwd: string): Promise<string> {
  const candidate = path.resolve(cwd, input ?? ".");
  const root = await realpath(candidate);
  const info = await stat(path.join(root, "sfdx-project.json")).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`No sfdx-project.json found in ${root}`);
  return root;
}

async function walkFlows(directory: string, root: string, output: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (output.length >= MAX_FILES) return;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walkFlows(absolute, root, output);
    else if (entry.isFile() && isFlowFile(entry.name)) output.push(path.relative(root, absolute));
  }
}
