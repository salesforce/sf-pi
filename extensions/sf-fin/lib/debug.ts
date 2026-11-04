/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Redacted support bundle and one-shot verbose CLI tracing.
 *
 * The bundle is read-only and makes no credentialed call. It reports
 * environment variable names (never values), the credential source (never
 * the token or its length), and the last redacted CLI error.
 *
 * Verbose tracing arms the next N live doctor runs to add the Fin CLI's own
 * `--verbose` flag. The trace is scrubbed and written to an owner-only
 * artifact file; only the path and a short summary reach the model.
 */
import { AGENT_API_ENV_KEY } from "./agent-api.ts";
import { detectAgentKeySource } from "./agent-key.ts";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import { createStateStore, type StateStore } from "../../../lib/common/state-store.ts";
import { detectRegion, detectTokenSource } from "./auth.ts";
import { privateCliConfigDir, scrubTrace, type CliRunResult } from "./cli-runner.ts";
import {
  CLI_PACKAGE,
  ENV_APP_ID,
  ENV_REGION,
  ENV_TOKEN,
  MIN_CLI_VERSION,
  type FinDebugState,
  type FinStatusSnapshot,
} from "./types.ts";

export const DEFAULT_VERBOSE_RUNS = 1;
const MAX_VERBOSE_RUNS = 5;
const TRACE_RETENTION = 10;

export function createFinDebugStore(pathOverride?: string): StateStore<FinDebugState> {
  return createStateStore<FinDebugState>({
    namespace: "sf-fin",
    filename: "debug.json",
    schemaVersion: 1,
    defaults: {},
    mode: 0o600,
    ...(pathOverride ? { pathOverride } : {}),
  });
}

export function debugArtifactDir(): string {
  return globalAgentPath("sf-pi", "sf-fin", "debug");
}

export function armVerbose(
  store: StateStore<FinDebugState>,
  runs = DEFAULT_VERBOSE_RUNS,
  now = new Date(),
): FinDebugState {
  const verboseRuns = Math.max(1, Math.min(MAX_VERBOSE_RUNS, Math.floor(runs)));
  return store.update((current) => ({ ...current, verboseRuns, enabledAt: now.toISOString() }));
}

export function disarmVerbose(store: StateStore<FinDebugState>): FinDebugState {
  return store.update(({ lastTracePath }) => (lastTracePath ? { lastTracePath } : {}));
}

/** Consume one armed verbose run. Returns true when this run should be verbose. */
export function takeVerboseRun(store: StateStore<FinDebugState>): boolean {
  const current = store.read();
  if (!current.verboseRuns || current.verboseRuns <= 0) return false;
  const remaining = current.verboseRuns - 1;
  store.write(
    remaining > 0
      ? { ...current, verboseRuns: remaining }
      : { ...(current.lastTracePath ? { lastTracePath: current.lastTracePath } : {}) },
  );
  return true;
}

export function writeTraceArtifact(
  result: CliRunResult,
  secret: string | undefined,
  options: { dir?: string; now?: Date; args: string[] },
): string {
  const dir = options.dir ?? debugArtifactDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `trace-${stamp}.log`);
  const body = [
    `# SF Fin verbose trace`,
    `command: intercom ${options.args.join(" ")}`,
    `exit: ${result.exitCode ?? "none"}${result.timedOut ? " (timed out)" : ""}${result.truncated ? " (truncated)" : ""}`,
    "",
    "## stderr",
    scrubTrace(result.stderr, secret),
    "",
    "## stdout",
    scrubTrace(result.stdout, secret),
    "",
  ].join("\n");
  writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });
  pruneTraces(dir);
  return file;
}

function pruneTraces(dir: string): void {
  try {
    const traces = readdirSync(dir)
      .filter((name) => name.startsWith("trace-") && name.endsWith(".log"))
      .sort();
    // Best-effort retention of the newest traces; never fail a doctor run on cleanup.
    for (const name of traces.slice(0, Math.max(0, traces.length - TRACE_RETENTION))) {
      rmSync(path.join(dir, name), { force: true });
    }
  } catch {
    // ignore
  }
}

export interface DebugBundleInput {
  snapshot: FinStatusSnapshot;
  debug: FinDebugState;
  sfPiVersion?: string;
  piVersion?: string;
  nodeVersion?: string;
  platform?: string;
  env?: NodeJS.ProcessEnv;
  cliConfigDir?: string;
}

/** Build the redacted support bundle. Pure apart from a stat of the private config dir. */
export function buildDebugBundle(input: DebugBundleInput): string {
  const env = input.env ?? process.env;
  const setNames = [
    ENV_TOKEN,
    ENV_REGION,
    ENV_APP_ID,
    "INTERCOM_CONFIG_DIR",
    "INTERCOM_API_BASE_URL",
    AGENT_API_ENV_KEY,
  ]
    .filter((name) => Boolean(env[name]?.trim()))
    .sort();
  const configDir = input.cliConfigDir ?? privateCliConfigDir();
  const configState = describeConfigDir(configDir);
  const region = detectRegion();
  const s = input.snapshot;

  return [
    "# SF Fin debug bundle",
    "",
    "## Runtime",
    `- SF Pi: ${input.sfPiVersion ?? "unknown"}`,
    `- Pi: ${input.piVersion ?? "unknown"}`,
    `- Node: ${input.nodeVersion ?? process.versions.node}`,
    `- Platform: ${input.platform ?? `${process.platform}-${process.arch}`}`,
    "",
    "## Fin CLI",
    `- Package: ${CLI_PACKAGE} (minimum ${MIN_CLI_VERSION})`,
    `- Installed: ${s.cliVersion ?? "unknown"}`,
    `- Latest published: ${s.latestVersion ?? "unknown"}`,
    `- Path: ${s.cliPath ?? "unknown"}`,
    `- Install source: ${s.installSource ?? "unknown"}`,
    "",
    "## Credential",
    `- Source: ${detectTokenSource()}`,
    `- Region: ${region.region} (${region.source})`,
    `- Fin Agent API key source: ${detectAgentKeySource(env)}`,
    `- Variables set (names only): ${setNames.length ? setNames.join(", ") : "none"}`,
    "",
    "## Private CLI config",
    `- Path: ${configDir}`,
    `- State: ${configState}`,
    "",
    "## Last doctor",
    `- Outcome: ${s.lastOutcome ?? "never run"}${s.lastCheckedAt ? ` at ${s.lastCheckedAt}` : ""}`,
    s.lastCliError
      ? `- CLI error: ${s.lastCliError.code ?? "unknown"} — ${s.lastCliError.message ?? ""}`
      : undefined,
    s.lastDiagnosis ? `- Diagnosis: ${s.lastDiagnosis}` : undefined,
    "",
    "## Verbose tracing",
    `- Armed runs remaining: ${input.debug.verboseRuns ?? 0}`,
    `- Last trace: ${input.debug.lastTracePath ?? "none"}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function describeConfigDir(dir: string): string {
  try {
    const stat = statSync(dir);
    const mode = (stat.mode & 0o777).toString(8).padStart(3, "0");
    const entries = readdirSync(dir).length;
    return `exists · mode ${mode} · ${entries === 0 ? "empty (expected)" : `${entries} entries`}`;
  } catch {
    return "not created yet";
  }
}
