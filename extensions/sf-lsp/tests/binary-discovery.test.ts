/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for language-server binary discovery. The platform, environment, and
 * file check are injected, so the Windows and POSIX branches run on any runner.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type DiscoveryContext,
  executableExtensions,
  findJavaBinary,
  findNodeBinary,
  resolveNpmShimEntry,
  which,
} from "../lib/binary-discovery.ts";

function ctx(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  files: string[],
  homedir = platform === "win32" ? "C:\\Users\\dev" : "/home/dev",
): DiscoveryContext {
  const set = new Set(files.map((file) => file.toLowerCase()));
  return { platform, env, exists: (file) => set.has(file.toLowerCase()), homedir };
}

const W = path.win32;
const WIN_NODE_DIR = "C:\\apps\\nodejs";
const WIN_NPM_DIR = "C:\\Users\\dev\\AppData\\Roaming\\npm";
const WIN_JDK = "C:\\apps\\jdk-21";
const WIN_PATH = [WIN_NODE_DIR, WIN_NPM_DIR].join(";");

describe("binary discovery on Windows", () => {
  const PATHEXT = ".COM;.EXE;.BAT;.CMD";

  it("finds node.exe on PATH", () => {
    const c = ctx("win32", { PATH: WIN_PATH, PATHEXT }, [W.join(WIN_NODE_DIR, "node.exe")]);
    expect(findNodeBinary(c)).toBe(W.join(WIN_NODE_DIR, "node.exe"));
  });

  it("never falls back to /usr/bin/node", () => {
    expect(findNodeBinary(ctx("win32", { PATH: WIN_PATH, PATHEXT }, []))).toBeUndefined();
  });

  it("finds java.exe under JAVA_HOME, including a trailing backslash", () => {
    const java = W.join(WIN_JDK, "bin", "java.exe");
    expect(findJavaBinary(ctx("win32", { JAVA_HOME: `${WIN_JDK}\\`, PATHEXT }, [java]))).toBe(java);
  });

  it("finds java.exe on PATH when JAVA_HOME is unset", () => {
    const jdkBin = W.join(WIN_JDK, "bin");
    const java = W.join(jdkBin, "java.exe");
    expect(findJavaBinary(ctx("win32", { PATH: jdkBin, PATHEXT }, [java]))).toBe(java);
  });

  it("finds an npm .cmd shim and resolves it to the package's JavaScript entry", () => {
    const shim = W.join(WIN_NPM_DIR, "lwc-language-server.cmd");
    const entry = W.join(
      WIN_NPM_DIR,
      "node_modules",
      "@salesforce",
      "lwc-language-server",
      "bin",
      "lwc-language-server.js",
    );
    const c = ctx("win32", { PATH: WIN_PATH, PATHEXT }, [shim, entry]);
    expect(which("lwc-language-server", c)).toBe(shim);
    // Mirrors the shim npm generates on Windows (bundled node.exe check first).
    const npmShim = [
      "@ECHO off",
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ")",
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@salesforce\\lwc-language-server\\bin\\lwc-language-server.js" %*',
    ].join("\r\n");
    expect(resolveNpmShimEntry(shim, c, () => npmShim)).toBe(entry);
  });

  it("returns undefined for a shim whose entry is missing or unreadable", () => {
    const shim = W.join(WIN_NPM_DIR, "tool.cmd");
    const c = ctx("win32", { PATH: WIN_PATH, PATHEXT }, [shim]);
    expect(resolveNpmShimEntry(shim, c, () => '"%dp0%\\node_modules\\x\\bin\\x.js" %*')).toBe(
      undefined,
    );
    expect(
      resolveNpmShimEntry(shim, c, () => {
        throw new Error("EACCES");
      }),
    ).toBeUndefined();
  });

  it("uses PATHEXT order and falls back to defaults when it is unset", () => {
    expect(executableExtensions(ctx("win32", { PATHEXT: ".EXE;.CMD" }, []))).toEqual([
      ".exe",
      ".cmd",
    ]);
    expect(executableExtensions(ctx("win32", {}, []))).toEqual([".com", ".exe", ".bat", ".cmd"]);
  });
});

describe("binary discovery on POSIX (unchanged behavior)", () => {
  it("finds extensionless node and java on PATH", () => {
    const c = ctx("linux", { PATH: "/usr/local/bin:/usr/bin" }, ["/usr/bin/node", "/usr/bin/java"]);
    expect(findNodeBinary(c)).toBe("/usr/bin/node");
    expect(findJavaBinary(c)).toBe("/usr/bin/java");
  });

  it("does not try Windows extensions", () => {
    expect(executableExtensions(ctx("darwin", { PATHEXT: ".EXE" }, []))).toEqual([""]);
    const c = ctx("linux", { PATH: "/opt/bin" }, ["/opt/bin/node.exe"]);
    expect(which("node", c)).toBeUndefined();
  });

  it("keeps the /usr/bin/node fallback", () => {
    expect(findNodeBinary(ctx("linux", { PATH: "" }, []))).toBe("/usr/bin/node");
  });

  it("prefers JAVA_HOME, then SF_LSP_JAVA", () => {
    expect(
      findJavaBinary(ctx("linux", { JAVA_HOME: "/jdk" }, ["/jdk/bin/java", "/usr/bin/java"])),
    ).toBe("/jdk/bin/java");
    expect(findJavaBinary(ctx("linux", { SF_LSP_JAVA: "/custom/java" }, ["/custom/java"]))).toBe(
      "/custom/java",
    );
  });

  it("does not treat a non-.cmd file as an npm shim", () => {
    const c = ctx("linux", {}, ["/usr/local/bin/lwc-language-server"]);
    expect(resolveNpmShimEntry("/usr/local/bin/lwc-language-server", c, () => "")).toBeUndefined();
  });
});
