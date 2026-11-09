/* SPDX-License-Identifier: Apache-2.0 */
/**
 * The process boundary between Fin browser sign-in and agent-browser.
 *
 * Cookie values go to agent-browser only on stdin (`batch` JSON) and come
 * back only from `cookies get --json`. They are never put in argv (visible in
 * process listings), never returned to tools, and never logged. Anything else
 * agent-browser prints is discarded, apart from a short status line.
 */
import { spawn } from "node:child_process";
import {
  agentBrowserCommand,
  defaultAgentBrowserContext,
  type AgentBrowserContext,
} from "./agent-browser-command.ts";
import type { BrowserCookie, SigninBrowser } from "./browser-signin.ts";

/** Same shared session SF Browser uses. */
const SESSION = "sf-pi";
const BASE_ARGS = ["--session", SESSION, "--session-name", SESSION];
const TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 4_000_000;

export interface SpawnResult {
  code: number | null;
  stdout: string;
}

/** Runs one agent-browser command. `stdin` carries any secret payload. */
export type SpawnAgentBrowser = (
  args: string[],
  options: { stdin?: string; ownerOnlyFiles?: boolean },
) => Promise<SpawnResult>;

/**
 * Build the agent-browser runner. On macOS and Linux a launch that will hold a
 * Fin login runs under `umask 077` (arguments through "$@", never in the shell
 * string). On Windows the program behind the npm shim runs directly, because a
 * bare-name spawn of `agent-browser.cmd` fails with ENOENT (see
 * agent-browser-command.ts). `ctx` and `spawnFn` are test seams.
 */
export function createSpawnAgentBrowser(
  ctx: AgentBrowserContext = defaultAgentBrowserContext(),
  spawnFn: typeof spawn = spawn,
): SpawnAgentBrowser {
  return (args, options) =>
    new Promise((resolve) => {
      const [command, commandArgs] = agentBrowserCommand([...BASE_ARGS, ...args], options, ctx);
      const child = spawnFn(command, commandArgs, {
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
      let stdout = "";
      let bytes = 0;
      let settled = false;
      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout });
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(null);
      }, TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT_BYTES) child.kill("SIGTERM");
        else stdout += chunk.toString("utf8");
      });
      child.on("error", () => finish(null));
      child.on("close", (code) => finish(code));
      child.stdin.end(options.stdin ?? "");
    });
}

/** Default runner for the current platform. */
export const spawnAgentBrowser: SpawnAgentBrowser = (args, options) =>
  createSpawnAgentBrowser()(args, options);

/** Parses `cookies get --json` output; tolerant of a leading status line. */
export function parseCookieOutput(stdout: string): BrowserCookie[] {
  const start = stdout.indexOf("{");
  if (start < 0) return [];
  try {
    const parsed = JSON.parse(stdout.slice(start)) as {
      data?: { cookies?: unknown } | unknown[];
      cookies?: unknown;
    };
    const list = Array.isArray(parsed.data)
      ? parsed.data
      : ((parsed.data as { cookies?: unknown } | undefined)?.cookies ?? parsed.cookies);
    if (!Array.isArray(list)) return [];
    return list.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const cookie = entry as Record<string, unknown>;
      if (typeof cookie.name !== "string" || typeof cookie.value !== "string") return [];
      if (typeof cookie.domain !== "string") return [];
      return [
        {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          ...(typeof cookie.expires === "number" ? { expires: cookie.expires } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

export function createSigninBrowser(spawnFn: SpawnAgentBrowser = spawnAgentBrowser): SigninBrowser {
  return {
    async openSignIn(url) {
      // agent-browser applies --headed only at launch: relaunch the shared
      // session once, visibly, with owner-only files.
      await spawnFn(["close"], {});
      const result = await spawnFn(["--headed", "open", url], { ownerOnlyFiles: true });
      if (result.code !== 0) throw new Error("Could not open the Fin sign-in window.");
    },
    async currentUrl() {
      const result = await spawnFn(["get", "url"], {});
      if (result.code !== 0) return undefined;
      return result.stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line.startsWith("https://"));
    },
    async cookies() {
      const result = await spawnFn(["cookies", "get", "--json"], {});
      return result.code === 0 ? parseCookieOutput(result.stdout) : [];
    },
    async close() {
      await spawnFn(["close"], {});
    },
    async batch(commands) {
      if (!commands.length) return true;
      const result = await spawnFn(["batch", "--json", "--omit-command", "--bail"], {
        stdin: JSON.stringify(commands),
      });
      return result.code === 0;
    },
  };
}
