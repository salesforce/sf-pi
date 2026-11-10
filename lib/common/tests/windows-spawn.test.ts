/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for shell-free Windows command resolution. Platform, PATH, and file
 * access are injected, so the Windows branch runs on any runner. Wrapper text
 * mirrors what npm, agent-browser, and the Salesforce CLI installer write.
 */
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearWindowsSpawnCache,
  npmGlobalPrefix,
  resolveSpawnCommand,
  spawnCommand,
  type WindowsSpawnContext,
} from "../windows-spawn.ts";

const W = path.win32;
const NODE_DIR = "C:\\apps\\nodejs";
const NODE = W.join(NODE_DIR, "node.exe");
const APPDATA = "C:\\Users\\dev\\AppData\\Roaming";
const LOCALAPPDATA = "C:\\Users\\dev\\AppData\\Local";
const NPM_PREFIX = W.join(APPDATA, "npm");
const SF_BIN = "C:\\Program Files\\sf\\bin";

const NPM_CMD = [
  ":: Created by npm, please don't edit manually.",
  "@ECHO OFF",
  'SET "NODE_EXE=%~dp0\\node.exe"',
  'SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"',
  '"%NODE_EXE%" "%NPM_CLI_JS%" %*',
].join("\r\n");

function packageBinCmd(relative: string): string {
  return [
    "@ECHO off",
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ")",
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relative}" %*`,
  ].join("\r\n");
}

const NATIVE_AGENT_BROWSER_CMD =
  '@ECHO off\r\n"%~dp0node_modules\\agent-browser\\bin\\agent-browser-win32-x64.exe" %*\r\n';

