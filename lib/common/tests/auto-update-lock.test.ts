/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { autoUpdateLockPath, tryAcquireAutoUpdateLock } from "../auto-update/lock.ts";
import { AUTO_UPDATE_STALE_RUNNING_MS } from "../auto-update/store.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
let tmpDir: string;
let previousAgentDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-update-lock-"));
  mkdirSync(tmpDir, { recursive: true });
  previousAgentDir = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (previousAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = previousAgentDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Auto Update machine lock", () => {
  it("allows only one updater and releases ownership explicitly", () => {
    const first = tryAcquireAutoUpdateLock();
    expect(first).toBeDefined();
    expect(tryAcquireAutoUpdateLock()).toBeUndefined();

    first?.release();

    const next = tryAcquireAutoUpdateLock();
    expect(next).toBeDefined();
    next?.release();
  });

  it("recovers a stale lock without letting the old owner delete the replacement", () => {
    const first = tryAcquireAutoUpdateLock();
    expect(first).toBeDefined();
    const now = Date.now();
    const staleAt = new Date(now - AUTO_UPDATE_STALE_RUNNING_MS - 1_000);
    utimesSync(autoUpdateLockPath(), staleAt, staleAt);

    const replacement = tryAcquireAutoUpdateLock(now);
    expect(replacement).toBeDefined();

    first?.release();
    expect(tryAcquireAutoUpdateLock(now)).toBeUndefined();

    replacement?.release();
    expect(tryAcquireAutoUpdateLock(now)).toBeDefined();
  });
});
