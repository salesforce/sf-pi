/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAgentBrowserInvocation } from "../lib/agent-browser.ts";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
let appData: string;
let originalAppData: string | undefined;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform });
}

beforeEach(() => {
  appData = mkdtempSync(path.join(tmpdir(), "sf-browser-appdata-"));
  originalAppData = process.env.APPDATA;
  process.env.APPDATA = appData;
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

  it("falls back to cmd.exe on Windows when the native exe is missing", () => {
    setPlatform("win32");
    expect(resolveAgentBrowserInvocation("agent-browser", ["doctor"])).toEqual([
      "cmd.exe",
      ["/d", "/c", "agent-browser", "doctor"],
    ]);
  });

  it("runs the native exe directly on Windows when it exists, keeping & in URLs intact", () => {
    setPlatform("win32");
    const binDir = path.join(appData, "npm", "node_modules", "agent-browser", "bin");
    mkdirSync(binDir, { recursive: true });
    const exe = path.join(binDir, "agent-browser-win32-x64.exe");
    writeFileSync(exe, "");
    const url = "https://example.invalid/frontdoor.jsp?sid=x&retURL=%2Fsetup";
    expect(resolveAgentBrowserInvocation("agent-browser", ["open", url])).toEqual([
      exe,
      ["open", url],
    ]);
  });

  it("leaves other commands unchanged on Windows", () => {
    setPlatform("win32");
    expect(resolveAgentBrowserInvocation("sf", ["--version"])).toEqual(["sf", ["--version"]]);
  });
});
