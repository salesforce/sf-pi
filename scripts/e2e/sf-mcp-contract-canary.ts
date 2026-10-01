/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Capture and compare the Salesforce DX MCP runtime contract without invoking an org tool.
 *
 * Usage:
 *   npm run e2e:sf-mcp-contract -- --org <alias> [--version latest|x.y.z] [--baseline <file>] [--output-dir <dir>]
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPreset } from "../../extensions/sf-mcp/lib/presets.ts";
import { installPreset } from "../../extensions/sf-mcp/lib/service.ts";
import { buildToolExposurePolicy } from "../../extensions/sf-mcp/lib/tool-policy.ts";
import {
  buildContractSnapshot,
  compareContractSnapshots,
  type ContractDriftReport,
  type McpContractSnapshot,
  type McpPackageMetadata,
  type RawObservedTool,
} from "./lib/sf-mcp-contract.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_BASELINE = path.join(ROOT, "scripts/e2e/contracts/salesforce-dx.json");

export interface SfMcpContractArgs {
  org: string;
  version: string;
  baseline: string;
  outputDir?: string;
}

interface CaptureOutput {
  tools?: RawObservedTool[];
}

export function parseSfMcpContractArgs(argv: string[]): SfMcpContractArgs {
  let org: string | undefined;
  let version = "latest";
  let baseline = DEFAULT_BASELINE;
  let outputDir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--org") org = requiredValue(argv, ++index, token);
    else if (token === "--version") version = requiredValue(argv, ++index, token);
    else if (token === "--baseline") baseline = path.resolve(requiredValue(argv, ++index, token));
    else if (token === "--output-dir") {
      outputDir = path.resolve(requiredValue(argv, ++index, token));
    } else throw new Error(`Unknown argument: ${token ?? "<empty>"}`);
  }
  if (!org) throw new Error("--org requires an explicit Salesforce alias or username.");
  return { org, version, baseline, ...(outputDir ? { outputDir } : {}) };
}

