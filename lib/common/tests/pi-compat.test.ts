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
import { compareVersions, MIN_PI_VERSION, requirePiVersion } from "../pi-compat.ts";

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
    expect(warn.mock.calls[0][0]).toMatch(/pi update/);
  });
});
