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
  AUDITED_MAX_PI_VERSION_EXCLUSIVE,
  classifyPiVersion,
  compareVersions,
  detectPiRuntimeFlavor,
  getInstalledPiVersion,
  HARD_MAX_PI_VERSION_EXCLUSIVE,
  isPiVersionLoadable,
  MAX_OMP_VERSION_EXCLUSIVE,
  MIN_OMP_VERSION,
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

  it("ignores SemVer build metadata, including hyphens", () => {
    expect(compareVersions("0.82.0+build-1", "0.82.0")).toBe(0);
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

  it("declares the audited OMP compatibility profile", () => {
    const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      omp?: { extensions?: string[] };
    };
    const ompExtensions = new Set(
      (pkg.omp?.extensions ?? []).map((entry) => entry.replace(/^\.\//, "")),
    );

    expect(MIN_OMP_VERSION).toBe("17.1.3");
    expect(MAX_OMP_VERSION_EXCLUSIVE).toBe("18.0.0");
    expect(ompExtensions).toContain("extensions/sf-pi-manager/index.ts");
    expect(ompExtensions).toContain("extensions/sf-brain/index.ts");
    expect(ompExtensions).toContain("extensions/sf-data360/index.ts");
    expect(ompExtensions).not.toContain("extensions/sf-llm-gateway-internal/index.ts");
    expect(ompExtensions).not.toContain("extensions/sf-agentscript/index.ts");
  });

  it("tracks the forward-compatible peer range and exact audited development SDK", () => {
    const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(MIN_PI_VERSION).toBe("0.81.1");
    expect(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"]).toBe(">=0.81.1 <1.0.0");
    expect(pkg.peerDependencies?.["@earendil-works/pi-ai"]).toBe("*");
    expect(pkg.peerDependencies?.["@earendil-works/pi-tui"]).toBe("*");
    expect(pkg.devDependencies?.["@earendil-works/pi-coding-agent"]).toBe("0.82.0");
    expect(pkg.devDependencies?.["@earendil-works/pi-ai"]).toBe("0.82.0");
    expect(pkg.devDependencies?.["@earendil-works/pi-tui"]).toBe("0.82.0");
  });
});

describe("runtime flavor detection", () => {
  it("detects compiled and source OMP launches", () => {
    expect(detectPiRuntimeFlavor({ execPath: "/opt/homebrew/bin/omp" })).toBe("omp");
    expect(
      detectPiRuntimeFlavor({
        version: "17.1.3",
        execPath: "/usr/local/bin/bun",
        argv: ["bun", "/pkg/src/cli.ts", "omp"],
      }),
    ).toBe("omp");
    expect(
      detectPiRuntimeFlavor({
        version: "17.1.3",
        agentDir: "/home/user/.omp/agent",
        execPath: "/usr/local/bin/wrapper",
      }),
    ).toBe("omp");
  });

  it("does not mistake normal Pi for OMP", () => {
    expect(
      detectPiRuntimeFlavor({
        version: "0.82.0",
        agentDir: "/home/user/.pi/agent",
        execPath: "/usr/local/bin/pi",
      }),
    ).toBe("pi");
  });
});

describe("Pi compatibility policy", () => {
  it("distinguishes audited, forward-compatible, and blocked releases", () => {
    expect(MIN_PI_VERSION).toBe("0.81.1");
    expect(AUDITED_MAX_PI_VERSION_EXCLUSIVE).toBe("0.83.0");
    expect(HARD_MAX_PI_VERSION_EXCLUSIVE).toBe("1.0.0");

    expect(classifyPiVersion("0.81.0")).toBe("too-old");
    expect(classifyPiVersion("0.81.1")).toBe("audited");
    expect(classifyPiVersion("0.82.0+build-1")).toBe("audited");
    expect(classifyPiVersion("0.82.9")).toBe("audited");
    expect(classifyPiVersion("0.83.0")).toBe("forward-compatible");
    expect(classifyPiVersion("0.99.0")).toBe("forward-compatible");
    expect(classifyPiVersion("0.83.0-rc.1")).toBe("prerelease");
    expect(classifyPiVersion("1.0.0")).toBe("major-version");

    expect(isPiVersionLoadable("0.83.0")).toBe(true);
    expect(isPiVersionLoadable("0.83.0-rc.1")).toBe(false);
    expect(isPiVersionLoadable("1.0.0")).toBe(false);
  });
});

describe("requirePiVersion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts the installed audited or forward-compatible runtime", () => {
    const installed = getInstalledPiVersion();
    expect(installed).toBeDefined();
    const compatibility = classifyPiVersion(installed!);
    expect(["audited", "forward-compatible"]).toContain(compatibility);

    // Preserve the process-wide forward-warning latch for the explicit
    // once-only test below when the nightly `latest` overlay is ahead.
    if (compatibility === "audited") {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(requirePiVersion(null, "sf-pi-compat-test", MIN_PI_VERSION)).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    } else {
      expect(isPiVersionLoadable(installed!)).toBe(true);
    }
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
    expect(warn.mock.calls[0][0]).toMatch(/Pi 0\.82\.0/);
    expect(warn.mock.calls[0][0]).toMatch(/\/sf-pi doctor runtime/);
  });

  it("older Pi degrades by skipping the extension instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const ok = requirePiVersion({ any: "shape" }, "sf-old-pi-skip", "9999.0.0");

    expect(ok).toBe(false);
    expect(warn.mock.calls[0][0]).toContain('Skipping "sf-old-pi-skip"');
    expect(warn.mock.calls[0][0]).toContain("Use Pi 0.82.0");
  });

  it("loads a newer stable Pi in forward-compatibility mode and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const installed = getInstalledPiVersion();
    expect(installed).toBeDefined();

    expect(requirePiVersion(null, "sf-forward-a", "0.0.0", installed!, "1.0.0")).toBe(true);
    expect(requirePiVersion(null, "sf-forward-b", "0.0.0", installed!, "1.0.0")).toBe(true);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("forward-compatibility mode");
    expect(warn.mock.calls[0][0]).not.toContain("Skipping");
  });

  it("still blocks a Pi major version pending review", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const installed = getInstalledPiVersion();
    expect(installed).toBeDefined();

    const ok = requirePiVersion(null, "sf-major-pi-skip", "0.0.0", "0.0.0", installed!);

    expect(ok).toBe(false);
    expect(warn.mock.calls[0][0]).toContain('Skipping "sf-major-pi-skip"');
    expect(warn.mock.calls[0][0]).toContain(`stable pi-coding-agent >= 0.0.0 and < ${installed}`);
    expect(warn.mock.calls[0][0]).toContain("/sf-pi doctor runtime");
  });
});
