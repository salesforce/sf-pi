/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for how SF Fin starts agent-browser. Platform, PATH, and file access are
 * injected, so the Windows branch runs on any runner. Shim text mirrors what npm
 * generates on Windows.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentBrowserCommand, type AgentBrowserContext } from "../lib/agent-browser-command.ts";

const W = path.win32;
const PREFIX = W.join("C:\\", "Users", "dev", "AppData", "Roaming", "npm");
const BIN = W.join(PREFIX, "node_modules", "agent-browser", "bin");
const EXE = W.join(BIN, "agent-browser-win32-x64.exe");
const JS = W.join(BIN, "agent-browser.js");
const NODE = W.join("C:\\", "apps", "nodejs", "node.exe");
const NATIVE_SHIM = String.raw`@ECHO off
"%~dp0node_modules\agent-browser\bin\agent-browser-win32-x64.exe" %*`;
const NODE_SHIM = String.raw`endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\agent-browser\bin\agent-browser.js" %*`;

function win(files: Record<string, string>): AgentBrowserContext {
  const find = (f: string) => Object.keys(files).find((k) => k.toLowerCase() === f.toLowerCase());
  return {
    platform: "win32",
    env: { PATH: [W.join("C:\\", "apps", "nodejs"), PREFIX].join(";") },
    exists: (f) => find(f) !== undefined,
    readText: (f) => {
      const k = find(f);
      if (k === undefined) throw new Error("ENOENT");
      return files[k]!;
    },
    nodePath: NODE,
  };
}

const ARGS = ["--session", "sf-pi", "--session-name", "sf-pi", "get", "url"];

describe("agentBrowserCommand on Windows", () => {
  it("runs the native exe the npm shim points at, not the bare name", () => {
    const ctx = win({ [W.join(PREFIX, "agent-browser.cmd")]: NATIVE_SHIM, [EXE]: "" });
    expect(agentBrowserCommand(ARGS, {}, ctx)).toEqual([EXE, ARGS]);
  });

  it("runs node with agent-browser.js when the shim points at the JavaScript entry", () => {
    const ctx = win({ [W.join(PREFIX, "agent-browser.cmd")]: NODE_SHIM, [JS]: "" });
    expect(agentBrowserCommand(ARGS, {}, ctx)).toEqual([NODE, [JS, ...ARGS]]);
  });

  it("does not need sh for the owner-only sign-in launch", () => {
    const ctx = win({ [W.join(PREFIX, "agent-browser.cmd")]: NATIVE_SHIM, [EXE]: "" });
    const url = "https://app.intercom.com/admins/sign_in;rm -rf ~";
    const [command, args] = agentBrowserCommand(
      ["--headed", "open", url],
      { ownerOnlyFiles: true },
      ctx,
    );
    expect(command).toBe(EXE);
    expect(args).toEqual(["--headed", "open", url]);
  });

  it("falls back to the bare name when no shim or target exists", () => {
    expect(agentBrowserCommand(ARGS, {}, win({}))).toEqual(["agent-browser", ARGS]);
    const shimOnly = win({ [W.join(PREFIX, "agent-browser.cmd")]: NATIVE_SHIM });
    expect(agentBrowserCommand(ARGS, {}, shimOnly)).toEqual(["agent-browser", ARGS]);
  });
});

describe("agentBrowserCommand on POSIX (unchanged)", () => {
  const posix: AgentBrowserContext = { ...win({}), platform: "linux", env: { PATH: "/usr/bin" } };

  it("runs agent-browser by name", () => {
    expect(agentBrowserCommand(ARGS, {}, posix)).toEqual(["agent-browser", ARGS]);
  });

  it("keeps umask 077 for owner-only launches, with arguments outside the shell string", () => {
    const hostile = "https://app.intercom.com/admins/sign_in;rm -rf ~";
    const [command, args] = agentBrowserCommand(["open", hostile], { ownerOnlyFiles: true }, posix);
    expect(command).toBe("sh");
    expect(args.slice(0, 3)).toEqual(["-c", 'umask 077; exec agent-browser "$@"', "sh"]);
    expect(args[1]).not.toContain(hostile);
    expect(args).toContain(hostile);
  });
});
