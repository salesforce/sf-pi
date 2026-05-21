/* SPDX-License-Identifier: Apache-2.0 */
/** Unit checks for release freshness detectors. */
import { describe, expect, it } from "vitest";
import { detectPiReleaseStatus } from "../lib/release-status.ts";
import { getInstalledPiVersion } from "../../../lib/common/pi-compat.ts";

describe("detectPiReleaseStatus", () => {
  it("reports latest when the remote version matches the installed Pi runtime", async () => {
    const installed = getInstalledPiVersion();
    const status = await detectPiReleaseStatus(async () => installed, {} as NodeJS.ProcessEnv);

    expect(status.installedVersion).toBe(installed);
    expect(status.latestVersion).toBe(installed);
    expect(status.freshness).toBe("latest");
    expect(status.loading).toBe(false);
  });

  it("reports update availability when the latest version is newer", async () => {
    const status = await detectPiReleaseStatus(async () => "999.0.0", {} as NodeJS.ProcessEnv);

    expect(status.freshness).toBe("update-available");
    expect(status.latestVersion).toBe("999.0.0");
    expect(status.updateCommand).toBe("pi update --self");
  });

  it("respects Pi offline/version-check flags", async () => {
    let fetchCalls = 0;
    const status = await detectPiReleaseStatus(
      async () => {
        fetchCalls += 1;
        return "999.0.0";
      },
      { PI_OFFLINE: "1" } as NodeJS.ProcessEnv,
    );

    expect(fetchCalls).toBe(0);
    expect(status.freshness).toBe("unknown");
    expect(status.checkSkipped).toBe(true);
    expect(status.skipReason).toBe("offline");
  });
});
