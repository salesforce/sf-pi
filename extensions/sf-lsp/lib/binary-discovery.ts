/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Language-server binary discovery.
 *
 * On Windows, executables carry an extension (`java.exe`, `node.exe`) and npm
 * installs CLIs as `.cmd` shims that can't be spawned without a shell. These
 * helpers honor `PATHEXT` on win32 and resolve npm shims to their Node entry
 * point so every server can be launched with an args array and no shell.
 *
 * The platform, environment, and file check are injectable so both branches are
 * testable on any runner. macOS and Linux keep the existing lookup order.
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface DiscoveryContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (file: string) => boolean;
  homedir: string;
}

export function defaultDiscoveryContext(): DiscoveryContext {
  return {
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    homedir: os.homedir(),
  };
}

function pathModule(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

/** Extensions to try for a bare command name, in `PATHEXT` order on Windows. */
export function executableExtensions(ctx: DiscoveryContext): string[] {
  if (ctx.platform !== "win32") return [""];
  const fromEnv = (ctx.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.startsWith("."));
  return fromEnv.length > 0 ? fromEnv : [".exe", ".cmd", ".bat"];
}

/** Find `binary` on PATH (plus the usual POSIX extra folders off Windows). */
export function which(
  binary: string,
  ctx: DiscoveryContext = defaultDiscoveryContext(),
): string | undefined {
  const p = pathModule(ctx.platform);
  const delimiter = ctx.platform === "win32" ? ";" : ":";
  const pathValue = ctx.env.PATH ?? ctx.env.Path ?? "";
  const extraDirs =
    ctx.platform === "win32"
      ? []
      : [
          "/usr/local/bin",
          "/opt/homebrew/bin",
          p.join(ctx.homedir, ".volta", "bin"),
          p.join(ctx.homedir, ".nvm", "current", "bin"),
        ];
  const extensions = executableExtensions(ctx);
  for (const dir of [...pathValue.split(delimiter).filter(Boolean), ...extraDirs]) {
    for (const ext of extensions) {
      const candidate = p.join(dir, `${binary}${ext}`);
      if (ctx.exists(candidate)) return candidate;
    }
  }
  return undefined;
}

export function findNodeBinary(
  ctx: DiscoveryContext = defaultDiscoveryContext(),
): string | undefined {
  return (
    ctx.env.NODE_PATH ||
    which("node", ctx) ||
    (ctx.platform === "win32" ? undefined : "/usr/bin/node")
  );
}

export function findJavaBinary(
  ctx: DiscoveryContext = defaultDiscoveryContext(),
): string | undefined {
  const p = pathModule(ctx.platform);
  const javaName = ctx.platform === "win32" ? "java.exe" : "java";
  const javaHome = ctx.env.JAVA_HOME;
  if (javaHome) {
    const candidate = p.join(javaHome, "bin", javaName);
    if (ctx.exists(candidate)) return candidate;
  }

  const candidates = [
    ctx.env.SF_LSP_JAVA,
    ...(ctx.platform === "win32"
      ? []
      : [
          "/opt/homebrew/opt/openjdk@21/bin/java",
          "/opt/homebrew/opt/openjdk@17/bin/java",
          "/opt/homebrew/opt/openjdk@11/bin/java",
          "/opt/homebrew/opt/openjdk/bin/java",
          "/usr/bin/java",
          "/usr/local/bin/java",
        ]),
    which("java", ctx),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return candidates.find((candidate) => ctx.exists(candidate));
}

/**
 * Resolve an npm `.cmd` shim to the JavaScript file it runs. npm writes the
 * entry as `"%dp0%\node_modules\…\bin\x.js"`; resolve it relative to the shim.
 * Returns undefined when the shim can't be read or the entry doesn't exist.
 */
export function resolveNpmShimEntry(
  shim: string,
  ctx: DiscoveryContext = defaultDiscoveryContext(),
  readText: (file: string) => string = (file) => readFileSync(file, "utf8"),
): string | undefined {
  if (!shim.toLowerCase().endsWith(".cmd")) return undefined;
  let text: string;
  try {
    text = readText(shim);
  } catch {
    return undefined;
  }
  // The last quoted "%dp0%\…\x.js" (or .cjs/.mjs) is the entry; earlier quoted
  // %dp0% references are the bundled node.exe check.
  const matches = [...text.matchAll(/"%dp0%\\([^"%]+\.(?:c|m)?js)"/gi)];
  const relative = matches.at(-1)?.[1];
  if (!relative) return undefined;
  const p = path.win32;
  const entry = p.join(p.dirname(shim), relative);
  return ctx.exists(entry) ? entry : undefined;
}
