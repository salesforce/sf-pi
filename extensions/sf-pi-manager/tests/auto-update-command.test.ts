/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  handleAutoUpdate,
  runNativeAutoUpdate,
  parseAutoUpdateArgs,
} from "../lib/auto-update-command.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let prevAgent: string | undefined;

const compatiblePackagePlan = async () => ({
  sources: ["npm:@ogulcancelik/pi-herdr"],
  configuredCount: 1,
  eligibleCount: 1,
  currentCount: 0,
  skippedCount: 0,
});

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

  it("delegates an explicit run through the shared coordinator", async () => {
    const status = {
      lastResult: "success" as const,
      message: "done",
      restartRecommended: true,
    };
    const runner = { runManual: vi.fn(async () => status) };
    const notify = vi.fn();
    const ctx = {
      cwd: tmpDir,
      hasUI: true,
      isIdle: () => true,
      ui: { setStatus: vi.fn(), notify },
    } as unknown as ExtensionContext;

    await handleAutoUpdate({} as ExtensionAPI, ctx as never, { action: "run" }, runner);

    expect(runner.runManual).toHaveBeenCalledWith(ctx);
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("done"), "info");
  });

  it("updates Pi packages without invoking an unbounded Pi self-update", async () => {
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

    const status = await runNativeAutoUpdate(pi, ctx, {
      planPackages: compatiblePackagePlan,
    });

    expect(calls).toEqual([
      "pi update --extension npm:@ogulcancelik/pi-herdr --no-approve",
      "sf update stable",
    ]);
    expect(calls.join("\n")).not.toContain("--all");
    expect(calls.join("\n")).not.toContain("--self");
    expect(status).toMatchObject({ lastResult: "success", restartRecommended: true });
    expect(status.message).toContain("audited 0.81 line");
  });

  it("keeps package updates working when pi-updater suppresses the self-version check", async () => {
    const calls: string[] = [];
    const pi = {
      exec: async (command: string, args: string[]) => {
        calls.push([command, ...args].join(" "));
        return { stdout: "ok", stderr: "", code: 0, killed: false };
      },
    } as unknown as ExtensionAPI;
    const ctx = {
      cwd: tmpDir,
      hasUI: false,
      ui: { setStatus: vi.fn() },
    } as unknown as Pick<ExtensionContext, "cwd" | "ui" | "hasUI">;

    const status = await runNativeAutoUpdate(pi, ctx, {
      env: {
        PI_SKIP_VERSION_CHECK: "1",
        PI_UPDATER_SUPPRESSED_NATIVE_VERSION_CHECK: "1",
      },
      planPackages: compatiblePackagePlan,
    });

    expect(calls).toEqual([
      "pi update --extension npm:@ogulcancelik/pi-herdr --no-approve",
      "sf update stable",
    ]);
    expect(status.lastResult).toBe("success");
  });

  it("respects PI_OFFLINE without starting network update commands", async () => {
    const pi = { exec: vi.fn() } as unknown as ExtensionAPI;
    const ctx = {
      cwd: tmpDir,
      hasUI: false,
      ui: { setStatus: vi.fn() },
    } as unknown as Pick<ExtensionContext, "cwd" | "ui" | "hasUI">;

    const status = await runNativeAutoUpdate(pi, ctx, { env: { PI_OFFLINE: "1" } });

    expect(pi.exec).not.toHaveBeenCalled();
    expect(status).toMatchObject({ lastResult: "skipped", restartRecommended: false });
    expect(status.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "pi-packages", result: "skipped" }),
        expect.objectContaining({ target: "sf-cli", result: "skipped" }),
      ]),
    );
  });

  it("skips unverifiable package updates and still updates Salesforce CLI", async () => {
    const calls: string[] = [];
    const pi = {
      exec: vi.fn(async (command: string, args: string[]) => {
        calls.push([command, ...args].join(" "));
        return { stdout: "ok", stderr: "", code: 0, killed: false };
      }),
    } as unknown as ExtensionAPI;
    const ctx = {
      cwd: tmpDir,
      hasUI: false,
      ui: { setStatus: vi.fn() },
    } as unknown as Pick<ExtensionContext, "cwd" | "ui" | "hasUI">;

    const status = await runNativeAutoUpdate(pi, ctx, {
      planPackages: async () => {
        throw new Error("private metadata failure");
      },
    });

    expect(calls).toEqual(["sf update stable"]);
    expect(status.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "pi-packages", result: "skipped" }),
        expect.objectContaining({ target: "sf-cli", result: "success" }),
      ]),
    );
    expect(JSON.stringify(status)).not.toContain("private metadata failure");
  });

  it("recommends restart when one compatible package updates before another fails", async () => {
    let packageCall = 0;
    const pi = {
      exec: vi.fn(async (command: string) => {
        if (command === "pi") {
          packageCall += 1;
          return {
            stdout: "",
            stderr: "",
            code: packageCall === 1 ? 0 : 1,
            killed: false,
          };
        }
        return { stdout: "ok", stderr: "", code: 0, killed: false };
      }),
    } as unknown as ExtensionAPI;
    const ctx = {
      cwd: tmpDir,
      hasUI: false,
      ui: { setStatus: vi.fn() },
    } as unknown as Pick<ExtensionContext, "cwd" | "ui" | "hasUI">;

    const status = await runNativeAutoUpdate(pi, ctx, {
      planPackages: async () => ({
        sources: ["npm:package-one", "npm:package-two"],
        configuredCount: 2,
        eligibleCount: 2,
        currentCount: 0,
        skippedCount: 0,
      }),
    });

    expect(status).toMatchObject({ lastResult: "failed", restartRecommended: true });
  });

  it("continues to Salesforce CLI when a package update fails and persists no raw output", async () => {
    const calls: string[] = [];
    const pi = {
      exec: async (command: string, args: string[]) => {
        calls.push([command, ...args].join(" "));
        return command === "pi"
          ? {
              stdout: "",
              stderr: "api_key=secret-value https://private.example.test /Users/private/home",
              code: 1,
              killed: false,
            }
          : { stdout: "ok", stderr: "", code: 0, killed: false };
      },
    } as unknown as ExtensionAPI;
    const ctx = {
      cwd: tmpDir,
      hasUI: false,
      ui: { setStatus: vi.fn() },
    } as unknown as Pick<ExtensionContext, "cwd" | "ui" | "hasUI">;

    const status = await runNativeAutoUpdate(pi, ctx, {
      planPackages: compatiblePackagePlan,
    });

    expect(calls).toEqual([
      "pi update --extension npm:@ogulcancelik/pi-herdr --no-approve",
      "sf update stable",
    ]);
    expect(status.lastResult).toBe("failed");
    expect(status.targets).toContainEqual(
      expect.objectContaining({
        target: "pi-packages",
        result: "failed",
        message: expect.stringContaining("1 failed"),
      }),
    );
    expect(JSON.stringify(status)).not.toContain("secret-value");
    expect(JSON.stringify(status)).not.toContain("private.example.test");
    expect(JSON.stringify(status)).not.toContain("/Users/private/home");
  });
});
