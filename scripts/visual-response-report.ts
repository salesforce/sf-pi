#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Write a bounded, aggregate-only SF Brain visual-response audit. */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import {
  captureVisualResponseAudit,
  renderVisualResponseAuditMarkdown,
} from "../extensions/sf-brain/lib/visual-response-audit.ts";
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
} from "../lib/common/sf-pi-settings.ts";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(
    "Usage: npm run visual-response:report -- [--cwd path] [--session-dir path] [--max-sessions n] [--width n] [--output dir]",
  );
  process.exit(0);
}

const cwd = path.resolve(args.cwd ?? process.cwd());
const sessionDir = resolveSessionDir(cwd, args.sessionDir);
const outputDir = path.resolve(args.output ?? defaultOutputDir(cwd));
const report = captureVisualResponseAudit({
  cwd,
  sessionDir,
  ...(args.maxSessions ? { maxSessions: args.maxSessions } : {}),
  ...(args.width ? { terminalWidth: args.width } : {}),
});
mkdirSync(outputDir, { recursive: true });
const jsonPath = path.join(outputDir, "report.json");
const markdownPath = path.join(outputDir, "report.md");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, renderVisualResponseAuditMarkdown(report), "utf8");
console.log(`Visual response audit: ${jsonPath} · ${markdownPath}`);

type Args = {
  cwd?: string;
  sessionDir?: string;
  maxSessions?: number;
  width?: number;
  output?: string;
  help?: boolean;
};

function parseArgs(argv: string[]): Args {
  const parsed: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") parsed.cwd = requireValue(argv, ++index, arg);
    else if (arg === "--session-dir") parsed.sessionDir = requireValue(argv, ++index, arg);
    else if (arg === "--max-sessions")
      parsed.maxSessions = positiveInt(requireValue(argv, ++index, arg), arg);
    else if (arg === "--width") parsed.width = positiveInt(requireValue(argv, ++index, arg), arg);
    else if (arg === "--output") parsed.output = requireValue(argv, ++index, arg);
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${flag} requires a positive integer.`);
  return parsed;
}

function resolveSessionDir(cwd: string, explicit: string | undefined): string {
  const configured =
    explicit ??
    process.env.PI_CODING_AGENT_SESSION_DIR ??
    readSessionDir(projectSettingsPath(cwd)) ??
    readSessionDir(globalSettingsPath());
  if (configured) return path.resolve(cwd, configured.replace(/^~(?=$|[\\/])/, homedir()));
  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(getAgentDir(), "sessions", safePath);
}

function readSessionDir(filePath: string): string | undefined {
  const value = readJsonFile(filePath).sessionDir;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function defaultOutputDir(cwd: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(cwd, ".pi", "state", "sf-brain", "visual-response", stamp);
}
