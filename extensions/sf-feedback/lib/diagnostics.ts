/* SPDX-License-Identifier: Apache-2.0 */
/** Collect best-effort diagnostics for public GitHub issues. */
import { existsSync, readFileSync } from "node:fs";
import { release, arch, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SF_PI_REGISTRY } from "../../../catalog/registry.ts";
import { getDisabledExtensionsForCwd } from "../../sf-pi-manager/lib/package-state.ts";
import { sanitizeLines, sanitizeRemoteUrl, sanitizeText } from "./sanitize.ts";
import type { CommandResult, Diagnostics, GithubStatus, ToolAvailability } from "./types.ts";

export type ExecFn = (
  command: string,
  args: string[],
  options?: { timeout?: number; cwd?: string },
) => Promise<{ stdout: string; stderr: string; code: number }>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "../../..");

export async function collectDiagnostics(exec: ExecFn, cwd: string): Promise<Diagnostics> {
  const disabledFiles = getDisabledExtensionsForCwd(cwd);
  const enabledExtensions = SF_PI_REGISTRY.filter((ext) => !disabledFiles.has(ext.file)).map(
    (ext) => ext.id,
  );
  const disabledExtensions = SF_PI_REGISTRY.filter((ext) => disabledFiles.has(ext.file)).map(
    (ext) => ext.id,
  );

  const [
    npmVersion,
    piVersion,
    sfVersion,
    sfPlugins,
    sfConfig,
    gitInside,
    gitBranch,
    gitStatus,
    gitRemote,
  ] = await Promise.all([
    run(exec, "npm", ["--version"]),
    run(exec, "pi", ["--version"]),
    run(exec, "sf", ["--version", "--json"]),
    run(exec, "sf", ["plugins", "--core", "--json"]),
    run(exec, "sf", ["config", "get", "target-org", "org-api-version", "--json"]),
    run(exec, "git", ["rev-parse", "--is-inside-work-tree"], { cwd }),
    run(exec, "git", ["branch", "--show-current"], { cwd }),
    run(exec, "git", ["status", "--short"], { cwd }),
    run(exec, "git", ["remote", "get-url", "origin"], { cwd }),
  ]);

  const github = await detectGithubStatus(exec);
  const tools = await detectTools(exec, ["gh", "git", "node", "npm", "sf", "pi"]);

  return {
    sfPiVersion: readPackageVersion(),
    piVersion: firstLine(piVersion.stdout) || statusLabel(piVersion),
    nodeVersion: process.version,
    npmVersion: firstLine(npmVersion.stdout) || statusLabel(npmVersion),
    platform: platform(),
    osRelease: release(),
    arch: arch(),
    shell: shellName(),
    terminal: terminalName(),
    term: process.env.TERM || "unknown",
    colorTerm: process.env.COLORTERM || "unknown",
    locale: process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || "unknown",
    terminalSize: terminalSize(),
    isCI: Boolean(process.env.CI),
    isTty: Boolean(process.stdout.isTTY),
    cwd: sanitizeCwd(cwd),
    gitInsideWorkTree: firstLine(gitInside.stdout) === "true",
    gitBranch: sanitizeText(firstLine(gitBranch.stdout) || "unknown"),
    gitStatusSummary: summarizeGitStatus(gitStatus),
    gitRemote: sanitizeRemoteUrl(gitRemote.stdout),
    sfCliVersion: parseSfVersion(sfVersion),
    sfCliPlugins: summarizeSfPlugins(sfPlugins),
    sfOrgConnected: summarizeSfConfig(sfConfig).connected,
    sfOrgApiVersion: summarizeSfConfig(sfConfig).apiVersion,
    enabledExtensions,
    disabledExtensions,
    github,
    tools,
  };
}

export async function detectGithubStatus(exec: ExecFn): Promise<GithubStatus> {
  const ghVersion = await run(exec, "gh", ["--version"]);
  if (!ghVersion.ok) {
    return { ghAvailable: false, authenticated: false, detail: "GitHub CLI not found" };
  }

  const user = await run(exec, "gh", ["api", "user", "--jq", ".login"]);
  if (user.ok && firstLine(user.stdout)) {
    return {
      ghAvailable: true,
      authenticated: true,
      login: sanitizeText(firstLine(user.stdout)),
    };
  }

  const status = await run(exec, "gh", ["auth", "status"]);
  return {
    ghAvailable: true,
    authenticated: false,
    detail: sanitizeText(
      firstLine(status.stderr) || firstLine(status.stdout) || "Not authenticated",
    ),
  };
}

export async function detectTools(exec: ExecFn, names: string[]): Promise<ToolAvailability[]> {
  return Promise.all(
    names.map(async (name) => {
      const result = await run(exec, name, ["--version"]);
      return {
        name,
        available: result.ok,
        detail: result.ok
          ? sanitizeText(firstLine(result.stdout) || firstLine(result.stderr))
          : undefined,
      };
    }),
  );
}

async function run(
  exec: ExecFn,
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number } = {},
): Promise<CommandResult> {
  try {
    const result = await exec(command, args, {
      timeout: options.timeout ?? 8000,
      cwd: options.cwd,
    });
    return {
      command: [command, ...args].join(" "),
      ok: result.code === 0,
      stdout: sanitizeText(result.stdout || ""),
      stderr: sanitizeText(result.stderr || ""),
      code: result.code,
    };
  } catch (error) {
    return {
      command: [command, ...args].join(" "),
      ok: false,
      stdout: "",
      stderr: sanitizeText(error instanceof Error ? error.message : String(error)),
      code: 1,
    };
  }
}

