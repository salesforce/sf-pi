/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCodeAnalyzerExec, resolveSfEntryPoint, sfCommand } from "../lib/exec.ts";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
let root: string;
let originalPath: string | undefined;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform });
}

function touch(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "");
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sf-ca-exec-"));
  originalPath = process.env.PATH;
});

afterEach(() => {
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  process.env.PATH = originalPath;
  rmSync(root, { recursive: true, force: true });
});

describe("sf entry point resolution (Windows)", () => {
  it("uses the installer layout: client\\bin\\node.exe running client\\bin\\run", () => {
    const bin = path.join(root, "sf_cli", "bin");
    touch(path.join(bin, "sf.cmd"));
    const clientBin = path.join(root, "sf_cli", "client", "bin");
    touch(path.join(clientBin, "node.exe"));
    touch(path.join(clientBin, "run"));

    expect(resolveSfEntryPoint(bin, 1)).toEqual([
      path.join(clientBin, "node.exe"),
      ["--no-deprecation", path.join(clientBin, "run")],
    ]);
  });

  it("uses the npm global layout: Node running node_modules\\@salesforce\\cli\\bin\\run.js", () => {
    const npmDir = path.join(root, "npm");
    touch(path.join(npmDir, "sf.cmd"));
    const runJs = path.join(npmDir, "node_modules", "@salesforce", "cli", "bin", "run.js");
    touch(runJs);

    expect(resolveSfEntryPoint(npmDir, 2)).toEqual([process.execPath, [runJs]]);
  });

  it("returns null when no sf.cmd is on PATH", () => {
    expect(resolveSfEntryPoint(path.join(root, "missing"), 3)).toBeNull();
  });
});

describe("sfCommand", () => {
  it("never routes through cmd.exe, and keeps user arguments as single args", () => {
    setPlatform("win32");
    const bin = path.join(root, "sf_cli", "bin");
    touch(path.join(bin, "sf.cmd"));
    const clientBin = path.join(root, "sf_cli", "client", "bin");
    touch(path.join(clientBin, "node.exe"));
    touch(path.join(clientBin, "run"));
    process.env.PATH = bin;

    const target = "src\\classes & calc.cls";
    const [file, args] = sfCommand(["code-analyzer", "run", "--target", target]);
    expect(file).toBe(path.join(clientBin, "node.exe"));
    expect(file.toLowerCase()).not.toContain("cmd");
    expect(args).toEqual([
      "--no-deprecation",
      path.join(clientBin, "run"),
      "code-analyzer",
      "run",
      "--target",
      target,
    ]);
  });

  it("falls back to plain sf when no entry point is found, so the error stays honest", () => {
    setPlatform("win32");
    process.env.PATH = path.join(root, "empty");
    expect(sfCommand(["--version"])).toEqual(["sf", ["--version"]]);
  });

  it("leaves sf unchanged on non-Windows platforms", () => {
    setPlatform("linux");
    expect(sfCommand(["--version"])).toEqual(["sf", ["--version"]]);
  });
});

describe("buildCodeAnalyzerExec", () => {
  it("routes sf through the resolved entry point and leaves other commands alone on Windows", async () => {
    setPlatform("win32");
    const bin = path.join(root, "sf_cli", "bin");
    touch(path.join(bin, "sf.cmd"));
    const clientBin = path.join(root, "sf_cli", "client", "bin");
    touch(path.join(clientBin, "node.exe"));
    touch(path.join(clientBin, "run"));
    process.env.PATH = bin;

    const exec = vi.fn(async () => ({ stdout: "", stderr: "", code: 0, killed: false }));
    const pi = { exec } as unknown as Parameters<typeof buildCodeAnalyzerExec>[0];
    const run = buildCodeAnalyzerExec(pi);

    await run("sf", ["--version"], { timeout: 1000 });
    expect(exec).toHaveBeenLastCalledWith(
      path.join(clientBin, "node.exe"),
      ["--no-deprecation", path.join(clientBin, "run"), "--version"],
      expect.objectContaining({ timeout: 1000 }),
    );

    await run("java", ["-version"]);
    expect(exec).toHaveBeenLastCalledWith("java", ["-version"], expect.anything());
  });
});
