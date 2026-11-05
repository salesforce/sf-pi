/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAgentBrowserInvocation } from "../lib/agent-browser.ts";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
let appData: string;
let originalAppData: string | undefined;
let packageBin: string;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform });
}

function touch(filePath: string): void {
  writeFileSync(filePath, "");
}

beforeEach(() => {
  appData = mkdtempSync(path.join(tmpdir(), "sf-browser-appdata-"));
  originalAppData = process.env.APPDATA;
  process.env.APPDATA = appData;
  packageBin = path.join(appData, "npm", "node_modules", "agent-browser", "bin");
  mkdirSync(packageBin, { recursive: true });
});

afterEach(() => {
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  if (originalAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = originalAppData;
  rmSync(appData, { recursive: true, force: true });
});

describe("resolveAgentBrowserInvocation", () => {
  it("leaves agent-browser unchanged on non-Windows platforms", () => {
    setPlatform("linux");
    expect(resolveAgentBrowserInvocation("agent-browser", ["doctor"])).toEqual([
      "agent-browser",
      ["doctor"],
    ]);
  });

  it("runs the native exe directly on Windows, keeping & in URLs as one argument", () => {
    setPlatform("win32");
    const exe = path.join(packageBin, "agent-browser-win32-x64.exe");
    touch(exe);
    const url = "https://example.invalid/frontdoor.jsp?sid=x&retURL=%2Fsetup";
    expect(resolveAgentBrowserInvocation("agent-browser", ["open", url])).toEqual([
      exe,
      ["open", url],
    ]);
  });

  it("runs the package's Node entry point when the exe is missing (no cmd.exe)", () => {
    setPlatform("win32");
    const entry = path.join(packageBin, "agent-browser.js");
    touch(entry);
    expect(resolveAgentBrowserInvocation("agent-browser", ["doctor"])).toEqual([
      process.execPath,
      [entry, "doctor"],
    ]);
  });

  it("returns the plain command when nothing is installed, instead of guessing a shell", () => {
    setPlatform("win32");
    expect(resolveAgentBrowserInvocation("agent-browser", ["doctor"])).toEqual([
      "agent-browser",
      ["doctor"],
    ]);
  });

  it("leaves other commands unchanged on Windows", () => {
    setPlatform("win32");
    expect(resolveAgentBrowserInvocation("sf", ["--version"])).toEqual(["sf", ["--version"]]);
  });
});
