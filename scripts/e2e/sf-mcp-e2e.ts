/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read-only live E2E for SF MCP -> Pi MCP -> Salesforce DX MCP -> explicit org.
 *
 * Usage:
 *   npm run e2e:sf-mcp -- --org <alias> --model <provider/model> [--output-dir <dir>] [--keep-workspace]
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { connectSalesforce } from "../../lib/common/sf-conn/index.ts";
import { getPreset } from "../../extensions/sf-mcp/lib/presets.ts";
import {
  installPreset,
  updateManagedPresetToolPolicy,
} from "../../extensions/sf-mcp/lib/service.ts";
import {
  buildToolExposurePolicy,
  customizeToolExposure,
  type ToolExposurePolicy,
} from "../../extensions/sf-mcp/lib/tool-policy.ts";
import { resolvePackageMetadata } from "./sf-mcp-contract-canary.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const QUERY = "SELECT IsSandbox FROM Organization LIMIT 1";
const CALLABLE_TOOLS = ["get_username", "list_all_orgs", "run_soql_query"] as const;
const HIDDEN_TOOL_NAMES = new Set([
  "mcp__salesforce_dx__resume_tool_operation",
  "mcp__salesforce_dx__assign_permission_set",
  "mcp__salesforce_dx__deploy_metadata",
  "mcp__salesforce_dx__retrieve_metadata",
  "mcp__salesforce_dx__run_agent_test",
  "mcp__salesforce_dx__run_apex_test",
]);

export interface SfMcpE2eArgs {
  org: string;
  model: string;
  outputDir?: string;
  keepWorkspace: boolean;
}

interface McpListServer {
  name?: unknown;
  state?: unknown;
  tools?: unknown;
  toolExposure?: unknown;
}

interface McpListOutput {
  servers?: unknown;
  errors?: unknown;
}

interface JsonEvent extends Record<string, unknown> {
  type?: string;
  toolCallId?: string;
  parentToolCallId?: string;
  toolName?: string;
  isError?: boolean;
  result?: unknown;
}

export interface AgentProbeSummary {
  probeCalled: boolean;
  usernameCallPassed: boolean;
  queryCallPassed: boolean;
  hiddenToolCalls: string[];
  settled: boolean;
}

export interface ConnectedDxContractSummary {
  state: "connected";
  toolCount: number;
  callableTools: string[];
}

interface HarnessReport {
  schemaVersion: 1;
  status: "pass";
  startedAt: string;
  completedAt: string;
  target: {
    label: "redacted-explicit-target";
    verified: true;
    orgType: string;
    isSandbox: boolean;
    apiVersion: string;
  };
  config: {
    scope: "isolated-global";
    package: {
      requested: "@salesforce/mcp@latest";
      version: string;
      integrity: string;
    };
    exposure: "hidden";
    callableTools: string[];
    invocationDirectTools: string[];
  };
  contract: ConnectedDxContractSummary;
  probe: AgentProbeSummary;
  query: string;
}

export function parseSfMcpE2eArgs(argv: string[]): SfMcpE2eArgs {
  let org: string | undefined;
  let model: string | undefined;
  let outputDir: string | undefined;
  let keepWorkspace = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--org") {
      org = requiredValue(argv, ++index, "--org");
    } else if (token === "--model") {
      model = requiredValue(argv, ++index, "--model");
    } else if (token === "--output-dir") {
      outputDir = requiredValue(argv, ++index, "--output-dir");
    } else if (token === "--keep-workspace") {
      keepWorkspace = true;
    } else {
      throw new Error(`Unknown argument: ${token ?? "<empty>"}`);
    }
  }

  if (!org) throw new Error("--org requires an explicit Salesforce alias or username.");
  if (!model) throw new Error("--model requires an explicit provider/model.");
  return { org, model, ...(outputDir ? { outputDir } : {}), keepWorkspace };
}

export function buildSfMcpE2ePolicy(): ToolExposurePolicy {
  const preset = getPreset("salesforce-dx");
  let policy = buildToolExposurePolicy(preset, "quarantine");
  for (const tool of CALLABLE_TOOLS) {
    policy = customizeToolExposure(preset, policy, tool, "codemode");
  }
  return policy;
}

export function buildSfMcpInvocationPolicy(): ToolExposurePolicy {
  const preset = getPreset("salesforce-dx");
  let policy = buildSfMcpE2ePolicy();
  for (const tool of ["get_username", "run_soql_query"] as const) {
    policy = customizeToolExposure(preset, policy, tool, "direct");
  }
  return policy;
}

