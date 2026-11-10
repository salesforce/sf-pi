/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shell-free command resolution for Windows.
 *
 * On Windows, CLIs installed by npm or the Salesforce CLI installer are `.cmd`
 * wrappers. Node cannot spawn a `.cmd` file without a shell, so a bare-name
 * spawn with `shell: false` fails with ENOENT. Routing through `cmd.exe` would
 * fix that but would also let the shell interpret user-supplied arguments
 * (URLs with `&`, SOQL, file paths, fill values).
 *
 * `resolveSpawnCommand()` instead maps a bare command name to the program the
 * wrapper would run, so callers can spawn it directly with an args array:
 *
 * 1. `sf` from the Salesforce CLI installer: the bundled `node.exe` running the
 *    client's `run.js`, following the `%LOCALAPPDATA%` auto-update redirect.
 * 2. Any `<name>.cmd` on PATH written by npm: the native `.exe` it points at,
 *    or the running Node binary with the package's JavaScript entry. npm's own
 *    `npm.cmd` (`NPM_CLI_JS`) is handled too.
 * 3. Otherwise the bare name, so the caller reports the usual not-found error.
 *
 * Off Windows every command is returned unchanged. Platform, environment, and
 * file access are injectable so both branches are testable on any runner.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface WindowsSpawnContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (file: string) => boolean;
  readText: (file: string) => string;
  /** Node binary used for JavaScript entries. Defaults to the running Node. */
  nodePath: string;
}

export function defaultWindowsSpawnContext(): WindowsSpawnContext {
  return {
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    readText: (file) => readFileSync(file, "utf8"),
    nodePath: process.execPath,
  };
}

export interface ResolvedSpawnCommand {
  /** Executable to spawn. */
  command: string;
  /** Arguments that go before the caller's arguments. */
  prefixArgs: string[];
  /** The `.cmd` wrapper that was resolved, when one was. */
  shim?: string;
  /** The program or script the wrapper runs, when resolved. */
  entry?: string;
}

const W = path.win32;
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: ResolvedSpawnCommand; at: number }>();

/** Clears the resolution cache. Test seam. */
export function clearWindowsSpawnCache(): void {
  cache.clear();
}

function pathDirs(ctx: WindowsSpawnContext): string[] {
  return (ctx.env.PATH ?? ctx.env.Path ?? "").split(";").filter(Boolean);
}

function readText(ctx: WindowsSpawnContext, file: string): string | undefined {
  try {
    return ctx.readText(file);
  } catch {
    return undefined;
  }
}

// -------------------------------------------------------------------------------------------------
// Salesforce CLI installer layout
// -------------------------------------------------------------------------------------------------

/** A Salesforce CLI client folder that ships its own `bin\node.exe` and oclif `run.js`. */
function bundledSfClient(clientDir: string, ctx: WindowsSpawnContext): ResolvedSpawnCommand | null {
  const binDir = W.join(clientDir, "bin");
  const node = W.join(binDir, "node.exe");
  if (!ctx.exists(node)) return null;
  const run = ["run.js", "run"].map((name) => W.join(binDir, name)).find(ctx.exists);
  return run ? { command: node, prefixArgs: ["--no-deprecation", run], entry: run } : null;
}

/**
 * The installer's `sf.cmd` first redirects to the auto-updated client at
 * `%LOCALAPPDATA%\sf\client\bin\sf.cmd`, which forwards to a versioned folder
 * (for example `..\2.150.0-abc1234\bin\sf.cmd`). Follow it so we run the same
 * version a shell would.
 */
