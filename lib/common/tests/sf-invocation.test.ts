/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSfEntryPoint, sfCommand } from "../sf-invocation.ts";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
let root: string;
let localAppData: string;
let originalPath: string | undefined;
let originalLocalAppData: string | undefined;
let clock = 0;

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

/** Mirrors the auto-updated client: %LOCALAPPDATA%\sf\client\bin\sf.cmd -> versioned folder. */
function autoUpdatedLayout(version: string): { node: string; run: string } {
  const clientRoot = path.join(localAppData, "sf", "client");
  write(
    path.join(clientRoot, "bin", "sf.cmd"),
    `@echo off\r\nsetlocal enableextensions\r\nset SF_REDIRECTED=1\r\nset SF_BINPATH=%~dp0sf\r\n"%~dp0..\\${version}\\bin\\sf.cmd" %*\r\n`,
  );
  const versionBin = path.join(clientRoot, version, "bin");
  write(path.join(versionBin, "node.exe"));
  write(path.join(versionBin, "run.js"));
  return { node: path.join(versionBin, "node.exe"), run: path.join(versionBin, "run.js") };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sf-ca-exec-"));
  localAppData = path.join(root, "LocalAppData");
  mkdirSync(localAppData, { recursive: true });
  originalPath = process.env.PATH;
  originalLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localAppData;
  clock += 1_000_000;
});

afterEach(() => {
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  process.env.PATH = originalPath;
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = originalLocalAppData;
  rmSync(root, { recursive: true, force: true });
});

describe("sf entry point resolution (Windows)", () => {
  it("uses the installer's bundled client: client\\bin\\node.exe running run.js", () => {
    const { bin, node, run } = installerLayout();
    expect(resolveSfEntryPoint({ PATH: bin, LOCALAPPDATA: localAppData }, clock)).toEqual([
      node,
      ["--no-deprecation", run],
    ]);
  });

  it("follows the installer's redirect to the auto-updated client under LOCALAPPDATA", () => {
    const { bin } = installerLayout();
    const updated = autoUpdatedLayout("2.153.5-577d18f");
    expect(resolveSfEntryPoint({ PATH: bin, LOCALAPPDATA: localAppData }, clock)).toEqual([
      updated.node,
      ["--no-deprecation", updated.run],
    ]);
  });

  it("accepts the legacy extensionless run script", () => {
    const bin = path.join(root, "sf_cli", "bin");
    write(path.join(bin, "sf.cmd"));
    const clientBin = path.join(root, "sf_cli", "client", "bin");
    write(path.join(clientBin, "node.exe"));
    write(path.join(clientBin, "run"));
    expect(resolveSfEntryPoint({ PATH: bin, LOCALAPPDATA: localAppData }, clock)).toEqual([
      path.join(clientBin, "node.exe"),
      ["--no-deprecation", path.join(clientBin, "run")],
    ]);
  });

  it("uses the npm global layout: Node running node_modules\\@salesforce\\cli\\bin\\run.js", () => {
    const npmDir = path.join(root, "npm");
    write(path.join(npmDir, "sf.cmd"));
    const runJs = path.join(npmDir, "node_modules", "@salesforce", "cli", "bin", "run.js");
    write(runJs);
    expect(resolveSfEntryPoint({ PATH: npmDir, LOCALAPPDATA: localAppData }, clock)).toEqual([
      process.execPath,
      [runJs],
    ]);
  });

  it("picks the first sf.cmd on PATH, matching what a shell would run", () => {
    const { bin, node, run } = installerLayout();
    const npmDir = path.join(root, "npm");
    write(path.join(npmDir, "sf.cmd"));
    write(path.join(npmDir, "node_modules", "@salesforce", "cli", "bin", "run.js"));
    const env = { PATH: [bin, npmDir].join(path.delimiter), LOCALAPPDATA: localAppData };
    expect(resolveSfEntryPoint(env, clock)).toEqual([node, ["--no-deprecation", run]]);
  });

  it("returns null when no sf.cmd is on PATH", () => {
    expect(
      resolveSfEntryPoint({ PATH: path.join(root, "missing"), LOCALAPPDATA: localAppData }, clock),
    ).toBeNull();
  });
});

describe("sfCommand", () => {
  it("never routes through cmd.exe, and keeps user arguments as single args", () => {
    setPlatform("win32");
    const { bin, node, run } = installerLayout();
    process.env.PATH = bin;

    const target = "src\\classes & calc.cls";
    const [file, args] = sfCommand(["code-analyzer", "run", "--target", target]);
    expect(file).toBe(node);
    expect(file.toLowerCase()).not.toContain("cmd");
    expect(args).toEqual(["--no-deprecation", run, "code-analyzer", "run", "--target", target]);
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