export function assertConnectedDxContract(
  value: McpListOutput,
  expectedTools: readonly string[],
): ConnectedDxContractSummary {
  const errors = Array.isArray(value.errors) ? value.errors : [];
  if (errors.length > 0) {
    throw new Error(`Pi MCP reported connection errors: ${errors.length}.`);
  }
  const servers = Array.isArray(value.servers) ? (value.servers as McpListServer[]) : [];
  const server = servers.find((candidate) => candidate.name === "salesforce-dx");
  if (!server) throw new Error("Pi MCP did not report the salesforce-dx server.");
  if (server.state !== "connected") {
    throw new Error(`Salesforce DX MCP is not connected (state=${String(server.state)}).`);
  }
  const actualTools = stringArray(server.tools).sort();
  const expected = [...expectedTools].sort();
  if (JSON.stringify(actualTools) !== JSON.stringify(expected)) {
    const added = actualTools.filter((tool) => !expected.includes(tool));
    const removed = expected.filter((tool) => !actualTools.includes(tool));
    throw new Error(
      `Salesforce DX MCP contract drift detected (added=${added.join(",") || "none"}; removed=${removed.join(",") || "none"}).`,
    );
  }
  const toolExposure = isRecord(server.toolExposure) ? server.toolExposure : {};
  const callableTools = Object.entries(toolExposure)
    .filter(([, exposure]) => exposure !== "hidden")
    .map(([name]) => name)
    .sort();
  const expectedCallable = [...CALLABLE_TOOLS].sort();
  if (JSON.stringify(callableTools) !== JSON.stringify(expectedCallable)) {
    throw new Error(
      `Salesforce DX MCP callable exposure mismatch (actual=${callableTools.join(",") || "none"}).`,
    );
  }
  return { state: "connected", toolCount: actualTools.length, callableTools };
}

export function summarizeAgentProbe(events: JsonEvent[]): AgentProbeSummary {
  const starts = events.filter((event) => event.type === "tool_execution_start");
  const ends = events.filter((event) => event.type === "tool_execution_end");
  const hiddenToolCalls = starts
    .map((event) => event.toolName)
    .filter((name): name is string => typeof name === "string" && HIDDEN_TOOL_NAMES.has(name));
  if (hiddenToolCalls.length > 0) {
    throw new Error(
      `A hidden tool was executed through Salesforce DX MCP: ${hiddenToolCalls.join(", ")}.`,
    );
  }

  const probeCalled = starts.some((event) => event.toolName === "sf_mcp_e2e_probe");
  const usernameCallPassed = successfulToolEnd(ends, "mcp__salesforce_dx__get_username");
  const queryCallPassed = successfulToolEnd(ends, "mcp__salesforce_dx__run_soql_query");
  const probePassed = ends.some(
    (event) =>
      event.toolName === "sf_mcp_e2e_probe" &&
      event.isError !== true &&
      resultContainsMarker(event.result, "SF_MCP_E2E_PASS"),
  );
  const settled = events.some((event) => event.type === "agent_settled");

  if (!probeCalled) throw new Error("The model did not call sf_mcp_e2e_probe.");
  if (!usernameCallPassed)
    throw new Error("The nested Salesforce DX MCP get_username call failed.");
  if (!queryCallPassed) throw new Error("The nested Salesforce DX MCP run_soql_query call failed.");
  if (!probePassed) throw new Error("The SF MCP E2E probe did not return its pass marker.");
  if (!settled) throw new Error("The Pi agent run did not reach agent_settled.");

  return { probeCalled, usernameCallPassed, queryCallPassed, hiddenToolCalls, settled };
}

