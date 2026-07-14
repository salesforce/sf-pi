/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectHomebrewStatus,
  parseHomebrewVersion,
  readCachedHomebrewStatus,
  writeCachedHomebrewStatus,
  type HomebrewExecFn,
} from "../lib/homebrew-status.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let prevAgent: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-homebrew-status-"));
  mkdirSync(tmpDir, { recursive: true });
  prevAgent = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (prevAgent === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgent;
  rmSync(tmpDir, { recursive: true, force: true });
});

function createExec(responses: Record<string, { stdout?: string; code?: number }>): HomebrewExecFn {
  return async (command, args) => {
    const key = [command, ...args].join(" ");
    const response = responses[key];
    if (!response) throw new Error(`missing: ${key}`);
    return { stdout: response.stdout ?? "", stderr: "", code: response.code ?? 0 };
  };
}

describe("Homebrew readiness", () => {
  it("parses brew version output", () => {
    expect(parseHomebrewVersion("Homebrew 4.6.3\nHomebrew/homebrew-core")).toBe("4.6.3");
  });

  it("detects installed brew and prefix", async () => {
    const status = await detectHomebrewStatus(
      createExec({
        "brew --version": { stdout: "Homebrew 4.6.3\n" },
        "brew --prefix": { stdout: "/opt/homebrew\n" },
      }),
      "darwin",
    );

    expect(status).toMatchObject({
      kind: "installed",
      version: "4.6.3",
      prefix: "/opt/homebrew",
      platform: "darwin",
      loading: false,
    });
  });

  it("reports missing when brew is unavailable", async () => {
    const status = await detectHomebrewStatus(async () => {
      throw new Error("not found");
    }, "darwin");

    expect(status).toMatchObject({ kind: "missing", platform: "darwin", loading: false });
  });

  it("round-trips cached status", () => {
    writeCachedHomebrewStatus({
      kind: "installed",
      version: "4.6.3",
      prefix: "/opt/homebrew",
      platform: "darwin",
      loading: false,
    });
    expect(readCachedHomebrewStatus()).toMatchObject({
      kind: "installed",
      version: "4.6.3",
      prefix: "/opt/homebrew",
      loading: false,
    });
  });
});
