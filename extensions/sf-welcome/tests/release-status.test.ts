/* SPDX-License-Identifier: Apache-2.0 */
/** Unit checks for release freshness detectors. */
import { describe, expect, it } from "vitest";
import { detectPiReleaseStatus, type NpmPolicyCommandFn } from "../lib/release-status.ts";
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

  it("reports update availability when the latest version is newer", async () => {
    const status = await detectPiReleaseStatus(async () => "999.0.0", {} as NodeJS.ProcessEnv, {
      runNpm: noPolicyRunner,
    });

    expect(status.freshness).toBe("update-available");
    expect(status.latestVersion).toBe("999.0.0");
    expect(status.updateCommand).toBe("pi update --self --force");
  });

  it("respects Pi offline/version-check flags", async () => {
    let fetchCalls = 0;
    const status = await detectPiReleaseStatus(
      async () => {
        fetchCalls += 1;
        return "999.0.0";
      },
      { PI_OFFLINE: "1" } as NodeJS.ProcessEnv,
      { runNpm: noPolicyRunner },
    );

    expect(fetchCalls).toBe(0);
    expect(status.freshness).toBe("unknown");
    expect(status.checkSkipped).toBe(true);
    expect(status.skipReason).toBe("offline");
  });

  it("treats the policy-visible latest as current when npm cooldown filters absolute latest", async () => {
    const installed = getInstalledPiVersion() ?? "0.75.1";
    const cutoff = "2026-05-19T00:00:00.000Z";
    const runNpm: NpmPolicyCommandFn = async (args) => {
      if (args.join(" ") === "config get before") return cutoff;
      if (args[0] === "config") return "null";
      if (args.join(" ") === "view @earendil-works/pi-coding-agent time --json") {
        return JSON.stringify({
          [installed]: "2026-05-18T00:00:00.000Z",
          "999.0.0": "2026-05-20T00:00:00.000Z",
        });
      }
      return undefined;
    };

    const status = await detectPiReleaseStatus(async () => "999.0.0", {} as NodeJS.ProcessEnv, {
      runNpm,
    });

    expect(status.freshness).toBe("latest");
    expect(status.latestVersion).toBe(installed);
    expect(status.absoluteLatestVersion).toBe("999.0.0");
    expect(status.policyVisibleLatestVersion).toBe(installed);
    expect(status.cooldownActive).toBe(true);
  });

  it("reports an update when npm cooldown allows a newer version than installed", async () => {
    const installed = getInstalledPiVersion() ?? "0.75.1";
    const cutoff = "2026-05-21T00:00:00.000Z";
    const runNpm: NpmPolicyCommandFn = async (args) => {
      if (args.join(" ") === "config get before") return cutoff;
      if (args[0] === "config") return "null";
      if (args.join(" ") === "view @earendil-works/pi-coding-agent time --json") {
        return JSON.stringify({
          [installed]: "2026-05-18T00:00:00.000Z",
          "999.0.0": "2026-05-20T00:00:00.000Z",
        });
      }
      return undefined;
    };

    const status = await detectPiReleaseStatus(async () => "999.0.0", {} as NodeJS.ProcessEnv, {
      runNpm,
    });

    expect(status.freshness).toBe("update-available");
    expect(status.latestVersion).toBe("999.0.0");
    expect(status.cooldownActive).toBe(false);
  });

  it("degrades to unknown when npm cooldown is detected but policy-visible latest cannot be computed", async () => {
    const runNpm: NpmPolicyCommandFn = async (args) => {
      if (args.join(" ") === "config get before") return "2026-05-19T00:00:00.000Z";
      if (args[0] === "config") return "null";
      return undefined;
    };

    const status = await detectPiReleaseStatus(async () => "999.0.0", {} as NodeJS.ProcessEnv, {
      runNpm,
    });

    expect(status.freshness).toBe("unknown");
    expect(status.latestVersion).toBeUndefined();
    expect(status.absoluteLatestVersion).toBe("999.0.0");
    expect(status.cooldownActive).toBeUndefined();
  });
});
