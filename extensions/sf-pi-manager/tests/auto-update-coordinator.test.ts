/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  readAutoUpdateStatus,
  writeAutoUpdateEnabled,
} from "../../../lib/common/auto-update/store.ts";
import { createAgentSettledUpdateCoordinator } from "../lib/auto-update-coordinator.ts";
import { AUTO_UPDATE_ENTRY_TYPE } from "../lib/auto-update-transcript.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let previousAgentDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-update-coordinator-"));
  mkdirSync(tmpDir, { recursive: true });
  previousAgentDir = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (previousAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = previousAgentDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

const compatiblePackagePlan = async () => ({
  sources: ["npm:@ogulcancelik/pi-herdr"],
  configuredCount: 1,
  eligibleCount: 1,
  currentCount: 0,
  skippedCount: 0,
});

function makeCoordinator(pi: ExtensionAPI) {
  return createAgentSettledUpdateCoordinator(pi, {
    planPackages: compatiblePackagePlan,
  });
}

function context(idle: boolean = true): ExtensionContext {
  return {
    cwd: tmpDir,
    hasUI: true,
    isIdle: () => idle,
    ui: { setStatus: vi.fn(), notify: vi.fn() },
  } as unknown as ExtensionContext;
}

describe("Agent-Settled Update Coordinator", () => {
  it("does not schedule automatic mutations in headless sessions", async () => {
    writeAutoUpdateEnabled(true);
    const pi = { exec: vi.fn(), appendEntry: vi.fn() } as unknown as ExtensionAPI;
    const updateCoordinator = makeCoordinator(pi);
    const ctx = { ...context(), hasUI: false } as ExtensionContext;

    updateCoordinator.onSessionStart("startup", ctx);
    await updateCoordinator.onAgentSettled(ctx);

    expect(pi.exec).not.toHaveBeenCalled();
    expect(readAutoUpdateStatus().pending).not.toBe(true);
  });

  it("records due work at startup and waits for agent_settled before mutating", async () => {
    writeAutoUpdateEnabled(true);
    const calls: string[] = [];
    const pi = {
      exec: vi.fn(async (command: string, args: string[]) => {
        calls.push([command, ...args].join(" "));
        return { stdout: "ok", stderr: "", code: 0, killed: false };
      }),
      appendEntry: vi.fn(),
    } as unknown as ExtensionAPI;
    const coordinator = makeCoordinator(pi);
    const ctx = context();

    coordinator.onSessionStart("startup", ctx);

    expect(calls).toEqual([]);
    expect(readAutoUpdateStatus()).toMatchObject({ pending: true, running: false });

    await coordinator.onAgentSettled(ctx);

    expect(calls).toEqual([
      "pi update --extension npm:@ogulcancelik/pi-herdr --no-approve",
      "sf update stable",
    ]);
    expect(pi.appendEntry).toHaveBeenCalledWith(
      AUTO_UPDATE_ENTRY_TYPE,
      expect.objectContaining({
        title: "Auto Update planned",
        body: expect.stringContaining("1 compatible package update"),
      }),
    );
    expect(pi.appendEntry).toHaveBeenCalledWith(
      AUTO_UPDATE_ENTRY_TYPE,
      expect.objectContaining({
        title: "Auto Update complete",
        body: expect.stringMatching(
          /pi-runtime: skipped[\s\S]*pi-packages: success[\s\S]*sf-cli: success[\s\S]*Restart recommended: yes/,
        ),
      }),
    );
  });

  it("prevents overlapping runs across coordinator instances", async () => {
    writeAutoUpdateEnabled(true);
    let finishFirst: (() => void) | undefined;
    const firstPi = {
      exec: vi.fn(
        () =>
          new Promise((resolve) => {
            finishFirst = () => resolve({ stdout: "ok", stderr: "", code: 0, killed: false });
          }),
      ),
      appendEntry: vi.fn(),
    } as unknown as ExtensionAPI;
    const secondPi = {
      exec: vi.fn(),
      appendEntry: vi.fn(),
    } as unknown as ExtensionAPI;
    const first = makeCoordinator(firstPi);
    const second = makeCoordinator(secondPi);
    const ctx = context();

    first.onSessionStart("startup", ctx);
    second.onSessionStart("startup", ctx);
    const firstRun = first.onAgentSettled(ctx);
    await vi.waitFor(() => expect(firstPi.exec).toHaveBeenCalledOnce());

    await second.onAgentSettled(ctx);
    expect(secondPi.exec).not.toHaveBeenCalled();

    finishFirst?.();
    await vi.waitFor(() => expect(firstPi.exec).toHaveBeenCalledTimes(2));
    finishFirst?.();
    await firstRun;
  });

  it("rechecks opt-in before later targets and stops when consent is revoked", async () => {
    writeAutoUpdateEnabled(true);
    const calls: string[] = [];
    const pi = {
      exec: vi.fn(async (command: string, args: string[]) => {
        calls.push([command, ...args].join(" "));
        if (command === "pi") writeAutoUpdateEnabled(false);
        return { stdout: "ok", stderr: "", code: 0, killed: false };
      }),
      appendEntry: vi.fn(),
    } as unknown as ExtensionAPI;
    const coordinator = makeCoordinator(pi);
    const ctx = context();

    coordinator.onSessionStart("startup", ctx);
    await coordinator.onAgentSettled(ctx);

    expect(calls).toEqual(["pi update --extension npm:@ogulcancelik/pi-herdr --no-approve"]);
    expect(readAutoUpdateStatus()).toMatchObject({
      pending: false,
      lastResult: "skipped",
      targets: expect.arrayContaining([
        expect.objectContaining({ target: "sf-cli", result: "skipped" }),
      ]),
    });
  });

  it("aborts a running target when a new agent turn starts and defers the remainder", async () => {
    writeAutoUpdateEnabled(true);
    const calls: string[] = [];
    const pi = {
      exec: vi.fn((command: string, args: string[], options?: { signal?: AbortSignal }) => {
        calls.push([command, ...args].join(" "));
        return new Promise((resolve) => {
          options?.signal?.addEventListener(
            "abort",
            () => resolve({ stdout: "", stderr: "", code: 1, killed: true }),
            { once: true },
          );
        });
      }),
      appendEntry: vi.fn(),
    } as unknown as ExtensionAPI;
    const coordinator = makeCoordinator(pi);
    const ctx = context();

    coordinator.onSessionStart("startup", ctx);
    const running = coordinator.onAgentSettled(ctx);
    await vi.waitFor(() =>
      expect(calls).toEqual(["pi update --extension npm:@ogulcancelik/pi-herdr --no-approve"]),
    );

    coordinator.onAgentStart();
    await running;

    expect(calls).toEqual(["pi update --extension npm:@ogulcancelik/pi-herdr --no-approve"]);
    expect(readAutoUpdateStatus()).toMatchObject({ pending: true, running: false });
  });

  it("aborts running work on session shutdown without leaving it pending", async () => {
    writeAutoUpdateEnabled(true);
    const pi = {
      exec: vi.fn(
        (_command: string, _args: string[], options?: { signal?: AbortSignal }) =>
          new Promise((resolve) => {
            options?.signal?.addEventListener(
              "abort",
              () => resolve({ stdout: "", stderr: "", code: 1, killed: true }),
              { once: true },
            );
          }),
      ),
      appendEntry: vi.fn(),
    } as unknown as ExtensionAPI;
    const coordinator = makeCoordinator(pi);
    const ctx = context();

    coordinator.onSessionStart("startup", ctx);
    const running = coordinator.onAgentSettled(ctx);
    await vi.waitFor(() => expect(pi.exec).toHaveBeenCalledOnce());

    coordinator.onSessionShutdown();
    await running;

    expect(pi.exec).toHaveBeenCalledOnce();
    expect(readAutoUpdateStatus()).toMatchObject({ pending: false, running: false });
    expect(
      (pi.appendEntry as ReturnType<typeof vi.fn>).mock.calls.map(([, data]) => data.title),
    ).toEqual(["Auto Update planned"]);
  });

  it("cancels pending work when the user revokes opt-in before settlement", async () => {
    writeAutoUpdateEnabled(true);
    const pi = {
      exec: vi.fn(),
      appendEntry: vi.fn(),
    } as unknown as ExtensionAPI;
    const coordinator = makeCoordinator(pi);
    const ctx = context();

    coordinator.onSessionStart("startup", ctx);
    writeAutoUpdateEnabled(false);
    await coordinator.onAgentSettled(ctx);

    expect(pi.exec).not.toHaveBeenCalled();
    expect(readAutoUpdateStatus()).toMatchObject({
      pending: false,
      running: false,
      message: "Auto Update disabled before execution.",
    });
  });
});
