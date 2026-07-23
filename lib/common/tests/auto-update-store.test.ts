/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAutoUpdatePending,
  markAutoUpdatePending,
  markAutoUpdateResult,
  markAutoUpdateRunning,
  readAutoUpdateEnabled,
  readAutoUpdateStatus,
  shouldRunAutoUpdate,
  writeAutoUpdateEnabled,
  writeAutoUpdateStatus,
  autoUpdateStatusPath,
  shouldClearRestartRecommended,
} from "../auto-update/store.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let prevAgent: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-auto-update-"));
  mkdirSync(tmpDir, { recursive: true });
  prevAgent = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (prevAgent === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgent;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Native Auto Update store", () => {
  it("resolves status storage after test env setup", () => {
    expect(autoUpdateStatusPath()).toContain(tmpDir);
  });

  it("defaults to disabled", () => {
    expect(readAutoUpdateEnabled()).toBe(false);
  });

  it("writes and reads the global enable flag", () => {
    writeAutoUpdateEnabled(true);
    expect(readAutoUpdateEnabled()).toBe(true);
    writeAutoUpdateEnabled(false);
    expect(readAutoUpdateEnabled()).toBe(false);
  });

  it("tracks pending, running, and bounded per-target result state", () => {
    markAutoUpdatePending();
    expect(readAutoUpdateStatus()).toMatchObject({ pending: true });

    markAutoUpdateRunning("pi-packages");
    expect(readAutoUpdateStatus()).toMatchObject({
      pending: false,
      running: true,
      currentTarget: "pi-packages",
    });

    markAutoUpdateResult({
      result: "success",
      message: "done",
      restartRecommended: true,
      targets: [
        { target: "pi-runtime", result: "skipped", message: "audited runtime retained" },
        { target: "pi-packages", result: "success", message: "packages updated" },
      ],
    });
    expect(readAutoUpdateStatus()).toMatchObject({
      pending: false,
      running: false,
      lastResult: "success",
      message: "done",
      restartRecommended: true,
      targets: [
        { target: "pi-runtime", result: "skipped" },
        { target: "pi-packages", result: "success" },
      ],
    });
  });

  it("redacts sensitive command-shaped text before status persistence", () => {
    writeAutoUpdateStatus({
      lastResult: "failed",
      message: `api_key=secret-value ${os.homedir()}/private https://private.example.test/path`,
      targets: [
        {
          target: "pi-packages",
          result: "failed",
          message: `Bearer ${"x".repeat(24)} ${os.homedir()}`,
        },
      ],
    });

    const persisted = JSON.stringify(readAutoUpdateStatus());
    expect(persisted).toContain("<redacted>");
    expect(persisted).toContain("<home>");
    expect(persisted).toContain("<url-redacted>");
    expect(persisted).not.toContain("secret-value");
    expect(persisted).not.toContain(os.homedir());
    expect(persisted).not.toContain("private.example.test");
  });

  it("clears pending work without recording a completed run", () => {
    markAutoUpdatePending();
    clearAutoUpdatePending("Auto Update disabled before execution.");

    expect(readAutoUpdateStatus()).toMatchObject({
      pending: false,
      running: false,
      message: "Auto Update disabled before execution.",
    });
    expect(readAutoUpdateStatus().lastRunAt).toBeUndefined();
  });

  it("clears restart recommendation after a later process restart", () => {
    expect(
      shouldClearRestartRecommended(
        { lastRunAt: "2026-07-14T00:00:00Z", restartRecommended: true },
        Date.parse("2026-07-14T00:01:00Z"),
      ),
    ).toBe(true);
    expect(
      shouldClearRestartRecommended(
        { lastRunAt: "2026-07-14T00:02:00Z", restartRecommended: true },
        Date.parse("2026-07-14T00:01:00Z"),
      ),
    ).toBe(false);
  });

  it("runs only when enabled and cadence elapsed", () => {
    const now = Date.parse("2026-07-14T00:00:00Z");
    writeAutoUpdateEnabled(true);
    writeAutoUpdateStatus({ lastRunAt: "2026-07-13T00:00:00Z" });
    expect(shouldRunAutoUpdate(now)).toBe(true);

    writeAutoUpdateStatus({ lastRunAt: "2026-07-13T23:00:00Z" });
    expect(shouldRunAutoUpdate(now)).toBe(false);
  });
});
