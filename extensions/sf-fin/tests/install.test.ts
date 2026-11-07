/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyInstallState,
  detectCli,
  isUnderNpmGlobal,
  type CliDetection,
} from "../lib/install/detect.ts";
import {
  buildInstallArgs,
  describeInstallFailure,
  planCliInstall,
  runCliInstall,
} from "../lib/install/installer.ts";
import { defaultShimContext, type ShimContext } from "../lib/npm-shim.ts";

/** Pins the POSIX branch so bare-name expectations hold on any host, including Windows. */
const POSIX_SHIM: ShimContext = { ...defaultShimContext(), platform: "linux" };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sf-fin-install-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function detection(overrides: Partial<CliDetection> = {}): CliDetection {
  return {
    installed: false,
    installSource: "missing",
    state: "missing",
    ...overrides,
  };
}

const registry = {
  latest: "0.15.0",
  time: { "0.14.1": "2026-01-01T00:00:00.000Z", "0.15.0": "2026-03-01T00:00:00.000Z" },
};

describe("planCliInstall", () => {
  it("installs the exact latest version when missing", () => {
    const plan = planCliInstall({ detection: detection(), registry });
    expect(plan).toMatchObject({ kind: "install", version: "0.15.0" });
    if (plan.kind !== "install") throw new Error("expected install");
    expect(plan.args).toEqual([
      "install",
      "-g",
      "@intercom/cli@0.15.0",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
    ]);
    expect(plan.command).not.toMatch(/sudo|@latest/);
  });

  it("updates an npm-global install and no-ops when already current", () => {
    const outdated = detection({
      installed: true,
      installSource: "npm-global",
      installedVersion: "0.14.1",
      state: "outdated",
    });
    expect(planCliInstall({ detection: outdated, registry })).toMatchObject({
      kind: "update",
      version: "0.15.0",
    });
    const current = detection({
      installed: true,
      installSource: "npm-global",
      installedVersion: "0.15.0",
      state: "current",
    });
    expect(planCliInstall({ detection: current, registry })).toMatchObject({ kind: "noop" });
  });

  it("refuses to touch a CLI not installed by global npm", () => {
    const other = detection({
      installed: true,
      installSource: "other",
      binaryPath: "/opt/brew/bin/intercom",
      installedVersion: "0.14.1",
    });
    const plan = planCliInstall({ detection: other, registry });
    expect(plan).toMatchObject({ kind: "refused" });
    expect(plan.reason).toContain("/opt/brew/bin/intercom");
  });

  it("accepts only exact requested versions and refuses below the minimum", () => {
    expect(planCliInstall({ detection: detection(), requestedVersion: "latest" })).toMatchObject({
      kind: "refused",
    });
    expect(planCliInstall({ detection: detection(), requestedVersion: "^0.14" })).toMatchObject({
      kind: "refused",
    });
    expect(planCliInstall({ detection: detection(), requestedVersion: "0.9.0" })).toMatchObject({
      kind: "refused",
    });
    expect(planCliInstall({ detection: detection(), requestedVersion: "0.14.1" })).toMatchObject({
      kind: "install",
      version: "0.14.1",
    });
  });

  it("honors npm min-release-age by picking the newest allowed version", () => {
    const plan = planCliInstall({
      detection: detection(),
      registry,
      npmPolicy: { minReleaseAge: "30" },
      now: new Date("2026-03-10T00:00:00.000Z"),
    });
    expect(plan).toMatchObject({ kind: "install", version: "0.14.1" });
  });

  it("refuses when the registry is unreachable and no version is given", () => {
    expect(planCliInstall({ detection: detection() })).toMatchObject({ kind: "refused" });
  });
});

describe("runCliInstall", () => {
  it("runs exactly one npm call with the planned args", async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    const plan = planCliInstall({ detection: detection(), registry });
    if (plan.kind !== "install") throw new Error("expected install");
    const result = await runCliInstall(exec, plan, POSIX_SHIM);
    expect(result.ok).toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0]).toEqual(["npm", buildInstallArgs("0.15.0"), { timeout: 180_000 }]);
  });

  it("explains EACCES without retrying or using sudo", async () => {
    const exec = vi.fn(async () => ({
      code: 243,
      stdout: "",
      stderr: "npm ERR! code EACCES\npermission denied",
    }));
    const plan = planCliInstall({ detection: detection(), registry });
    if (plan.kind !== "install") throw new Error("expected install");
    const result = await runCliInstall(exec, plan);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("does not retry with sudo");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("classifies common npm failures", () => {
    expect(describeInstallFailure("npm ERR! 404 Not Found")).toContain("version");
    expect(describeInstallFailure("getaddrinfo ENOTFOUND registry.npmjs.org")).toContain(
      "registry",
    );
    expect(describeInstallFailure("SELF_SIGNED_CERT_IN_CHAIN")).toContain("TLS");
  });
});