function autoUpdatedSfClient(ctx: WindowsSpawnContext): ResolvedSpawnCommand | null {
  const localAppData = ctx.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const redirect = W.join(localAppData, "sf", "client", "bin", "sf.cmd");
  const text = ctx.exists(redirect) ? readText(ctx, redirect) : undefined;
  const version = text ? /\.\.\\([^\\"]+)\\bin\\sf\.cmd/i.exec(text)?.[1] : undefined;
  return version ? bundledSfClient(W.join(localAppData, "sf", "client", version), ctx) : null;
}

function resolveInstallerSf(dir: string, ctx: WindowsSpawnContext): ResolvedSpawnCommand | null {
  const clientDir = W.join(dir, "..", "client");
  if (!ctx.exists(W.join(clientDir, "bin", "node.exe"))) return null;
  return autoUpdatedSfClient(ctx) ?? bundledSfClient(clientDir, ctx);
}

// -------------------------------------------------------------------------------------------------
// npm wrappers
// -------------------------------------------------------------------------------------------------

/**
 * npm's global prefix on Windows: `npm_config_prefix`, then a `prefix=` line in
 * the user `.npmrc`, then npm's Windows default of `%APPDATA%\npm`.
 */
export function npmGlobalPrefix(ctx: WindowsSpawnContext): string | undefined {
  const fromEnv = ctx.env.npm_config_prefix ?? ctx.env.NPM_CONFIG_PREFIX;
  if (fromEnv) return fromEnv;
  const home = ctx.env.USERPROFILE ?? ctx.env.HOME;
  const rc = home ? readText(ctx, W.join(home, ".npmrc")) : undefined;
  const fromRc = rc ? /^\s*prefix\s*=\s*(.+?)\s*$/im.exec(rc)?.[1] : undefined;
  if (fromRc) return fromRc.replace(/^["']|["']$/g, "");
  return ctx.env.APPDATA ? W.join(ctx.env.APPDATA, "npm") : undefined;
}

/**
 * The program an npm-generated `.cmd` wrapper runs. Three formats exist:
 * - npm itself: `SET "NPM_CLI_JS=%~dp0\node_modules\npm\bin\npm-cli.js"`
 * - package bins: `"%_prog%"  "%dp0%\node_modules\pkg\bin\x.js" %*`
 * - native bins (agent-browser rewrites its wrapper): `"%~dp0node_modules\…\x.exe" %*`
 */
export function readShimTarget(
  shim: string,
  ctx: WindowsSpawnContext,
): ResolvedSpawnCommand | undefined {
  const text = readText(ctx, shim);
  if (!text) return undefined;
  const dir = W.dirname(shim);

  const npmCli = /SET\s+"NPM_CLI_JS=%~dp0\\?([^"]+\.js)"/i.exec(text)?.[1];
  if (npmCli) {
    // npm.cmd prefers an npm installed under the global prefix (`npm i -g npm`)
    // over the copy bundled with Node. Mirror that without running npm-prefix.js.
    const prefix = npmGlobalPrefix(ctx);
    const upgraded = prefix ? W.join(prefix, "node_modules", "npm", "bin", "npm-cli.js") : "";
    const bundled = W.join(dir, npmCli);
    const entry = [upgraded, bundled].find((candidate) => candidate && ctx.exists(candidate));
    return entry ? { command: ctx.nodePath, prefixArgs: [entry], shim, entry } : undefined;
  }

  // The last quoted %dp0% / %~dp0 reference is the target; earlier ones are the
  // optional bundled node.exe check.
  const refs = [...text.matchAll(/"%(?:~dp0|dp0%)\\?([^"%]+\.(?:exe|c?js|mjs))"/gi)];
  const relative = refs.at(-1)?.[1];
  if (!relative) return undefined;
  const entry = W.join(dir, relative);
  if (!ctx.exists(entry)) return undefined;
  return /\.exe$/i.test(entry)
    ? { command: entry, prefixArgs: [], shim, entry }
    : { command: ctx.nodePath, prefixArgs: [entry], shim, entry };
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

function resolveUncached(name: string, ctx: WindowsSpawnContext): ResolvedSpawnCommand {
  for (const dir of pathDirs(ctx)) {
    // A real executable on PATH can be spawned as-is.
    const exe = W.join(dir, `${name}.exe`);
    if (ctx.exists(exe)) return { command: exe, prefixArgs: [], entry: exe };

    const shim = W.join(dir, `${name}.cmd`);
    if (!ctx.exists(shim)) continue;
    const installer = name === "sf" ? resolveInstallerSf(dir, ctx) : null;
    const resolved = installer ? { ...installer, shim } : readShimTarget(shim, ctx);
    if (resolved) return resolved;
  }
  return { command: name, prefixArgs: [] };
}

/**
 * Resolve a bare command name, or an explicit `.cmd` wrapper path, to a
 * shell-free spawn on Windows. Other paths, names with an extension, and every
 * non-Windows platform are returned unchanged.
 */
export function resolveSpawnCommand(
  name: string,
  ctx: WindowsSpawnContext = defaultWindowsSpawnContext(),
  now: number = Date.now(),
): ResolvedSpawnCommand {
  if (ctx.platform !== "win32") return { command: name, prefixArgs: [] };
  // An explicit wrapper path (for example node_modules\.bin\x.cmd) can never be
  // spawned without a shell, so run the program it points at.
  if (/[\\/]/.test(name) && /\.cmd$/i.test(name)) {
    return (ctx.exists(name) && readShimTarget(name, ctx)) || { command: name, prefixArgs: [] };
  }
  if (/[\\/]/.test(name) || W.extname(name)) {
    return { command: name, prefixArgs: [] };
  }
  const usesDefaultFs = ctx.exists === existsSync;
  const key = `${name}\u0000${ctx.env.PATH ?? ctx.env.Path ?? ""}\u0000${ctx.env.LOCALAPPDATA ?? ""}`;
  const cached = usesDefaultFs ? cache.get(key) : undefined;
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  const value = resolveUncached(name, ctx);
  if (usesDefaultFs) cache.set(key, { value, at: now });
  return value;
}

/** `[command, args]` ready for a shell-free spawn. */
export function spawnCommand(
  name: string,
  args: readonly string[],
  ctx: WindowsSpawnContext = defaultWindowsSpawnContext(),
): [string, string[]] {
  const resolved = resolveSpawnCommand(name, ctx);
  return [resolved.command, [...resolved.prefixArgs, ...args]];
}

/**
 * Every PATH location of `name`, in PATH order: `which -a` without a `which`
 * binary, so it works on Windows. Off Windows it checks the bare name; on
 * Windows it honors PATHEXT (for example `pi.cmd`, `npm.cmd`, `node.exe`).
 */
export function findAllOnPath(
  name: string,
  ctx: WindowsSpawnContext = defaultWindowsSpawnContext(),
): string[] {
  const windows = ctx.platform === "win32";
  const p = windows ? W : path.posix;
  const dirs = (ctx.env.PATH ?? ctx.env.Path ?? "").split(windows ? ";" : ":").filter(Boolean);
  const extensions = windows
    ? (ctx.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .map((ext) => ext.trim().toLowerCase())
        .filter((ext) => ext.startsWith("."))
    : [""];
  const found: string[] = [];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = p.join(dir, `${name}${ext}`);
      if (ctx.exists(candidate) && !found.includes(candidate)) found.push(candidate);
    }
  }
  return found;
}
