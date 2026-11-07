/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for SF Fin's Windows npm shim resolution. Platform, PATH, and file
 * access are injected, so the Windows branch runs on any runner. Shim text
 * mirrors what npm generates on Windows.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  npmCommand,
  npmGlobalPrefix,
  readShimEntry,
  resolveNpmCommand,
  type ShimContext,
} from "../lib/npm-shim.ts";

const W = path.win32;
const NODE_DIR = "C:\\apps\\nodejs";
const APPDATA = "C:\\Users\\dev\\AppData\\Roaming";
const NPM_PREFIX = W.join(APPDATA, "npm");
const NODE = "C:\\apps\\nodejs\\node.exe";

const NPM_CMD = [
  ":: Created by npm, please don't edit manually.",
  "@ECHO OFF",
  "SETLOCAL",
  'SET "NODE_EXE=%~dp0\\node.exe"',
  'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"',
  'SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"',
  '"%NODE_EXE%" "%NPM_CLI_JS%" %*',
].join("\r\n");

const INTERCOM_CMD = [
  "@ECHO off",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ")",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@intercom\\cli\\dist\\index.js" %*',
].join("\r\n");

function ctx(
  files: Record<string, string>,
  env: NodeJS.ProcessEnv = { PATH: [NODE_DIR, NPM_PREFIX].join(";"), APPDATA },
  platform: NodeJS.Platform = "win32",
): ShimContext {
  const lower = new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    platform,
    env,
    exists: (file) => lower.has(file.toLowerCase()),
    readText: (file) => {
      const text = lower.get(file.toLowerCase());
      if (text === undefined) throw new Error("ENOENT");
      return text;
    },
    nodePath: NODE,
  };
}

const bundledNpmCli = W.join(NODE_DIR, "node_modules", "npm", "bin", "npm-cli.js");
const intercomEntry = W.join(NPM_PREFIX, "node_modules", "@intercom", "cli", "dist", "index.js");

describe("resolveNpmCommand on Windows", () => {
  it("runs npm through node and the bundled npm-cli.js", () => {
    const c = ctx({ [W.join(NODE_DIR, "npm.cmd")]: NPM_CMD, [bundledNpmCli]: "" });
    expect(npmCommand("npm", ["root", "-g"], c)).toEqual([NODE, [bundledNpmCli, "root", "-g"]]);
  });

  it("prefers an npm installed under the global prefix, like npm.cmd does", () => {
    const upgraded = W.join(NPM_PREFIX, "node_modules", "npm", "bin", "npm-cli.js");
    const c = ctx({ [W.join(NODE_DIR, "npm.cmd")]: NPM_CMD, [bundledNpmCli]: "", [upgraded]: "" });
    expect(resolveNpmCommand("npm", c).entry).toBe(upgraded);
  });

  it("runs intercom through node and the package's bin entry", () => {
    const c = ctx({ [W.join(NPM_PREFIX, "intercom.cmd")]: INTERCOM_CMD, [intercomEntry]: "" });
    expect(npmCommand("intercom", ["--version"], c)).toEqual([NODE, [intercomEntry, "--version"]]);
    expect(resolveNpmCommand("intercom", c).shim).toBe(W.join(NPM_PREFIX, "intercom.cmd"));
  });

  it("keeps an argument with spaces and shell characters as one argument", () => {
    const c = ctx({ [W.join(NPM_PREFIX, "intercom.cmd")]: INTERCOM_CMD, [intercomEntry]: "" });
    const arg = 'name with spaces & "quotes"';
    expect(npmCommand("intercom", ["fin", arg], c)[1]).toEqual([intercomEntry, "fin", arg]);
  });

  it("returns the bare name when the shim is missing or its entry doesn't exist", () => {
    expect(npmCommand("intercom", ["--version"], ctx({}))).toEqual(["intercom", ["--version"]]);
    const shimOnly = ctx({ [W.join(NPM_PREFIX, "intercom.cmd")]: INTERCOM_CMD });
    expect(npmCommand("intercom", ["--version"], shimOnly)).toEqual(["intercom", ["--version"]]);
  });
});

describe("resolveNpmCommand off Windows", () => {
  it("leaves the bare name unchanged", () => {
    const c = ctx({ "/usr/local/bin/intercom": "" }, { PATH: "/usr/local/bin" }, "linux");
    expect(npmCommand("npm", ["root", "-g"], c)).toEqual(["npm", ["root", "-g"]]);
    expect(npmCommand("intercom", ["--version"], c)).toEqual(["intercom", ["--version"]]);
  });
});

describe("readShimEntry and npmGlobalPrefix", () => {
  it("returns undefined for an unreadable shim", () => {
    expect(readShimEntry("C:\\x\\tool.cmd", ctx({}))).toBeUndefined();
  });

  it("reads the prefix from env, then .npmrc, then APPDATA", () => {
    expect(npmGlobalPrefix(ctx({}, { npm_config_prefix: "D:\\npm" }))).toBe("D:\\npm");
    const rc = W.join("C:\\Users\\dev", ".npmrc");
    expect(
      npmGlobalPrefix(
        ctx({ [rc]: "registry=x\nprefix=E:\\tools\\npm\n" }, { USERPROFILE: "C:\\Users\\dev" }),
      ),
    ).toBe("E:\\tools\\npm");
    expect(npmGlobalPrefix(ctx({}, { APPDATA }))).toBe(NPM_PREFIX);
  });
});