function ctx(
  files: Record<string, string>,
  env: NodeJS.ProcessEnv = { PATH: [NODE_DIR, NPM_PREFIX].join(";"), APPDATA, LOCALAPPDATA },
  platform: NodeJS.Platform = "win32",
): WindowsSpawnContext {
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

beforeEach(() => clearWindowsSpawnCache());

describe("npm package wrappers", () => {
  const intercomEntry = W.join(NPM_PREFIX, "node_modules", "@intercom", "cli", "dist", "index.js");
  const intercomCmd = packageBinCmd("node_modules\\@intercom\\cli\\dist\\index.js");

  it("runs a JavaScript bin through node and the package entry", () => {
    const c = ctx({ [W.join(NPM_PREFIX, "intercom.cmd")]: intercomCmd, [intercomEntry]: "" });
    expect(spawnCommand("intercom", ["--version"], c)).toEqual([
      NODE,
      [intercomEntry, "--version"],
    ]);
    expect(resolveSpawnCommand("intercom", c).shim).toBe(W.join(NPM_PREFIX, "intercom.cmd"));
  });

  it("runs the native exe that agent-browser writes into its wrapper", () => {
    const exe = W.join(
      NPM_PREFIX,
      "node_modules",
      "agent-browser",
      "bin",
      "agent-browser-win32-x64.exe",
    );
    const c = ctx({
      [W.join(NPM_PREFIX, "agent-browser.cmd")]: NATIVE_AGENT_BROWSER_CMD,
      [exe]: "",
    });
    expect(spawnCommand("agent-browser", ["get", "url"], c)).toEqual([exe, ["get", "url"]]);
  });

  it("keeps an argument with spaces and shell characters as one argument", () => {
    const c = ctx({ [W.join(NPM_PREFIX, "intercom.cmd")]: intercomCmd, [intercomEntry]: "" });
    const arg = 'https://example.invalid/a?x=1&y=2 "quoted" %PATH%';
    expect(spawnCommand("intercom", ["open", arg], c)[1]).toEqual([intercomEntry, "open", arg]);
  });

  it("returns the bare name when the wrapper is missing or its target does not exist", () => {
    expect(spawnCommand("intercom", ["--version"], ctx({}))).toEqual(["intercom", ["--version"]]);
    const shimOnly = ctx({ [W.join(NPM_PREFIX, "intercom.cmd")]: intercomCmd });
    expect(spawnCommand("intercom", ["--version"], shimOnly)).toEqual(["intercom", ["--version"]]);
  });

  it("prefers a real .exe on PATH over a later wrapper", () => {
    const exe = W.join(NODE_DIR, "tool.exe");
    const c = ctx({ [exe]: "", [W.join(NPM_PREFIX, "tool.cmd")]: packageBinCmd("x.js") });
    expect(spawnCommand("tool", ["-v"], c)).toEqual([exe, ["-v"]]);
  });
});

describe("npm itself", () => {
  const bundled = W.join(NODE_DIR, "node_modules", "npm", "bin", "npm-cli.js");

  it("runs npm through node and the bundled npm-cli.js", () => {
    const c = ctx({ [W.join(NODE_DIR, "npm.cmd")]: NPM_CMD, [bundled]: "" });
    expect(spawnCommand("npm", ["root", "-g"], c)).toEqual([NODE, [bundled, "root", "-g"]]);
  });

  it("prefers an npm installed under the global prefix, like npm.cmd does", () => {
    const upgraded = W.join(NPM_PREFIX, "node_modules", "npm", "bin", "npm-cli.js");
    const c = ctx({ [W.join(NODE_DIR, "npm.cmd")]: NPM_CMD, [bundled]: "", [upgraded]: "" });
    expect(resolveSpawnCommand("npm", c).entry).toBe(upgraded);
  });

  it("reads the global prefix from env, then .npmrc, then APPDATA", () => {
    expect(npmGlobalPrefix(ctx({}, { npm_config_prefix: "D:\\npm" }))).toBe("D:\\npm");
    const rc = W.join("C:\\Users\\dev", ".npmrc");
    expect(
      npmGlobalPrefix(ctx({ [rc]: "prefix=E:\\tools\\npm\n" }, { USERPROFILE: "C:\\Users\\dev" })),
    ).toBe("E:\\tools\\npm");
    expect(npmGlobalPrefix(ctx({}, { APPDATA }))).toBe(NPM_PREFIX);
  });
});

describe("Salesforce CLI", () => {
  const env = { PATH: [SF_BIN, NPM_PREFIX].join(";"), APPDATA, LOCALAPPDATA };
  const clientBin = W.join(SF_BIN, "..", "client", "bin");

  it("uses the installer's bundled client: node.exe running run.js", () => {
    const c = ctx(
      {
        [W.join(SF_BIN, "sf.cmd")]: "@echo off\r\n",
        [W.join(clientBin, "node.exe")]: "",
        [W.join(clientBin, "run.js")]: "",
      },
      env,
    );
    expect(spawnCommand("sf", ["--version"], c)).toEqual([
      W.join(clientBin, "node.exe"),
      ["--no-deprecation", W.join(clientBin, "run.js"), "--version"],
    ]);
  });

  it("follows the installer's redirect to the auto-updated client", () => {
    const version = "2.150.0-abc1234";
    const updatedBin = W.join(LOCALAPPDATA, "sf", "client", version, "bin");
    const c = ctx(
      {
        [W.join(SF_BIN, "sf.cmd")]: "@echo off\r\n",
        [W.join(clientBin, "node.exe")]: "",
        [W.join(clientBin, "run.js")]: "",
        [W.join(LOCALAPPDATA, "sf", "client", "bin", "sf.cmd")]:
          `@echo off\r\n"%~dp0..\\${version}\\bin\\sf.cmd" %*\r\n`,
        [W.join(updatedBin, "node.exe")]: "",
        [W.join(updatedBin, "run.js")]: "",
      },
      env,
    );
    expect(spawnCommand("sf", ["--version"], c)).toEqual([
      W.join(updatedBin, "node.exe"),
      ["--no-deprecation", W.join(updatedBin, "run.js"), "--version"],
    ]);
  });

  it("uses the npm global layout through the generic wrapper path", () => {
    const run = W.join(NPM_PREFIX, "node_modules", "@salesforce", "cli", "bin", "run.js");
    const c = ctx(
      {
        [W.join(NPM_PREFIX, "sf.cmd")]: packageBinCmd(
          "node_modules\\@salesforce\\cli\\bin\\run.js",
        ),
        [run]: "",
      },
      env,
    );
    expect(spawnCommand("sf", ["org", "list"], c)).toEqual([NODE, [run, "org", "list"]]);
  });

  it("never routes through cmd.exe, and keeps user arguments as single args", () => {
    const c = ctx(
      {
        [W.join(SF_BIN, "sf.cmd")]: "@echo off\r\n",
        [W.join(clientBin, "node.exe")]: "",
        [W.join(clientBin, "run.js")]: "",
      },
      env,
    );
    const query = "SELECT Id FROM Account WHERE Name = 'A & B'";
    const [file, args] = spawnCommand("sf", ["data", "query", "-q", query], c);
    expect(file.toLowerCase()).not.toContain("cmd.exe");
    expect(args.at(-1)).toBe(query);
  });
});

describe("unchanged inputs", () => {
  it("leaves every command unchanged off Windows", () => {
    const c = ctx({ "/usr/local/bin/sf": "" }, { PATH: "/usr/local/bin" }, "linux");
    expect(spawnCommand("sf", ["--version"], c)).toEqual(["sf", ["--version"]]);
    expect(spawnCommand("npm", ["root", "-g"], c)).toEqual(["npm", ["root", "-g"]]);
  });

  it("leaves paths and names with an extension unchanged on Windows", () => {
    const c = ctx({});
    expect(spawnCommand("C:\\tools\\x.exe", ["a"], c)).toEqual(["C:\\tools\\x.exe", ["a"]]);
    expect(spawnCommand("node.exe", ["a"], c)).toEqual(["node.exe", ["a"]]);
  });
});
