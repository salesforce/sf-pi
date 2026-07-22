/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runNativeAutoUpdate, parseAutoUpdateArgs } from "../lib/auto-update-command.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let prevAgent: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-auto-update-command-"));
  mkdirSync(tmpDir, { recursive: true });
  prevAgent = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (prevAgent === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgent;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Native Auto Update command", () => {
  it("parses actions", () => {
    expect(parseAutoUpdateArgs("run")).toEqual({ action: "run" });
    expect(parseAutoUpdateArgs("on")).toEqual({ action: "on" });
    expect(parseAutoUpdateArgs("")).toEqual({ action: "status" });
  });

  it("skips Pi updates that could cross the temporary support ceiling", async () => {
    const calls: string[] = [];
    const pi = {
      exec: async (command: string, args: string[]) => {
        calls.push([command, ...args].join(" "));
        return { stdout: "ok", stderr: "", code: 0, killed: false };
      },
    } as unknown as ExtensionAPI;
    const ctx = {
      cwd: tmpDir,
      hasUI: true,
      ui: { setStatus: vi.fn() },
    } as unknown as Pick<ExtensionContext, "cwd" | "ui" | "hasUI">;

    const status = await runNativeAutoUpdate(pi, ctx);

    expect(calls).toEqual(["sf update stable"]);
    expect(status).toMatchObject({ lastResult: "success", restartRecommended: false });
    expect(status.message).toContain("Pi 0.81.1");
    expect(status.message).toContain("skipped");
  });

  it("reports Salesforce CLI update failures while Pi remains untouched", async () => {
    const calls: string[] = [];
    const pi = {
      exec: async (command: string, args: string[]) => {
        calls.push([command, ...args].join(" "));
        return { stdout: "", stderr: "boom", code: 1, killed: false };
      },
    } as unknown as ExtensionAPI;
    const ctx = {
      cwd: tmpDir,
      hasUI: false,
      ui: { setStatus: vi.fn() },
    } as unknown as Pick<ExtensionContext, "cwd" | "ui" | "hasUI">;

    const status = await runNativeAutoUpdate(pi, ctx);

    expect(calls).toEqual(["sf update stable"]);
    expect(status.lastResult).toBe("failed");
    expect(status.message).toContain("sf update stable failed");
  });
});
