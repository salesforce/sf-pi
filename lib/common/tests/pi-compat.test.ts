/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Version-gate unit tests for pi-compat.
 *
 * Covers the semver-ish comparator and the documented precedence rules used
 * by `requirePiVersion` without trying to stub out `readFileSync`. The
 * console.warn-capture test exercises the public behavior agent authors care
 * about: on an older pi the gate returns false AND logs exactly one line per
 * extension name.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { SF_PI_REGISTRY } from "../../../catalog/registry.ts";
import {
  compareVersions,
  getInstalledPiVersion,
  isPiVersionSupported,
  MAX_PI_VERSION_EXCLUSIVE,
  MIN_PI_VERSION,
  requirePiVersion,
} from "../pi-compat.ts";

describe("compareVersions", () => {
  it("returns 0 for equal full-release versions", () => {
    expect(compareVersions("0.72.0", "0.72.0")).toBe(0);
  });

  it("orders patch releases correctly", () => {
    expect(compareVersions("0.72.1", "0.72.0")).toBeGreaterThan(0);
    expect(compareVersions("0.72.0", "0.72.1")).toBeLessThan(0);
  });

  it("orders minor releases correctly", () => {
    expect(compareVersions("0.72.0", "0.71.9")).toBeGreaterThan(0);
    expect(compareVersions("0.70.6", "0.72.0")).toBeLessThan(0);
  });

  it("treats a prerelease as older than the same core full release", () => {
    // Matches how our gate should interpret "0.72.0-rc.1" < "0.72.0".
    expect(compareVersions("0.72.0-rc.1", "0.72.0")).toBeLessThan(0);
    expect(compareVersions("0.72.0", "0.72.0-rc.1")).toBeGreaterThan(0);
  });

  it("pads short inputs with zeroes so '0.72' == '0.72.0'", () => {
    expect(compareVersions("0.72", "0.72.0")).toBe(0);
  });
});

function productionTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests" || entry.name === "__tests__") continue;
      files.push(...productionTypeScriptFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("pi version floor", () => {
  it("every bundled extension gates startup through requirePiVersion", () => {
    for (const extension of SF_PI_REGISTRY) {
      const source = readFileSync(path.resolve(extension.file), "utf8");
      expect(source).toContain(`requirePiVersion(pi, "${extension.id}")`);
    }
  });

  it("does not use Pi's removed private authStorage surface", () => {
    const offenders = ["extensions", "lib"]
      .flatMap((root) => productionTypeScriptFiles(path.resolve(root)))
      .filter((file) => readFileSync(file, "utf8").includes(".authStorage"))
      .map((file) => path.relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });

  it("declares every bundled extension in package.json so Pi can load it", () => {
    const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      pi?: { extensions?: string[] };
    };
    const packageExtensions = new Set(
      (pkg.pi?.extensions ?? []).map((entry) => entry.replace(/^\.\//, "")),
    );

    for (const extension of SF_PI_REGISTRY) {
      expect(packageExtensions).toContain(extension.file);
    }
  });

  it("tracks the temporary package support window and exact development SDK", () => {
    const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(MIN_PI_VERSION).toBe("0.81.1");
    expect(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"]).toBe(">=0.81.1 <0.82.0");
    expect(pkg.peerDependencies?.["@earendil-works/pi-ai"]).toBe("*");
    expect(pkg.peerDependencies?.["@earendil-works/pi-tui"]).toBe("*");
    expect(pkg.devDependencies?.["@earendil-works/pi-coding-agent"]).toBe("0.81.1");
    expect(pkg.devDependencies?.["@earendil-works/pi-ai"]).toBe("0.81.1");
    expect(pkg.devDependencies?.["@earendil-works/pi-tui"]).toBe("0.81.1");
  });
});

describe("temporary pi support window", () => {
  it("accepts audited 0.81 patches but rejects either side", () => {
    expect(MIN_PI_VERSION).toBe("0.81.1");
    expect(MAX_PI_VERSION_EXCLUSIVE).toBe("0.82.0");
    expect(isPiVersionSupported("0.81.0")).toBe(false);
    expect(isPiVersionSupported("0.81.1")).toBe(true);
    expect(isPiVersionSupported("0.81.9")).toBe(true);
    expect(isPiVersionSupported("0.82.0-rc.1")).toBe(false);
    expect(isPiVersionSupported("0.82.0")).toBe(false);
  });
});

describe("requirePiVersion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when the installed pi meets the floor", () => {
    // The live pi-coding-agent in node_modules is >= MIN_PI_VERSION whenever
    // the repo is in a valid developer state, which is enforced by
    // peerDependencies + npm install. If that invariant is broken, every
    // other sf-pi test will fail first, so this assertion is a tripwire for
    // the gate itself, not for the environment.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(requirePiVersion(null, "sf-pi-compat-test", MIN_PI_VERSION)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns false and logs once when below the floor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Use a floor far above any plausible installed version so the gate
    // definitely trips, regardless of which pi version the dev has locally.
    const unreachable = "9999.0.0";
    // First call: logs.
    expect(requirePiVersion(null, "sf-pi-compat-once", unreachable)).toBe(false);
    // Second call with the same extension name: no second log.
    expect(requirePiVersion(null, "sf-pi-compat-once", unreachable)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/sf-pi-compat-once/);
    expect(warn.mock.calls[0][0]).toMatch(/9999\.0\.0/);
    expect(warn.mock.calls[0][0]).toMatch(/Pi 0\.81\.1/);
    expect(warn.mock.calls[0][0]).toMatch(/\/sf-pi doctor runtime/);
  });

  it("older Pi degrades by skipping the extension instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const ok = requirePiVersion({ any: "shape" }, "sf-old-pi-skip", "9999.0.0");

    expect(ok).toBe(false);
    expect(warn.mock.calls[0][0]).toContain('Skipping "sf-old-pi-skip"');
    expect(warn.mock.calls[0][0]).toContain("Use Pi 0.81.1");
  });

  it("newer Pi degrades with the full supported window instead of loading", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const installed = getInstalledPiVersion();
    expect(installed).toBeDefined();

    const ok = requirePiVersion(null, "sf-new-pi-skip", "0.0.0", installed!);

    expect(ok).toBe(false);
    expect(warn.mock.calls[0][0]).toContain('Skipping "sf-new-pi-skip"');
    expect(warn.mock.calls[0][0]).toContain(`>= 0.0.0 and < ${installed}`);
    expect(warn.mock.calls[0][0]).toContain(`found ${installed}`);
    expect(warn.mock.calls[0][0]).toContain("/sf-pi doctor runtime");
  });
});
