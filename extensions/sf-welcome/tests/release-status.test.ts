/* SPDX-License-Identifier: Apache-2.0 */
/** Unit checks for release freshness detectors. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  detectPiReleaseStatus,
  readCachedPiReleaseStatus,
  writeCachedPiReleaseStatus,
  type NpmPolicyCommandFn,
} from "../lib/release-status.ts";
import { getInstalledPiVersion } from "../../../lib/common/pi-compat.ts";

const noPolicyRunner: NpmPolicyCommandFn = async () => "null";

describe("detectPiReleaseStatus", () => {
  it("reports latest when the remote version matches the installed Pi runtime", async () => {
    const installed = getInstalledPiVersion();
    const status = await detectPiReleaseStatus(async () => installed, {} as NodeJS.ProcessEnv, {
      runNpm: noPolicyRunner,
    });

    expect(status.installedVersion).toBe(installed);
    expect(status.latestVersion).toBe(installed);
    expect(status.freshness).toBe("latest");
    expect(status.loading).toBe(false);
  });

  it("migrates a cached future stable release from blocked to forward-compatible", () => {
    const agentDir = mkdtempSync(path.join(tmpdir(), "sf-welcome-pi-cache-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    try {
      // Shape written by the old hard-ceiling policy.
      writeCachedPiReleaseStatus({
        installedVersion: "0.84.0",
        latestVersion: "0.84.0",
        absoluteLatestVersion: "0.86.0",
        supportWindowLimited: true,
        freshness: "latest",
        loading: false,
        updateCommand: "/sf-pi doctor runtime",
      });

      const status = readCachedPiReleaseStatus("0.84.0", Number.POSITIVE_INFINITY);

      expect(status?.freshness).toBe("update-available");
      expect(status?.latestVersion).toBe("0.86.0");
      expect(status?.forwardCompatibility).toBe(true);
      expect(status?.supportWindowLimited).toBe(false);
      expect(status?.updateCommand).toBe("pi update --self");
    } finally {
      vi.unstubAllEnvs();
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("allows an upstream stable Pi release in forward-compatibility mode", async () => {
    const status = await detectPiReleaseStatus(async () => "0.86.0", {} as NodeJS.ProcessEnv, {
      runNpm: noPolicyRunner,
      installedVersion: "0.84.0",
    });

    expect(status.freshness).toBe("update-available");
    expect(status.latestVersion).toBe("0.86.0");
    expect(status.forwardCompatibility).toBe(true);
    expect(status.supportWindowLimited).toBe(false);
    expect(status.updateCommand).toBe("pi update --self");
  });

  it("still blocks Pi prereleases", async () => {
    const status = await detectPiReleaseStatus(async () => "0.86.0-rc.1", {} as NodeJS.ProcessEnv, {
      runNpm: noPolicyRunner,
      installedVersion: "0.85.1",
    });

    expect(status.freshness).toBe("latest");
    expect(status.latestVersion).toBe("0.85.1");
    expect(status.absoluteLatestVersion).toBe("0.86.0-rc.1");
    expect(status.supportWindowLimited).toBe(true);
    expect(status.updateCommand).toBe("/sf-pi doctor runtime");
  });

  it("still blocks Pi 1.x pending a major-version audit", async () => {
    const status = await detectPiReleaseStatus(async () => "1.0.0", {} as NodeJS.ProcessEnv, {
      runNpm: noPolicyRunner,
      installedVersion: "0.85.1",
    });

    expect(status.freshness).toBe("latest");
    expect(status.latestVersion).toBe("0.85.1");
    expect(status.absoluteLatestVersion).toBe("1.0.0");
    expect(status.supportWindowLimited).toBe(true);
    expect(status.updateCommand).toBe("/sf-pi doctor runtime");
  });

  it("reports update availability for the latest audited Pi release", async () => {
    const status = await detectPiReleaseStatus(async () => "0.85.1", {} as NodeJS.ProcessEnv, {
      runNpm: noPolicyRunner,
      installedVersion: "0.83.0",
    });

    expect(status.freshness).toBe("update-available");
    expect(status.latestVersion).toBe("0.85.1");
    expect(status.updateCommand).toBe("pi update --self");
  });

  it("respects Pi offline/version-check flags", async () => {
    let fetchCalls = 0;
    const status = await detectPiReleaseStatus(
      async () => {
        fetchCalls += 1;
        return "0.84.0";
      },
      { PI_OFFLINE: "1" } as NodeJS.ProcessEnv,
      { runNpm: noPolicyRunner },
    );

    expect(fetchCalls).toBe(0);
    expect(status.freshness).toBe("unknown");
    expect(status.checkSkipped).toBe(true);
    expect(status.skipReason).toBe("offline");
  });

  it("treats the policy-visible latest as current when npm cooldown filters an in-window release", async () => {
    const installed = "0.84.0";
    const cutoff = "2026-05-19T00:00:00.000Z";
    const runNpm: NpmPolicyCommandFn = async (args) => {
      if (args.join(" ") === "config get before") return cutoff;
      if (args[0] === "config") return "null";
      if (args.join(" ") === "view @earendil-works/pi-coding-agent time --json") {
        return JSON.stringify({
          [installed]: "2026-05-18T00:00:00.000Z",
          "0.84.1": "2026-05-20T00:00:00.000Z",
        });
      }
      return undefined;
    };

    const status = await detectPiReleaseStatus(async () => "0.84.1", {} as NodeJS.ProcessEnv, {
      runNpm,
      installedVersion: installed,
    });

    expect(status.freshness).toBe("latest");
    expect(status.latestVersion).toBe(installed);
    expect(status.absoluteLatestVersion).toBe("0.84.1");
    expect(status.policyVisibleLatestVersion).toBe(installed);
    expect(status.cooldownActive).toBe(true);
  });

  it("reports an update when npm cooldown allows a newer in-window version", async () => {
    const installed = "0.84.0";
    const cutoff = "2026-05-21T00:00:00.000Z";
    const runNpm: NpmPolicyCommandFn = async (args) => {
      if (args.join(" ") === "config get before") return cutoff;
      if (args[0] === "config") return "null";
      if (args.join(" ") === "view @earendil-works/pi-coding-agent time --json") {
        return JSON.stringify({
          [installed]: "2026-05-18T00:00:00.000Z",
          "0.84.1": "2026-05-20T00:00:00.000Z",
        });
      }
      return undefined;
    };

    const status = await detectPiReleaseStatus(async () => "0.84.1", {} as NodeJS.ProcessEnv, {
      runNpm,
      installedVersion: installed,
    });

    expect(status.freshness).toBe("update-available");
    expect(status.latestVersion).toBe("0.84.1");
    expect(status.cooldownActive).toBe(false);
  });

  it("degrades to unknown when npm cooldown is detected but policy-visible latest cannot be computed", async () => {
    const runNpm: NpmPolicyCommandFn = async (args) => {
      if (args.join(" ") === "config get before") return "2026-05-19T00:00:00.000Z";
      if (args[0] === "config") return "null";
      return undefined;
    };

    const status = await detectPiReleaseStatus(async () => "0.84.1", {} as NodeJS.ProcessEnv, {
      runNpm,
      installedVersion: "0.84.0",
    });

    expect(status.freshness).toBe("unknown");
    expect(status.latestVersion).toBeUndefined();
    expect(status.absoluteLatestVersion).toBe("0.84.1");
    expect(status.cooldownActive).toBeUndefined();
  });
});