describe("detectCli", () => {
  it("recognizes an npm-global install through the bin symlink", async () => {
    const root = path.join(dir, "lib", "node_modules");
    const pkgBin = path.join(root, "@intercom", "cli", "dist");
    mkdirSync(pkgBin, { recursive: true });
    writeFileSync(path.join(pkgBin, "index.js"), "");
    mkdirSync(path.join(dir, "bin"), { recursive: true });
    const link = path.join(dir, "bin", "intercom");
    symlinkSync(path.join(pkgBin, "index.js"), link);

    expect(isUnderNpmGlobal(link, root)).toBe(true);
    expect(isUnderNpmGlobal(path.join(dir, "other", "intercom"), root)).toBe(false);

    const exec = vi.fn(async (command: string) => {
      if (command === "which") return { code: 0, stdout: `${link}\n`, stderr: "" };
      if (command === "intercom") return { code: 0, stdout: "0.14.1\n", stderr: "" };
      return { code: 0, stdout: `${root}\n`, stderr: "" };
    });
    await expect(detectCli(exec, { latestVersion: "0.15.0" }, POSIX_SHIM)).resolves.toMatchObject({
      installed: true,
      installSource: "npm-global",
      installedVersion: "0.14.1",
      state: "outdated",
    });
  });

  it("classifies install state", () => {
    expect(classifyInstallState(undefined, false, "0.14.1")).toBe("missing");
    expect(classifyInstallState(undefined, true, "0.14.1")).toBe("unknown");
    expect(classifyInstallState("0.9.0", true, "0.14.1")).toBe("below-minimum");
    expect(classifyInstallState("0.14.0", true, "0.14.1")).toBe("outdated");
    expect(classifyInstallState("0.14.1", true, "0.14.1")).toBe("current");
    expect(classifyInstallState("0.14.1", true, undefined)).toBe("current");
  });
});

describe("Windows npm shims", () => {
  // Mirrors npm's Windows layout: npm.cmd next to node.exe, and the global
  // prefix holding intercom.cmd plus the package. Injected, so this runs anywhere.
  const W = path.win32;
  const NODE_DIR = W.join("C:\\", "apps", "nodejs");
  const APPDATA = W.join("C:\\", "Users", "dev", "AppData", "Roaming");
  const PREFIX = W.join(APPDATA, "npm");
  const NODE = W.join(NODE_DIR, "node.exe");
  const npmCli = W.join(NODE_DIR, "node_modules", "npm", "bin", "npm-cli.js");
  const intercomJs = W.join(PREFIX, "node_modules", "@intercom", "cli", "dist", "index.js");
  const files: Record<string, string> = {
    [W.join(NODE_DIR, "npm.cmd")]:
      String.raw`SET "NPM_CLI_JS=%~dp0\node_modules\npm\bin\npm-cli.js"`,
    [npmCli]: "",
    [W.join(PREFIX, "intercom.cmd")]:
      String.raw`"%_prog%"  "%dp0%\node_modules\@intercom\cli\dist\index.js" %*`,
    [intercomJs]: "",
  };
  const shim: ShimContext = {
    platform: "win32",
    env: { PATH: `${NODE_DIR};${PREFIX}`, APPDATA },
    exists: (file) => Object.keys(files).some((k) => k.toLowerCase() === file.toLowerCase()),
    readText: (file) => {
      const key = Object.keys(files).find((k) => k.toLowerCase() === file.toLowerCase());
      if (key === undefined) throw new Error("ENOENT");
      return files[key];
    },
    nodePath: NODE,
  };

  it("installs by running node with npm-cli.js, not the bare npm name", async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    const plan = planCliInstall({ detection: detection(), registry });
    if (plan.kind !== "install") throw new Error("expected install");
    await runCliInstall(exec, plan, shim);
    expect(exec.mock.calls[0]).toEqual([
      NODE,
      [npmCli, ...buildInstallArgs("0.15.0")],
      { timeout: 180_000 },
    ]);
  });

  it("detects an npm-global intercom through its shim, without which", async () => {
    const calls: string[] = [];
    const exec = vi.fn(async (command: string, args: string[]) => {
      calls.push([command, ...args].join(" "));
      if (command === NODE && args[0] === intercomJs)
        return { code: 0, stdout: "0.15.0\n", stderr: "" };
      if (command === NODE && args[0] === npmCli && args[1] === "root")
        return { code: 0, stdout: `${W.join(PREFIX, "node_modules")}\n`, stderr: "" };
      return { code: 1, stdout: "", stderr: "spawn ENOENT" };
    });
    await expect(detectCli(exec, { latestVersion: "0.15.0" }, shim)).resolves.toMatchObject({
      installed: true,
      installedVersion: "0.15.0",
      installSource: "npm-global",
      state: "current",
    });
    expect(calls.some((call) => call.startsWith("which "))).toBe(false);
  });

  it("reports missing when no intercom shim is on PATH", async () => {
    const empty: ShimContext = { ...shim, exists: () => false };
    const exec = vi.fn(async () => ({ code: 1, stdout: "", stderr: "spawn ENOENT" }));
    await expect(detectCli(exec, {}, empty)).resolves.toMatchObject({
      installed: false,
      state: "missing",
    });
  });
});