async function runCanary(args: SfMcpContractArgs): Promise<void> {
  const originalAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
  const workspace = await mkdtemp(path.join(tmpdir(), "sf-mcp-contract-"));
  const agentDir = path.join(workspace, "agent");
  const projectDir = path.join(workspace, "project");
  const outputDir = args.outputDir
    ? args.outputDir
    : await mkdtemp(path.join(tmpdir(), "sf-mcp-contract-report-"));
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await mkdir(path.join(projectDir, "force-app"), { recursive: true });
  await mkdir(outputDir, { recursive: true });

  try {
    const metadata = await resolvePackageMetadata(args.version, projectDir);
    await writeFile(
      path.join(projectDir, "sfdx-project.json"),
      `${JSON.stringify(
        {
          packageDirectories: [{ path: "force-app", default: true }],
          namespace: "",
          sourceApiVersion: "67.0",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await run("sf", ["config", "set", `target-org=${args.org}`, "--json"], projectDir);

    process.env.PI_CODING_AGENT_DIR = agentDir;
    const preset = getPreset("salesforce-dx");
    const install = installPreset({
      cwd: projectDir,
      scope: "global",
      presetId: preset.id,
      resolution: "side-by-side",
      toolPolicy: buildToolExposurePolicy(preset, "read-only"),
    });
    if (!install.ok) throw new Error(install.message);
    if (path.resolve(install.path) !== path.join(agentDir, "mcp.json")) {
      throw new Error(
        `SF MCP attempted to write outside the isolated agent directory: ${install.path}`,
      );
    }
    await pinIsolatedPackageVersion(install.path, metadata.version);

    const capture = await run(
      "pi",
      [
        "--print",
        "--no-session",
        "--no-extensions",
        "--extension",
        "builtin:mcp",
        "--extension",
        path.join(ROOT, "scripts/e2e/fixtures/sf-mcp/contract-extension.ts"),
        "/sf-mcp-contract-capture",
      ],
      projectDir,
      { PI_CODING_AGENT_DIR: agentDir },
    );
    const observed = parseCapture(capture.stdout, capture.stderr);
    const candidate = buildContractSnapshot(metadata, observed.tools ?? []);
    const candidatePath = path.join(outputDir, "candidate.json");
    await writeJson(candidatePath, candidate);

    if (!existsSync(args.baseline)) {
      await writeMarkdown(outputDir, candidate, undefined);
      console.log(`🟡 No baseline exists. Candidate written to ${candidatePath}`);
      return;
    }

    const baseline = JSON.parse(await readFile(args.baseline, "utf8")) as McpContractSnapshot;
    const drift = compareContractSnapshots(baseline, candidate);
    await writeJson(path.join(outputDir, "drift.json"), drift);
    await writeMarkdown(outputDir, candidate, drift);
    if (drift.status !== "clean") {
      throw new Error(
        `Salesforce DX MCP contract requires review (${drift.status}). Evidence: ${path.join(outputDir, "report.md")}`,
      );
    }
    console.log(
      `✅ Salesforce DX MCP ${candidate.package.version} matches the reviewed contract. Evidence: ${path.join(outputDir, "report.md")}`,
    );
  } finally {
    if (originalAgentDirEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDirEnv;
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function resolvePackageMetadata(
  requestedVersion: string,
  cwd: string,
): Promise<McpPackageMetadata> {
  const result = await run(
    "npm",
    [
      "view",
      `@salesforce/mcp@${requestedVersion}`,
      "version",
      "dist.integrity",
      "time.modified",
      "--json",
    ],
    cwd,
  );
  const value = JSON.parse(result.stdout) as {
    version?: unknown;
    "dist.integrity"?: unknown;
    "time.modified"?: unknown;
  };
  if (
    typeof value.version !== "string" ||
    typeof value["dist.integrity"] !== "string" ||
    typeof value["time.modified"] !== "string"
  ) {
    throw new Error("npm did not return complete @salesforce/mcp package metadata.");
  }
  return {
    version: value.version,
    integrity: value["dist.integrity"],
    modifiedAt: value["time.modified"],
  };
}

async function pinIsolatedPackageVersion(file: string, version: string): Promise<void> {
  const root = JSON.parse(await readFile(file, "utf8")) as {
    mcpServers?: Record<string, { args?: string[] }>;
  };
  const server = root.mcpServers?.["salesforce-dx"];
  if (!server?.args?.includes("@salesforce/mcp@latest")) {
    throw new Error("The isolated SF MCP preset no longer contains @salesforce/mcp@latest.");
  }
  server.args = server.args.map((arg) =>
    arg === "@salesforce/mcp@latest" ? `@salesforce/mcp@${version}` : arg,
  );
  await writeFile(file, `${JSON.stringify(root, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function parseCapture(stdout: string, stderr: string): CaptureOutput {
  const lines = `${stdout}\n${stderr}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as CaptureOutput;
      if (Array.isArray(parsed.tools)) return parsed;
    } catch {
      // Ignore non-JSON command output and keep looking for the capture record.
    }
  }
  const lastOutput = lines.at(-1)?.slice(0, 1000) ?? "<none>";
  const lastError = stderr.trim().split("\n").at(-1)?.slice(0, 1000) ?? "<none>";
  throw new Error(
    `Pi did not return a Salesforce DX MCP contract capture. Last output: ${lastOutput}; last error: ${lastError}`,
  );
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function writeMarkdown(
  outputDir: string,
  candidate: McpContractSnapshot,
  drift: ContractDriftReport | undefined,
): Promise<void> {
  const lines = [
    "# Salesforce DX MCP Contract Canary",
    "",
    `- Version: ${candidate.package.version}`,
    `- Tool count: ${candidate.tools.length}`,
    `- Drift status: ${drift?.status ?? "baseline-missing"}`,
    `- Tools: ${candidate.tools.map((tool) => tool.name).join(", ")}`,
    "",
  ];
  if (drift?.changes.length) {
    lines.push("## Changes", "");
    for (const change of drift.changes) {
      lines.push(`- **${change.severity}** ${change.message}`);
    }
    lines.push("");
  }
  lines.push("This report contains no org identifiers, credentials, or record data.", "");
  await writeFile(path.join(outputDir, "report.md"), lines.join("\n"), {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function run(
  executable: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
  timeout = 240_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`${executable} failed to start: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${executable} failed: ${timedOut ? `timed out after ${timeout}ms` : `code=${String(code)}`} ${signal ? `signal=${signal}` : ""} ${stderr.trim()}`.trim(),
        ),
      );
    });
  });
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseSfMcpContractArgs(process.argv.slice(2));
  await runCanary(args).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
