/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Bounded runner for the user's installed Fin CLI (`intercom`).
 *
 * Credential boundary:
 * - The token is passed only in the child process environment
 *   (`INTERCOM_TOKEN`), never in argv where `ps` can read it.
 * - The child gets an allowlisted environment, not Pi's full environment, plus
 *   `INTERCOM_CONFIG_DIR` pointing at an SF Pi-private directory. The CLI
 *   therefore never reads or writes the user's own keychain entry or
 *   `~/.intercom` files while SF Fin runs it.
 * - stdout/stderr are scrubbed of the token before they leave this module.
 *
 * The runner never uses a shell, enforces a timeout and an output cap, and
 * reports outcomes with the CLI's documented exit codes.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import type { FinCredential } from "./auth.ts";
import {
  CLI_BINARY,
  ENV_APP_ID,
  ENV_REGION,
  ENV_TOKEN,
  MIN_CLI_VERSION,
  type FinOutcomeKind,
} from "./types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const REDACTED = "[redacted]";

/** Variables a Node CLI needs to start and reach the network. Nothing else is inherited. */
const INHERITED_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TZ",
  "SYSTEMROOT",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
] as const;

export interface CliRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  spawnError?: string;
}

export interface CliRunOptions {
  credential?: FinCredential;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Test seam: replace the spawned binary. */
  binary?: string;
  /** Test seam: replace the private CLI config directory. */
  configDir?: string;
  /** Test seam: replace the inherited parent environment. */
  parentEnv?: NodeJS.ProcessEnv;
}

export function privateCliConfigDir(): string {
  return globalAgentPath("sf-pi", "sf-fin", "cli-config");
}

/** Build the child environment. Exported for Behavior Proofs. */
export function buildChildEnv(
  credential: FinCredential | undefined,
  configDir: string,
  parentEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_ENV) {
    const value = parentEnv[name];
    if (value !== undefined) env[name] = value;
  }
  env.INTERCOM_CONFIG_DIR = configDir;
  env.NO_COLOR = "1";
  if (credential) {
    env[ENV_TOKEN] = credential.token;
    env[ENV_REGION] = credential.region;
    // The CLI requires an app id only for legacy Basic-auth API keys; personal
    // and app access tokens are Bearer tokens and ignore it.
    const appId = parentEnv[ENV_APP_ID]?.trim();
    if (appId) env[ENV_APP_ID] = appId;
  }
  return env;
}

export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join(REDACTED);
}

export async function runFinCli(
  args: string[],
  options: CliRunOptions = {},
): Promise<CliRunResult> {
  const configDir = options.configDir ?? privateCliConfigDir();
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const env = buildChildEnv(options.credential, configDir, options.parentEnv);
  const secret = options.credential?.token;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(options.binary ?? CLI_BINARY, args, {
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const finish = (exitCode: number | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode,
        stdout: redactSecret(stdout, secret),
        stderr: redactSecret(stderr, secret),
        timedOut,
        truncated,
        ...(spawnError ? { spawnError: redactSecret(spawnError, secret) } : {}),
      });
    };

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        truncated = true;
        child.kill("SIGTERM");
        return;
      }
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const onAbort = () => child.kill("SIGTERM");
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(null, error.code === "ENOENT" ? "ENOENT" : error.message);
    });
    child.on("close", (code) => finish(code));
  });
}

/** Map a CLI result onto SF Fin's stable outcome classes (CLI exit codes 2–6). */
export function classifyCliResult(result: CliRunResult): FinOutcomeKind {
  if (result.spawnError === "ENOENT") return "cli_missing";
  if (result.timedOut) return "timeout";
  if (result.exitCode === 0 && !result.truncated) return "ok";
  switch (result.exitCode) {
    case 2:
      return "auth_expired";
    case 3:
      return "rate_limited";
    case 4:
      return "not_found";
    case 5:
      return "permission_denied";
    case 6:
      return "timeout";
    default:
      return "cli_error";
  }
}

/**
 * Find the CLI's `{ "error": { ... } }` envelope. With `--verbose` the CLI
 * prints HTTP trace lines before it, so scan for the last top-level JSON block.
 */
function findErrorEnvelope(
  result: CliRunResult,
): { code?: unknown; message?: unknown } | undefined {
  for (const stream of [result.stderr, result.stdout]) {
    const lines = stream.split("\n");
    for (let start = lines.length - 1; start >= 0; start--) {
      if (!lines[start]?.startsWith("{")) continue;
      try {
        const parsed = JSON.parse(lines.slice(start).join("\n")) as {
          error?: Record<string, unknown>;
        };
        if (parsed.error && typeof parsed.error === "object") return parsed.error;
      } catch {
        // Not a complete JSON block from here; keep scanning upward.
      }
    }
  }
  return undefined;
}

/** Extract the CLI's error message, falling back to the first stderr line. */
export function readCliErrorMessage(result: CliRunResult): string | undefined {
  const envelope = findErrorEnvelope(result);
  if (typeof envelope?.message === "string") return envelope.message;
  const fallback = (result.stderr || result.spawnError || "").trim();
  return fallback ? fallback.split("\n")[0] : undefined;
}

/** Extract the CLI's error code (`auth_error`, `permission_denied`, …) when present. */
export function readCliErrorCode(result: CliRunResult): string | undefined {
  const envelope = findErrorEnvelope(result);
  return typeof envelope?.code === "string" ? envelope.code : undefined;
}

/**
 * Defense in depth for verbose traces: drop credential-bearing header and
 * cookie lines and mask bearer/basic values even when the exact secret is
 * not known (for example, a token echoed in a different form).
 */
export function scrubTrace(text: string, secret: string | undefined): string {
  return redactSecret(text, secret)
    .split("\n")
    .map((line) =>
      /^\s*[<>]?\s*(authorization|cookie|set-cookie|x-intercom-token)\s*:/i.test(line)
        ? line.replace(/:.*/, ": [redacted]")
        : line,
    )
    .join("\n")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 [redacted]");
}

export function parseCliVersion(stdout: string): string | undefined {
  return stdout.trim().match(/^v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/m)?.[1];
}

/** True when `version` is at least `minimum` (numeric major.minor.patch; prerelease tags ignored). */
export function isCliVersionSupported(version: string, minimum: string = MIN_CLI_VERSION): boolean {
  const parse = (value: string) =>
    value
      .split(/[-+]/)[0]
      .split(".")
      .map((part) => Number(part));
  const [a, b] = [parse(version), parse(minimum)];
  for (let i = 0; i < 3; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (Number.isNaN(left)) return false;
    if (left !== right) return left > right;
  }
  return true;
}
