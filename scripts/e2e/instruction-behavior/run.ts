#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Opt-in live-model routing regression for the Salesforce Instruction Surface. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  evaluateInstructionBehaviorScenario,
  type InstructionBehaviorObservation,
  type InstructionBehaviorScenario,
  type InstructionBehaviorScenarioResult,
} from "./evaluate.ts";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const piBin = path.join(repoRoot, "node_modules", ".bin", "pi");
const probeExtension = path.join(currentDir, "probe-extension.ts");
const scenariosPath = path.join(currentDir, "scenarios.json");
const args = parseArgs(process.argv.slice(2));
const outputDir = args.output ?? defaultOutputDir();
mkdirSync(outputDir, { recursive: true });

const scenarios = (JSON.parse(readFileSync(scenariosPath, "utf8")) as InstructionBehaviorScenario[])
  .filter((scenario) => !args.scenario || scenario.id === args.scenario)
  .slice(0, args.limit ?? Number.POSITIVE_INFINITY);

if (scenarios.length === 0) {
  throw new Error(args.scenario ? `Unknown scenario: ${args.scenario}` : "No scenarios found.");
}

const results: Array<InstructionBehaviorScenarioResult & { process_status: number | null }> = [];
for (const scenario of scenarios) {
  const runDir = mkdtempSync(path.join(tmpdir(), "sf-pi-instruction-behavior-"));
  const observationPath = path.join(runDir, "observation.json");
  try {
    const cliArgs = [
      "--approve",
      "--no-session",
      "-e",
      probeExtension,
      ...(args.provider ? ["--provider", args.provider] : []),
      ...(args.model ? ["--model", args.model] : []),
      ...(args.thinking ? ["--thinking", args.thinking] : []),
      "--print",
      scenario.prompt,
    ];
    const processResult = spawnSync(piBin, cliArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        SF_PI_INSTRUCTION_BEHAVIOR_OBSERVATION: observationPath,
      },
      encoding: "utf8",
      timeout: args.timeoutMs,
    });
    const observation = {
      ...readObservation(observationPath),
      response_text: processResult.stdout?.trim() ?? "",
    };
    const scenarioResult = {
      ...evaluateInstructionBehaviorScenario(scenario, observation),
      process_status: processResult.status,
    };
    results.push(scenarioResult);
    console.log(
      `${scenarioResult.status === "passed" ? "PASS" : "FAIL"} ${scenario.id} · ${scenarioResult.first_tool ?? "no tool"}`,
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
}

const report = {
  schema_version: 1,
  mode: "opt_in_live_model",
  provider: args.provider ?? "current default",
  model: args.model ?? "current default",
  thinking: args.thinking ?? "current default",
  results,
  notes: [
    "This report records observable tool routing facts and assigns no quality score.",
    "The probe allows bounded local read/grep/find/ls context and blocks every other tool before execution; no Salesforce org call or durable mutation is performed.",
    "Model/provider variance keeps this report advisory and non-blocking.",
  ],
};
writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(outputDir, "report.md"), renderMarkdown(report));
console.log(
  `Reports: ${path.join(outputDir, "report.json")} · ${path.join(outputDir, "report.md")}`,
);

function parseArgs(argv: string[]): {
  provider?: string;
  model?: string;
  thinking?: string;
  scenario?: string;
  output?: string;
  limit?: number;
  timeoutMs: number;
} {
  const parsed: {
    provider?: string;
    model?: string;
    thinking?: string;
    scenario?: string;
    output?: string;
    limit?: number;
    timeoutMs: number;
  } = { timeoutMs: 120_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--provider") parsed.provider = requireValue(argv, ++index, arg);
    else if (arg === "--model") parsed.model = requireValue(argv, ++index, arg);
    else if (arg === "--thinking") parsed.thinking = requireValue(argv, ++index, arg);
    else if (arg === "--scenario") parsed.scenario = requireValue(argv, ++index, arg);
    else if (arg === "--output") parsed.output = path.resolve(requireValue(argv, ++index, arg));
    else if (arg === "--limit") parsed.limit = Number(requireValue(argv, ++index, arg));
    else if (arg === "--timeout-ms") parsed.timeoutMs = Number(requireValue(argv, ++index, arg));
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npm run e2e:instruction-behavior -- [--provider id] [--model id] [--thinking level] [--scenario id] [--limit n] [--output dir]",
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.limit !== undefined && (!Number.isInteger(parsed.limit) || parsed.limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs < 1_000) {
    throw new Error("--timeout-ms must be at least 1000.");
  }
  return parsed;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function readObservation(filePath: string): InstructionBehaviorObservation {
  if (!existsSync(filePath)) return { calls: [] };
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8")) as InstructionBehaviorObservation;
    return Array.isArray(value.calls) ? value : { calls: [] };
  } catch {
    return { calls: [] };
  }
}

function defaultOutputDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(repoRoot, ".pi", "state", "sf-brain", "instruction-behavior", stamp);
}

function renderMarkdown(report: {
  provider: string;
  model: string;
  thinking: string;
  results: Array<InstructionBehaviorScenarioResult & { process_status: number | null }>;
  notes: string[];
}): string {
  return [
    "# Instruction Behavior Eval",
    "",
    `- Provider: \`${report.provider}\``,
    `- Model: \`${report.model}\``,
    `- Thinking: \`${report.thinking}\``,
    "",
    "| Scenario | Status | First tool | Expected | Visual contract | Forbidden observed |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.results.map(
      (result) =>
        `| ${result.id} | ${result.status} | ${result.first_tool ?? "none"} | ${result.expected_first_tools.join(", ") || "none"} | ${result.response_contract ? (result.response_contract.passed ? "passed" : "failed") : "n/a"} | ${result.forbidden_tools_observed.join(", ") || "none"} |`,
    ),
    "",
    "## Notes",
    "",
    ...report.notes.map((note) => `- ${note}`),
    "",
  ].join("\n");
}
