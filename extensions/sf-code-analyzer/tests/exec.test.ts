/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCodeAnalyzerExec } from "../lib/exec.ts";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
let root: string;
let localAppData: string;
let originalPath: string | undefined;
let originalLocalAppData: string | undefined;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform });
}

function write(filePath: string, content = ""): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

/** Mirrors the Salesforce CLI installer: bin\sf.cmd plus client\bin\{node.exe,run.js}. */
function installerLayout(): { bin: string; node: string; run: string } {
  const bin = path.join(root, "sf_cli", "bin");
  write(path.join(bin, "sf.cmd"), "@echo off\r\n");
  const clientBin = path.join(root, "sf_cli", "client", "bin");
  write(path.join(clientBin, "node.exe"));
  write(path.join(clientBin, "run.js"));
  return { bin, node: path.join(clientBin, "node.exe"), run: path.join(clientBin, "run.js") };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sf-ca-exec-"));
  localAppData = path.join(root, "LocalAppData");
  mkdirSync(localAppData, { recursive: true });
  originalPath = process.env.PATH;
  originalLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localAppData;
});

afterEach(() => {
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  process.env.PATH = originalPath;
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = originalLocalAppData;
  rmSync(root, { recursive: true, force: true });
});

describe("buildCodeAnalyzerExec", () => {
  it("routes sf through the resolved entry point and leaves other commands alone on Windows", async () => {
    setPlatform("win32");
    const { bin, node, run } = installerLayout();
    process.env.PATH = bin;

    const exec = vi.fn(async () => ({ stdout: "", stderr: "", code: 0, killed: false }));
    const pi = { exec } as unknown as Parameters<typeof buildCodeAnalyzerExec>[0];
    const runExec = buildCodeAnalyzerExec(pi);

    await runExec("sf", ["--version"], { timeout: 1000 });
    expect(exec).toHaveBeenLastCalledWith(
      node,
      ["--no-deprecation", run, "--version"],
      expect.objectContaining({ timeout: 1000 }),
    );

    await runExec("java", ["-version"]);
    expect(exec).toHaveBeenLastCalledWith("java", ["-version"], expect.anything());
  });
});
