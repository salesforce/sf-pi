/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the pi install/remove subprocess wrapper.
 *
 * We don't actually launch `pi`; we inject a fake spawn that emits canned
 * events. The goal is to pin down:
 *   - correct CLI args per scope
 *   - success/failure mapped to InstallRunResult.success
 *   - spawn errors surfaced instead of thrown
 */
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { installPackage, removePackage, type SpawnFn } from "../lib/recommendations-install.ts";

// -------------------------------------------------------------------------------------------------
// Fake child process
// -------------------------------------------------------------------------------------------------

interface FakeBehavior {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  signal?: NodeJS.Signals | null;
  throwOnSpawn?: Error;
  emitErrorBeforeClose?: Error;
}

function fakeSpawn(
  behavior: FakeBehavior,
  capture: { command?: string; args?: readonly string[] } = {},
): SpawnFn {
  return (command, args) => {
    capture.command = command;
    capture.args = args;
    if (behavior.throwOnSpawn) throw behavior.throwOnSpawn;

    const emitter = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    emitter.stdout = new EventEmitter();
    emitter.stderr = new EventEmitter();

    // Use queueMicrotask so listeners registered synchronously in the
    // wrapper actually hear our events.
    queueMicrotask(() => {
      if (behavior.stdout) emitter.stdout.emit("data", Buffer.from(behavior.stdout));
      if (behavior.stderr) emitter.stderr.emit("data", Buffer.from(behavior.stderr));
      if (behavior.emitErrorBeforeClose) {
        emitter.emit("error", behavior.emitErrorBeforeClose);
        return;
      }
      emitter.emit("close", behavior.exitCode ?? 0, behavior.signal ?? null);
    });

    return emitter as unknown as ReturnType<SpawnFn>;
  };
}

// -------------------------------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------------------------------

describe("installPackage", () => {
  it("runs `pi install <source>` for global scope", async () => {
    const capture: { command?: string; args?: readonly string[] } = {};
    const result = await installPackage("git:example.com/x", "global", {
      cwd: "/tmp",
      spawn: fakeSpawn({ exitCode: 0, stdout: "ok" }, capture),
    });
    expect(capture.args).toEqual(["install", "git:example.com/x"]);
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("ok");
    expect(result.command).toBe("pi install git:example.com/x");
  });

  it("adds -l for project scope", async () => {
    const capture: { command?: string; args?: readonly string[] } = {};
    await installPackage("git:example.com/x", "project", {
      cwd: "/tmp",
      spawn: fakeSpawn({ exitCode: 0 }, capture),
    });
    expect(capture.args).toEqual(["install", "-l", "git:example.com/x"]);
  });

  it("reports failure when exit code is non-zero", async () => {
    const result = await installPackage("git:example.com/x", "global", {
      cwd: "/tmp",
      spawn: fakeSpawn({ exitCode: 1, stderr: "boom" }),
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("boom");
  });

  it("surfaces spawn throw as a non-successful result", async () => {
    const result = await installPackage("git:example.com/x", "global", {
      cwd: "/tmp",
      spawn: fakeSpawn({ throwOnSpawn: new Error("ENOENT: pi") }),
    });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("ENOENT");
  });

  it("surfaces runtime emit('error') as a non-successful result", async () => {
    const result = await installPackage("git:example.com/x", "global", {
      cwd: "/tmp",
      spawn: fakeSpawn({ emitErrorBeforeClose: new Error("pipe broke") }),
    });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("pipe broke");
  });

  it("respects a custom pi binary", async () => {
    const capture: { command?: string } = {};
    await installPackage("git:example.com/x", "global", {
      cwd: "/tmp",
      piBin: "/usr/local/bin/pi-next",
      spawn: fakeSpawn({ exitCode: 0 }, capture),
    });
    expect(capture.command).toBe("/usr/local/bin/pi-next");
  });
});

describe("removePackage", () => {
  it("runs `pi remove <source>` for global scope", async () => {
    const capture: { args?: readonly string[] } = {};
    await removePackage("git:example.com/x", "global", {
      cwd: "/tmp",
      spawn: fakeSpawn({ exitCode: 0 }, capture),
    });
    expect(capture.args).toEqual(["remove", "git:example.com/x"]);
  });

  it("adds -l for project scope", async () => {
    const capture: { args?: readonly string[] } = {};
    await removePackage("git:example.com/x", "project", {
      cwd: "/tmp",
      spawn: fakeSpawn({ exitCode: 0 }, capture),
    });
    expect(capture.args).toEqual(["remove", "-l", "git:example.com/x"]);
  });
});
