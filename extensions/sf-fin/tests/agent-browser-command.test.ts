/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for how SF Fin starts agent-browser. Platform, PATH, and file access are
 * injected, so the Windows branch runs on any runner.
 */
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearWindowsSpawnCache,
  type WindowsSpawnContext,
} from "../../../lib/common/windows-spawn.ts";
import { agentBrowserCommand } from "../lib/agent-browser-command.ts";

const W = path.win32;
const PREFIX = W.join("C:\\", "Users", "dev", "AppData", "Roaming", "npm");
const EXE = W.join(PREFIX, "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
const NATIVE_SHIM = String.raw`@ECHO off
"%~dp0node_modules\agent-browser\bin\agent-browser-win32-x64.exe" %*`;

function win(files: Record<string, string>): WindowsSpawnContext {
  const find = (f: string) => Object.keys(files).find((k) => k.toLowerCase() === f.toLowerCase());
  return {
    platform: "win32",
    env: { PATH: PREFIX },
    exists: (f) => find(f) !== undefined,
    readText: (f) => {
      const k = find(f);
      if (k === undefined) throw new Error("ENOENT");
      return files[k]!;
    },
    nodePath: W.join("C:\\", "apps", "nodejs", "node.exe"),
  };
}

const ARGS = ["--session", "sf-pi", "--session-name", "sf-pi", "get", "url"];
const HOSTILE = "https://example.invalid/sign_in;rm -rf ~";

beforeEach(() => clearWindowsSpawnCache());

describe("agentBrowserCommand on Windows", () => {
  it("runs the native exe the npm wrapper points at, without sh, even for owner-only launches", () => {
    const ctx = win({ [W.join(PREFIX, "agent-browser.cmd")]: NATIVE_SHIM, [EXE]: "" });
    expect(agentBrowserCommand(ARGS, {}, ctx)).toEqual([EXE, ARGS]);
    expect(agentBrowserCommand(["open", HOSTILE], { ownerOnlyFiles: true }, ctx)).toEqual([
      EXE,
      ["open", HOSTILE],
    ]);
  });

  it("falls back to the bare name when no wrapper target exists", () => {
    expect(agentBrowserCommand(ARGS, {}, win({}))).toEqual(["agent-browser", ARGS]);
  });
});

describe("agentBrowserCommand on POSIX (unchanged)", () => {
  const posix: WindowsSpawnContext = { ...win({}), platform: "linux", env: { PATH: "/usr/bin" } };

  it("runs agent-browser by name", () => {
    expect(agentBrowserCommand(ARGS, {}, posix)).toEqual(["agent-browser", ARGS]);
  });

  it("keeps umask 077 for owner-only launches, with arguments outside the shell string", () => {
    const [command, args] = agentBrowserCommand(["open", HOSTILE], { ownerOnlyFiles: true }, posix);
    expect(command).toBe("sh");
    expect(args.slice(0, 3)).toEqual(["-c", 'umask 077; exec agent-browser "$@"', "sh"]);
    expect(args[1]).not.toContain(HOSTILE);
    expect(args).toContain(HOSTILE);
  });
});
