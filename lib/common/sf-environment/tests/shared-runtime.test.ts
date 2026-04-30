/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the shared Salesforce environment runtime cache.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  clearSharedSfEnvironment,
  getCachedSfEnvironment,
  getSharedSfEnvironment,
  peekSharedSfEnvironment,
  type SharedExecFn,
} from "../shared-runtime.ts";
import { clearPersistedSfEnvironment } from "../persisted-cache.ts";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-org-shared-"));
  tempDirs.push(dir);
  return dir;
}

function mockExec(
  overrides: Record<string, { stdout: string; stderr?: string; code?: number | null }>,
  calls: string[] = [],
  delayMs: number = 0,
): SharedExecFn {
  return async (command, args) => {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const key = `${command} ${args.join(" ")}`;
    calls.push(key);
    const match = Object.entries(overrides).find(([candidate]) => key.startsWith(candidate));
    if (match) {
      return {
        stdout: match[1].stdout,
        stderr: match[1].stderr ?? "",
        code: match[1].code ?? 0,
      };
    }

    return { stdout: "", stderr: "command not found", code: 127 };
  };
}

afterEach(() => {
  clearSharedSfEnvironment();
  clearPersistedSfEnvironment();

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("getSharedSfEnvironment", () => {
  it("shares one in-flight detection across concurrent callers", async () => {
    process.env.HOME = createTempDir();
    const cwd = createTempDir();
    const calls: string[] = [];
    const exec = mockExec(
      {
        "sf --version": { stdout: "@salesforce/cli/2.130.9\n" },
        "sf config list --json": { stdout: JSON.stringify({ result: [] }) },
      },
      calls,
      5,
    );

    const [first, second] = await Promise.all([
      getSharedSfEnvironment(exec, cwd, { force: true }),
      getSharedSfEnvironment(exec, cwd, { force: true }),
    ]);

    expect(first).toEqual(second);
    expect(calls).toEqual(["sf --version", "sf config list --json"]);
  });

  it("returns the cached value when force is not requested", async () => {
    process.env.HOME = createTempDir();
    const cwd = createTempDir();
    const calls: string[] = [];
    const exec = mockExec(
      {
        "sf --version": { stdout: "@salesforce/cli/2.130.9\n" },
        "sf config list --json": { stdout: JSON.stringify({ result: [] }) },
      },
      calls,
    );

    const first = await getSharedSfEnvironment(exec, cwd, { force: true });
    const second = await getSharedSfEnvironment(exec, cwd);

    expect(second).toBe(first);
    expect(calls).toEqual(["sf --version", "sf config list --json"]);
    expect(peekSharedSfEnvironment(cwd)).toEqual(first);
  });

  it("force refreshes after a cached result exists", async () => {
    process.env.HOME = createTempDir();
    const cwd = createTempDir();
    let version = "2.130.9";
    const calls: string[] = [];
    const exec: SharedExecFn = async (command, args) => {
      const key = `${command} ${args.join(" ")}`;
      calls.push(key);
      if (key === "sf --version") {
        return { stdout: `@salesforce/cli/${version}\n`, stderr: "", code: 0 };
      }
      if (key === "sf config list --json") {
        return { stdout: JSON.stringify({ result: [] }), stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "command not found", code: 127 };
    };

    const first = await getSharedSfEnvironment(exec, cwd, { force: true });
    version = "2.131.0";
    const refreshed = await getSharedSfEnvironment(exec, cwd, { force: true });

    expect(first.cli.version).toBe("2.130.9");
    expect(refreshed.cli.version).toBe("2.131.0");
    expect(calls).toEqual([
      "sf --version",
      "sf config list --json",
      "sf --version",
      "sf config list --json",
    ]);
  });

  it("reuses an in-flight detection even when force is requested twice", async () => {
    process.env.HOME = createTempDir();
    const cwd = createTempDir();
    const calls: string[] = [];
    const exec = mockExec(
      {
        "sf --version": { stdout: "@salesforce/cli/2.130.9\n" },
        "sf config list --json": { stdout: JSON.stringify({ result: [] }) },
      },
      calls,
      5,
    );

    const first = getSharedSfEnvironment(exec, cwd, { force: true });
    const second = getSharedSfEnvironment(exec, cwd, { force: true });

    await Promise.all([first, second]);
    expect(calls).toEqual(["sf --version", "sf config list --json"]);
  });

  it("hydrates from the persisted cache after in-memory state is cleared", async () => {
    process.env.HOME = createTempDir();
    const cwd = createTempDir();
    const calls: string[] = [];
    const exec = mockExec(
      {
        "sf --version": { stdout: "@salesforce/cli/2.130.9\n" },
        "sf config list --json": { stdout: JSON.stringify({ result: [] }) },
      },
      calls,
    );

    const first = await getSharedSfEnvironment(exec, cwd, { force: true });
    clearSharedSfEnvironment();

    const cached = getCachedSfEnvironment(cwd);
    expect(cached).toEqual(first);
    expect(peekSharedSfEnvironment(cwd)).toEqual(first);
    expect(calls).toEqual(["sf --version", "sf config list --json"]);
  });
});
