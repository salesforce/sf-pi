/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectHunkStatus,
  parseHunkVersion,
  readCachedHunkStatus,
  writeCachedHunkStatus,
  type HunkExecFn,
} from "../lib/hunk-status.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let prevAgent: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-hunk-status-"));
  mkdirSync(tmpDir, { recursive: true });
  prevAgent = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (prevAgent === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgent;
  rmSync(tmpDir, { recursive: true, force: true });
});

function createExec(responses: Record<string, { stdout?: string; code?: number }>): HunkExecFn {
  return async (command, args) => {
    const key = [command, ...args].join(" ");
    const response = responses[key];
    if (!response) throw new Error(`missing: ${key}`);
    return { stdout: response.stdout ?? "", stderr: "", code: response.code ?? 0 };
  };
}

describe("Hunk readiness", () => {
  it("parses semver output", () => {
    expect(parseHunkVersion("hunk 0.12.0-beta.1")).toBe("0.12.0-beta.1");
  });

  it("detects the hunk binary first", async () => {
    const status = await detectHunkStatus(
      createExec({ "hunk --version": { stdout: "hunk 0.12.0\n" } }),
    );
    expect(status).toMatchObject({ installed: true, command: "hunk", installedVersion: "0.12.0" });
  });

  it("falls back to hunkdiff", async () => {
    const status = await detectHunkStatus(
      createExec({
        "hunkdiff --version": { stdout: "hunkdiff 0.11.0\n" },
      }),
    );
    expect(status).toMatchObject({ installed: true, command: "hunkdiff" });
  });

  it("reports missing when neither binary works", async () => {
    const status = await detectHunkStatus(async () => {
      throw new Error("not found");
    });
    expect(status.installed).toBe(false);
    expect(status.loading).toBe(false);
  });

  it("round-trips cached status", () => {
    writeCachedHunkStatus({
      installed: true,
      command: "hunk",
      installedVersion: "0.12.0",
      loading: false,
    });
    expect(readCachedHunkStatus()).toMatchObject({
      installed: true,
      command: "hunk",
      installedVersion: "0.12.0",
      loading: false,
    });
  });
});
