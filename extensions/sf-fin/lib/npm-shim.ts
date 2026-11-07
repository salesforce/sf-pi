/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Windows npm shim resolution for SF Fin.
 *
 * On Windows, `npm` and npm-installed CLIs such as `intercom` are `.cmd` shims.
 * Node can't spawn a `.cmd` file without a shell, so a shell-free spawn of the
 * bare name fails with ENOENT. This module finds the shim on PATH and returns
 * the Node entry point it would run, so callers can spawn `node <entry> ...args`
 * with an args array and no shell.
 *
 * Off Windows it returns the bare command unchanged. Platform, PATH, and file
 * access are injectable so both branches are testable on any runner.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface ShimContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (file: string) => boolean;
  readText: (file: string) => string;
  /** Node binary used to run resolved entries. Defaults to the running Node. */
  nodePath: string;
}

export function defaultShimContext(): ShimContext {
  return {
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    readText: (file) => readFileSync(file, "utf8"),
    nodePath: process.execPath,
  };
}

/** Folders on PATH that hold `<name>.cmd`, in PATH order (Windows only). */
function findCmdShim(name: string, ctx: ShimContext): string | undefined {
  const pathValue = ctx.env.PATH ?? ctx.env.Path ?? "";
  for (const dir of pathValue.split(";").filter(Boolean)) {
    const candidate = path.win32.join(dir, `${name}.cmd`);
    if (ctx.exists(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Read the JavaScript entry from an npm-generated `.cmd` shim.
 *
 * Two shim formats exist:
 * - package bins: `"%_prog%"  "%dp0%\node_modules\pkg\dist\index.js" %*`
 * - npm itself: `SET "NPM_CLI_JS=%~dp0\node_modules\npm\bin\npm-cli.js"`
 */
export function readShimEntry(shim: string, ctx: ShimContext): string | undefined {
  let text: string;
  try {
    text = ctx.readText(shim);
  } catch {
    return undefined;
  }
  const dir = path.win32.dirname(shim);
  const npmCli = /SET\s+"NPM_CLI_JS=%~dp0\\([^"]+\.js)"/i.exec(text)?.[1];
  if (npmCli) {
    // npm.cmd prefers an npm installed under the global prefix (`npm i -g npm`)
    // over the copy bundled with Node. Mirror that without running npm-prefix.js.
    const prefix = npmGlobalPrefix(ctx);
    const upgraded = prefix
      ? path.win32.join(prefix, "node_modules", "npm", "bin", "npm-cli.js")
      : undefined;
    if (upgraded && ctx.exists(upgraded)) return upgraded;
    const bundled = path.win32.join(dir, npmCli);
    return ctx.exists(bundled) ? bundled : undefined;
  }
  const packageBins = [...text.matchAll(/"%dp0%\\([^"%]+\.(?:c|m)?js)"/gi)];
  const relative = packageBins.at(-1)?.[1];
  if (!relative) return undefined;
  const entry = path.win32.join(dir, relative);
  return ctx.exists(entry) ? entry : undefined;
}

/**
 * npm's global prefix on Windows: `npm_config_prefix`, then a `prefix=` line in
 * the user `.npmrc`, then npm's Windows default of `%APPDATA%\npm`.
 */
export function npmGlobalPrefix(ctx: ShimContext): string | undefined {
  const fromEnv = ctx.env.npm_config_prefix ?? ctx.env.NPM_CONFIG_PREFIX;
  if (fromEnv) return fromEnv;
  const home = ctx.env.USERPROFILE ?? ctx.env.HOME;
  if (home) {
    try {
      const rc = ctx.readText(path.win32.join(home, ".npmrc"));
      const line = /^\s*prefix\s*=\s*(.+?)\s*$/im.exec(rc)?.[1];
      if (line) return line.replace(/^["']|["']$/g, "");
    } catch {
      // No user .npmrc.
    }
  }
  return ctx.env.APPDATA ? path.win32.join(ctx.env.APPDATA, "npm") : undefined;
}

export interface ResolvedCommand {
  /** Executable to spawn. */
  command: string;
  /** Arguments to put before the caller's arguments. */
  prefixArgs: string[];
  /** The shim that was resolved, when one was. */
  shim?: string;
  /** The JavaScript entry point, when resolved. */
  entry?: string;
}

/**
 * Resolve a CLI name to a shell-free invocation. On win32, `<name>.cmd` on PATH
 * becomes `node <entry>`. Otherwise, or when nothing resolves, the bare name is
 * returned so the caller reports the usual not-found error.
 */
export function resolveNpmCommand(
  name: string,
  ctx: ShimContext = defaultShimContext(),
): ResolvedCommand {
  if (ctx.platform !== "win32") return { command: name, prefixArgs: [] };
  const shim = findCmdShim(name, ctx);
  const entry = shim ? readShimEntry(shim, ctx) : undefined;
  if (!shim || !entry) return { command: name, prefixArgs: [] };
  return { command: ctx.nodePath, prefixArgs: [entry], shim, entry };
}

/** `[command, args]` ready for a shell-free spawn. */
export function npmCommand(
  name: string,
  args: string[],
  ctx: ShimContext = defaultShimContext(),
): [string, string[]] {
  const resolved = resolveNpmCommand(name, ctx);
  return [resolved.command, [...resolved.prefixArgs, ...args]];
}