function readPackageVersion(): string {
  const packagePath = path.join(PACKAGE_ROOT, "package.json");
  if (!existsSync(packagePath)) return "unknown";
  try {
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function statusLabel(result: CommandResult): string {
  return result.ok ? "available" : "unavailable";
}

function shellName(): string {
  return sanitizeText(
    process.env.SHELL || process.env.ComSpec || process.env.PSModulePath || "unknown",
  );
}

function terminalName(): string {
  return sanitizeText(
    process.env.TERM_PROGRAM ||
      process.env.WT_SESSION ||
      process.env.TERMINAL_EMULATOR ||
      process.env.TERM_PROGRAM_VERSION ||
      "unknown",
  );
}

function terminalSize(): string {
  const columns = process.stdout.columns;
  const rows = process.stdout.rows;
  return columns && rows ? `${columns}x${rows}` : "unknown";
}

function sanitizeCwd(cwd: string): string {
  const normalized = sanitizeText(cwd);
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  if (normalized.startsWith("~") && parts.length > 3) {
    return `~/${parts.slice(1, 3).join("/")}/<project>`;
  }
  return normalized;
}

function summarizeGitStatus(result: CommandResult): string {
  if (!result.ok) return "unavailable";
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return "clean";
  const staged = lines.filter((line) => line[0] && line[0] !== " " && line[0] !== "?").length;
  const unstaged = lines.filter((line) => line[1] && line[1] !== " ").length;
  const untracked = lines.filter((line) => line.startsWith("??")).length;
  return `${lines.length} changed file(s): ${staged} staged, ${unstaged} unstaged, ${untracked} untracked`;
}

function parseSfVersion(result: CommandResult): string {
  if (!result.ok) return "unavailable";
  try {
    const parsed = JSON.parse(result.stdout) as { cliVersion?: unknown; version?: unknown };
    return sanitizeText(
      String(parsed.cliVersion || parsed.version || firstLine(result.stdout) || "available"),
    );
  } catch {
    return sanitizeText(firstLine(result.stdout) || "available");
  }
}

function summarizeSfPlugins(result: CommandResult): string {
  if (!result.ok) return "unavailable";
  try {
    const parsed = JSON.parse(result.stdout) as { result?: unknown };
    const plugins = Array.isArray(parsed.result) ? parsed.result : [];
    return `${plugins.length} core plugin(s)`;
  } catch {
    return "available";
  }
}

function summarizeSfConfig(result: CommandResult): { connected: string; apiVersion: string } {
  if (!result.ok) return { connected: "unknown", apiVersion: "unknown" };
  try {
    const parsed = JSON.parse(result.stdout) as {
      result?: Array<{ name?: string; value?: unknown }>;
    };
    const rows = Array.isArray(parsed.result) ? parsed.result : [];
    const hasTargetOrg = rows.some((row) => row.name === "target-org" && row.value);
    const apiVersion = rows.find((row) => row.name === "org-api-version")?.value;
    return {
      connected: hasTargetOrg ? "configured (alias redacted)" : "not configured",
      apiVersion: apiVersion ? sanitizeText(String(apiVersion)) : "unknown",
    };
  } catch {
    return { connected: "unknown", apiVersion: "unknown" };
  }
}

export function renderDiagnosticsText(diagnostics: Diagnostics): string {
  return sanitizeLines(
    [
      `SF Pi: ${diagnostics.sfPiVersion}`,
      `Pi: ${diagnostics.piVersion}`,
      `Node: ${diagnostics.nodeVersion}`,
      `npm: ${diagnostics.npmVersion}`,
      `OS: ${diagnostics.platform} ${diagnostics.osRelease} ${diagnostics.arch}`,
      `Shell: ${diagnostics.shell}`,
      `Terminal: ${diagnostics.terminal}`,
      `TERM: ${diagnostics.term}`,
      `COLORTERM: ${diagnostics.colorTerm}`,
      `Locale: ${diagnostics.locale}`,
      `Terminal size: ${diagnostics.terminalSize}`,
      `TTY: ${diagnostics.isTty ? "yes" : "no"}`,
      `CI: ${diagnostics.isCI ? "yes" : "no"}`,
      `CWD: ${diagnostics.cwd}`,
      `Git work tree: ${diagnostics.gitInsideWorkTree ? "yes" : "no"}`,
      `Git branch: ${diagnostics.gitBranch}`,
      `Git status: ${diagnostics.gitStatusSummary}`,
      `Git remote: ${diagnostics.gitRemote}`,
      `SF CLI: ${diagnostics.sfCliVersion}`,
      `SF CLI plugins: ${diagnostics.sfCliPlugins}`,
      `SF CLI org: ${diagnostics.sfOrgConnected}`,
      `Org API version: ${diagnostics.sfOrgApiVersion}`,
      `GitHub CLI: ${diagnostics.github.ghAvailable ? "available" : "unavailable"}`,
      `GitHub auth: ${diagnostics.github.authenticated ? `@${diagnostics.github.login ?? "detected"}` : "not authenticated"}`,
      `Enabled extensions: ${diagnostics.enabledExtensions.join(", ") || "none"}`,
      `Disabled extensions: ${diagnostics.disabledExtensions.join(", ") || "none"}`,
      `Tools: ${diagnostics.tools.map((tool) => `${tool.name}=${tool.available ? "yes" : "no"}`).join(", ")}`,
    ],
    80,
  );
}