async function runHarness(
  args: SfMcpE2eArgs,
): Promise<{ report: HarnessReport; outputDir: string }> {
  const startedAt = new Date().toISOString();
  const originalAgentDir = getAgentDir();
  const originalAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
  const workspace = await mkdtemp(path.join(tmpdir(), "sf-mcp-e2e-"));
  const agentDir = path.join(workspace, "agent");
  const projectDir = path.join(workspace, "project");
  const outputDir = args.outputDir
    ? path.resolve(args.outputDir)
    : await mkdtemp(path.join(tmpdir(), "sf-mcp-e2e-report-"));
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await mkdir(path.join(projectDir, "force-app"), { recursive: true });
  await mkdir(outputDir, { recursive: true });

  try {
    const packageMetadata = await resolvePackageMetadata("latest", ROOT);
    console.log(`🔍 Preflighting explicit Salesforce target ${args.org}...`);
    const connection = await connectSalesforce({
      cwd: ROOT,
      targetOrg: args.org,
      fresh: true,
    });
    const classification = await connection.query<{ IsSandbox: boolean }>({
      soql: QUERY,
      api: "rest",
      maxRows: 1,
    });
    const isSandbox = classification.records[0]?.IsSandbox;
    if (typeof isSandbox !== "boolean") {
      throw new Error("Organization preflight did not return one IsSandbox value.");
    }

    await writeFile(
      path.join(projectDir, "sfdx-project.json"),
      `${JSON.stringify(
        {
          packageDirectories: [{ path: "force-app", default: true }],
          namespace: "",
          sourceApiVersion: connection.target.apiVersion,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await run("sf", ["config", "set", `target-org=${args.org}`, "--json"], projectDir);

    await linkModelFiles(originalAgentDir, agentDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const expectedConfigPath = path.join(agentDir, "mcp.json");
    const install = installPreset({
      cwd: projectDir,
      scope: "global",
      presetId: "salesforce-dx",
      resolution: "side-by-side",
      toolPolicy: buildSfMcpE2ePolicy(),
    });
    if (!install.ok) throw new Error(install.message);
    if (path.resolve(install.path) !== path.resolve(expectedConfigPath)) {
      throw new Error(
        `SF MCP attempted to write outside the isolated agent directory: ${install.path}`,
      );
    }

    console.log("🔌 Connecting Pi native MCP to Salesforce DX MCP...");
    const mcpListResult = await run("pi", ["mcp", "list", "--json"], projectDir, {
      PI_CODING_AGENT_DIR: agentDir,
    });
    const mcpList = JSON.parse(mcpListResult.stdout) as McpListOutput;
    const preset = getPreset("salesforce-dx");
    const contract = assertConnectedDxContract(mcpList, preset.approvedTools ?? []);

    const invocationPolicy = updateManagedPresetToolPolicy({
      cwd: projectDir,
      scope: "global",
      presetId: "salesforce-dx",
      policy: buildSfMcpInvocationPolicy(),
    });
    if (!invocationPolicy.ok) throw new Error(invocationPolicy.message);

    console.log("🧪 Running the bounded MCP query through Pi and SF Guardrail...");
    const eventsResult = await run(
      "pi",
      [
        "--mode",
        "json",
        "--no-session",
        "--model",
        args.model,
        "--thinking",
        "minimal",
        "--no-extensions",
        "--extension",
        "builtin:mcp",
        "--extension",
        path.join(ROOT, "extensions/sf-guardrail/index.ts"),
        "--extension",
        path.join(ROOT, "extensions/sf-mcp/index.ts"),
        "--extension",
        path.join(ROOT, "scripts/e2e/fixtures/sf-mcp/probe-extension.ts"),
        "--tools",
        "sf_mcp_e2e_probe,mcp__salesforce_dx__get_username,mcp__salesforce_dx__run_soql_query",
        "--system-prompt",
        "Call the sf_mcp_e2e_probe tool exactly once. Do not call any other tool. After it succeeds, report only its result.",
        "Call sf_mcp_e2e_probe exactly once now.",
      ],
      projectDir,
      {
        PI_CODING_AGENT_DIR: agentDir,
        SF_MCP_E2E_ORG: args.org,
        SF_MCP_E2E_PROJECT: projectDir,
      },
      300_000,
    );
    const events = parseJsonLines(eventsResult.stdout);
    const probe = summarizeAgentProbe(events);

    const report: HarnessReport = {
      schemaVersion: 1,
      status: "pass",
      startedAt,
      completedAt: new Date().toISOString(),
      target: {
        label: "redacted-explicit-target",
        verified: true,
        orgType: connection.target.orgType,
        isSandbox,
        apiVersion: connection.target.apiVersion,
      },
      config: {
        scope: "isolated-global",
        package: {
          requested: "@salesforce/mcp@latest",
          version: packageMetadata.version,
          integrity: packageMetadata.integrity,
        },
        exposure: "hidden",
        callableTools: [...CALLABLE_TOOLS],
        invocationDirectTools: ["get_username", "run_soql_query"],
      },
      contract,
      probe,
      query: QUERY,
    };
    await writeReports(outputDir, report);
    console.log(`✅ SF MCP E2E passed. Evidence: ${path.join(outputDir, "report.md")}`);
    return { report, outputDir };
  } catch (error) {
    await writeFailure(outputDir, startedAt, error, args.org);
    throw error;
  } finally {
    if (originalAgentDirEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDirEnv;
    await unlinkModelFiles(agentDir);
    if (args.keepWorkspace) console.log(`⚠️ Preserved isolated workspace: ${workspace}`);
    else await rm(workspace, { recursive: true, force: true });
  }
}

const MODEL_FILES = ["auth.json", "models-store.json", "models.json"] as const;

async function linkModelFiles(sourceDir: string, targetDir: string): Promise<void> {
  for (const name of MODEL_FILES) {
    const source = path.join(sourceDir, name);
    if (!existsSync(source)) continue;
    await symlink(
      source,
      path.join(targetDir, name),
      process.platform === "win32" ? "file" : undefined,
    );
  }
}

async function unlinkModelFiles(targetDir: string): Promise<void> {
  for (const name of MODEL_FILES) {
    await rm(path.join(targetDir, name), { force: true });
  }
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
    const maxBuffer = 20 * 1024 * 1024;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > maxBuffer) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > maxBuffer) child.kill("SIGTERM");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`${executable} failed to start: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut && stdout.length <= maxBuffer && stderr.length <= maxBuffer) {
        resolve({ stdout, stderr });
        return;
      }
      const diagnostic = [
        timedOut ? `timed out after ${timeout}ms` : `exited with code ${String(code)}`,
        signal ? `signal=${signal}` : "",
        stderr.trim(),
        stdout.trim() ? `stdout tail:\n${sanitizeError(stdout.trim().slice(-6000))}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      reject(new Error(`${executable} failed: ${diagnostic}`));
    });
  });
}

function parseJsonLines(value: string): JsonEvent[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as JsonEvent;
      } catch {
        throw new Error("Pi JSON mode emitted a non-JSON stdout record.");
      }
    });
}

function successfulToolEnd(events: JsonEvent[], toolName: string): boolean {
  return events.some(
    (event) =>
      event.toolName === toolName &&
      event.isError !== true &&
      typeof event.parentToolCallId === "string",
  );
}

function resultContainsMarker(value: unknown, marker: string): boolean {
  if (!isRecord(value) || !Array.isArray(value.content)) return false;
  return value.content.some(
    (item) => isRecord(item) && item.type === "text" && String(item.text).includes(marker),
  );
}

async function writeReports(outputDir: string, report: HarnessReport): Promise<void> {
  await writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const markdown = [
    "# SF MCP E2E Report",
    "",
    `- Status: **${report.status}**`,
    `- Target: ${report.target.label}; verified=${report.target.verified}`,
    `- Org classification: ${report.target.orgType}; IsSandbox=${report.target.isSandbox}`,
    `- API version: ${report.target.apiVersion}`,
    `- Salesforce MCP package: ${report.config.package.version}`,
    `- MCP contract: ${report.contract.toolCount} reviewed tools; state=${report.contract.state}`,
    `- Callable tools: ${report.contract.callableTools.join(", ")}`,
    `- Direct only during probe: ${report.config.invocationDirectTools.join(", ")}`,
    `- Query: \`${report.query}\``,
    `- Hidden tool executions: ${report.probe.hiddenToolCalls.length}`,
    "",
    "No Salesforce records or metadata were intentionally changed.",
    "",
  ].join("\n");
  await writeFile(path.join(outputDir, "report.md"), markdown, { encoding: "utf8", mode: 0o600 });
}

async function writeFailure(
  outputDir: string,
  startedAt: string,
  error: unknown,
  targetOrg: string,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(
    path.join(outputDir, "failure.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        status: "fail",
        startedAt,
        completedAt: new Date().toISOString(),
        error: sanitizeError(message, targetOrg),
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function sanitizeError(value: string, targetOrg?: string): string {
  const withoutTarget = targetOrg ? value.split(targetOrg).join("<redacted-target>") : value;
  return withoutTarget
    .split(homedir())
    .join("~")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "<redacted-username>")
    .replace(/\b[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?\b/g, "<redacted-salesforce-id>")
    .replace(/https:\/\/[^\s"']+/g, "<redacted-url>")
    .slice(0, 2000);
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseSfMcpE2eArgs(process.argv.slice(2));
  await runHarness(args).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
