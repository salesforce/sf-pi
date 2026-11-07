/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * Lay out an npm global prefix the way `npm install -g hunkdiff` does on
 * Windows: a `hunk.cmd` shim next to `node_modules\hunkdiff`, whose package.json
 * declares the real Node entry point.
 */
function createNpmPrefix(root: string, options: { withBin?: boolean } = {}): string {
  const prefix = path.join(root, "npm");
  const pkgDir = path.join(prefix, "node_modules", "hunkdiff");
  mkdirSync(path.join(pkgDir, "bin"), { recursive: true });
  writeFileSync(
    path.join(prefix, "hunk.cmd"),
    '@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\hunkdiff\\bin\\hunk.cjs" %*\r\n',
  );
  writeFileSync(path.join(prefix, "hunkdiff.cmd"), "@ECHO off\r\n");
  writeFileSync(path.join(pkgDir, "bin", "hunk.cjs"), "// entry\n");
  const pkg =
    options.withBin === false
      ? { name: "hunkdiff", version: "0.24.1" }
      : {
          name: "hunkdiff",
          version: "0.24.1",
          bin: { hunk: "./bin/hunk.cjs", hunkdiff: "./bin/hunk.cjs" },
        };
  writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(pkg));
  return prefix;
}

describe("Hunk readiness", () => {
  it("parses semver output", () => {
    expect(parseHunkVersion("hunk 0.12.0-beta.1")).toBe("0.12.0-beta.1");
  });

  it("detects the hunk binary first", async () => {
    const status = await detectHunkStatus(
      createExec({ "hunk --version": { stdout: "hunk 0.12.0\n" } }),
      { platform: "linux" },
    );
    expect(status).toMatchObject({ installed: true, command: "hunk", installedVersion: "0.12.0" });
  });

  it("falls back to hunkdiff", async () => {
    const status = await detectHunkStatus(
      createExec({
        "hunkdiff --version": { stdout: "hunkdiff 0.11.0\n" },
      }),
      { platform: "linux" },
    );
    expect(status).toMatchObject({ installed: true, command: "hunkdiff" });
  });

  it("reports missing when neither binary works", async () => {
    const status = await detectHunkStatus(
      async () => {
        throw new Error("not found");
      },
      { platform: "linux" },
    );
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

describe("Hunk readiness on Windows (npm .cmd shim)", () => {
  it("runs the package entry with node, never the bare name or a shell", async () => {
    const prefix = createNpmPrefix(tmpDir);
    const entry = path.join(prefix, "node_modules", "hunkdiff", "bin", "hunk.cjs");
    const calls: Array<{ command: string; args: string[] }> = [];
    const exec: HunkExecFn = async (command, args) => {
      calls.push({ command, args });
      return { stdout: "0.24.1\n", stderr: "", code: 0 };
    };

    const status = await detectHunkStatus(exec, {
      platform: "win32",
      env: { PATH: prefix },
      nodePath: "C:\\apps\\nodejs\\node.exe",
    });

    expect(calls).toEqual([{ command: "C:\\apps\\nodejs\\node.exe", args: [entry, "--version"] }]);
    expect(status).toMatchObject({ installed: true, command: "hunk", installedVersion: "0.24.1" });
  });

  it("uses the running Node binary by default", async () => {
    const prefix = createNpmPrefix(tmpDir);
    const commands: string[] = [];
    const exec: HunkExecFn = async (command) => {
      commands.push(command);
      return { stdout: "0.24.1\n", stderr: "", code: 0 };
    };

    await detectHunkStatus(exec, { platform: "win32", env: { PATH: prefix } });

    expect(commands).toEqual([process.execPath]);
  });

  it("reports not installed when no hunk shim is on PATH", async () => {
    const empty = path.join(tmpDir, "empty");
    mkdirSync(empty, { recursive: true });
    let called = false;
    const status = await detectHunkStatus(
      async () => {
        called = true;
        return { stdout: "", stderr: "", code: 0 };
      },
      { platform: "win32", env: { PATH: empty } },
    );

    expect(called).toBe(false);
    expect(status.installed).toBe(false);
    expect(status.loading).toBe(false);
  });

  it("reports not installed when the package has no bin entry", async () => {
    const prefix = createNpmPrefix(tmpDir, { withBin: false });
    let called = false;
    const status = await detectHunkStatus(
      async () => {
        called = true;
        return { stdout: "0.24.1", stderr: "", code: 0 };
      },
      { platform: "win32", env: { PATH: prefix } },
    );

    expect(called).toBe(false);
    expect(status.installed).toBe(false);
  });

  it("reports not installed when the entry point fails to run", async () => {
    const prefix = createNpmPrefix(tmpDir);
    const status = await detectHunkStatus(
      async () => {
        throw new Error("spawn failed");
      },
      { platform: "win32", env: { PATH: prefix } },
    );

    expect(status.installed).toBe(false);
  });

  it("keeps the bare-name probe on POSIX", async () => {
    const calls: string[] = [];
    await detectHunkStatus(
      async (command, args) => {
        calls.push([command, ...args].join(" "));
        return { stdout: "hunk 0.12.0\n", stderr: "", code: 0 };
      },
      { platform: "linux", env: { PATH: "" } },
    );

    expect(calls).toEqual(["hunk --version"]);
  });
});
