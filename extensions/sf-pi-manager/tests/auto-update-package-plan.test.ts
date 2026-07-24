/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  isDeclaredPiCompatible,
  planCompatiblePiPackageUpdates,
} from "../lib/auto-update-package-plan.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
let tmpDir: string;
let previousAgentDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-update-plan-"));
  previousAgentDir = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (previousAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = previousAgentDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeSettings(packages: unknown[]): void {
  writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify({ packages }));
}

function writeInstalledPackage(name: string, version: string): void {
  const packageDir = path.join(tmpDir, "npm", "node_modules", ...name.split("/"));
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ name, version }));
}

function piWithMetadata(metadata: Record<string, unknown>) {
  return {
    exec: vi.fn(async () => ({
      stdout: JSON.stringify(metadata),
      stderr: "",
      code: 0,
      killed: false,
    })),
  } as unknown as ExtensionAPI;
}

describe("Auto Update Pi package compatibility plan", () => {
  it("accepts only peer ranges it can prove against the active Pi version", () => {
    expect(isDeclaredPiCompatible("*", "0.81.1")).toBe(true);
    expect(isDeclaredPiCompatible(">=0.81.1 <0.82.0", "0.81.1")).toBe(true);
    expect(isDeclaredPiCompatible(">=0.81.1 <0.82.0", "0.82.0")).toBe(false);
    expect(isDeclaredPiCompatible("0.81.1", "0.81.1")).toBe(true);
    expect(isDeclaredPiCompatible("^0.81.0", "0.81.1")).toBe(false);
    expect(isDeclaredPiCompatible("latest", "0.81.1")).toBe(false);
  });

  it("selects an outdated unpinned Herdr package and skips pinned/local entries", async () => {
    writeSettings([
      "npm:@ogulcancelik/pi-herdr",
      "npm:some-package@1.2.3",
      "git:github.com/example/package@v1",
      "/local/package",
    ]);
    writeInstalledPackage("@ogulcancelik/pi-herdr", "0.3.0");
    const pi = piWithMetadata({
      version: "0.4.0",
      peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
    });

    const plan = await planCompatiblePiPackageUpdates(pi, tmpDir, {
      piVersion: "0.81.1",
    });

    expect(plan.sources).toEqual(["npm:@ogulcancelik/pi-herdr"]);
    expect(plan).toMatchObject({ configuredCount: 4, eligibleCount: 1, skippedCount: 3 });
    expect(pi.exec).toHaveBeenCalledWith(
      "npm",
      ["view", "@ogulcancelik/pi-herdr@latest", "version", "peerDependencies", "engines", "--json"],
      expect.objectContaining({ cwd: tmpDir }),
    );
  });

  it("rejects invalid package names before invoking npm", async () => {
    writeSettings(["npm:--workspace=/private/path", "npm:../../escape"]);
    const pi = piWithMetadata({
      version: "1.0.0",
      peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
    });

    const plan = await planCompatiblePiPackageUpdates(pi, tmpDir, {
      piVersion: "0.81.1",
    });

    expect(plan.sources).toEqual([]);
    expect(plan.skippedCount).toBe(2);
    expect(pi.exec).not.toHaveBeenCalled();
  });

  it("skips latest releases whose declared Pi peer excludes the active runtime", async () => {
    writeSettings(["npm:future-package"]);
    writeInstalledPackage("future-package", "1.0.0");
    const pi = piWithMetadata({
      version: "2.0.0",
      peerDependencies: { "@earendil-works/pi-coding-agent": ">=0.82.0" },
    });

    const plan = await planCompatiblePiPackageUpdates(pi, tmpDir, {
      piVersion: "0.81.1",
    });

    expect(plan.sources).toEqual([]);
    expect(plan.skippedCount).toBe(1);
  });

  it("skips latest releases when any declared Pi peer excludes the active runtime", async () => {
    writeSettings(["npm:mixed-peer-package"]);
    writeInstalledPackage("mixed-peer-package", "1.0.0");
    const pi = piWithMetadata({
      version: "2.0.0",
      peerDependencies: {
        "@earendil-works/pi-coding-agent": "*",
        "@earendil-works/pi-tui": ">=0.82.0",
      },
    });

    const plan = await planCompatiblePiPackageUpdates(pi, tmpDir, {
      piVersion: "0.81.1",
    });

    expect(plan.sources).toEqual([]);
    expect(plan.skippedCount).toBe(1);
  });

  it("skips latest releases whose Node engine excludes the active runtime", async () => {
    writeSettings(["npm:future-node-package"]);
    writeInstalledPackage("future-node-package", "1.0.0");
    const pi = piWithMetadata({
      version: "2.0.0",
      peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
      engines: { node: ">=99.0.0" },
    });

    const plan = await planCompatiblePiPackageUpdates(pi, tmpDir, {
      piVersion: "0.81.1",
      nodeVersion: "22.19.0",
    });

    expect(plan.sources).toEqual([]);
    expect(plan.skippedCount).toBe(1);
  });

  it("does not schedule a package already at the latest compatible version", async () => {
    writeSettings(["npm:@ogulcancelik/pi-herdr"]);
    writeInstalledPackage("@ogulcancelik/pi-herdr", "0.4.0");
    const pi = piWithMetadata({
      version: "0.4.0",
      peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
    });

    const plan = await planCompatiblePiPackageUpdates(pi, tmpDir, {
      piVersion: "0.81.1",
    });

    expect(plan.sources).toEqual([]);
    expect(plan.currentCount).toBe(1);
  });
});
