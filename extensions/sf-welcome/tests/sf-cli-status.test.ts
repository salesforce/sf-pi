/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Targeted tests for the welcome-screen SF CLI status helper.
 *
 * Post-Phase-4: the latest-version lookup hits the npm registry directly
 * via `fetch` instead of shelling `npm view`. Tests stub it through the
 * `fetchLatest` parameter on `detectSfCliStatus`.
 */
import { describe, expect, it } from "vitest";
import {
  detectSfCliStatus,
  isVersionCurrent,
  parseSfCliVersion,
  type SfCliExecFn,
  type SfCliFetchLatestFn,
} from "../lib/sf-cli-status.ts";

function createExec(
  responses: Record<string, { stdout?: string; stderr?: string; code?: number | null }>,
  calls: string[] = [],
): SfCliExecFn {
  return async (command, args) => {
    const key = [command, ...args].join(" ");
    calls.push(key);
    const match = responses[key];
    if (!match) {
      throw new Error(`Unexpected command: ${key}`);
    }
    return {
      stdout: match.stdout ?? "",
      stderr: match.stderr ?? "",
      code: match.code ?? 0,
    };
  };
}

function stubFetchLatest(version: string | undefined): SfCliFetchLatestFn {
  return async () => version;
}

describe("parseSfCliVersion", () => {
  it("extracts the version from sf --version output", () => {
    expect(parseSfCliVersion("@salesforce/cli/2.132.14 darwin-arm64 node-v22\n")).toBe("2.132.14");
    expect(parseSfCliVersion("v2.132.14\n")).toBe("2.132.14");
  });
});

describe("isVersionCurrent", () => {
  it("treats equal or newer installed versions as current", () => {
    expect(isVersionCurrent("2.132.14", "2.132.14")).toBe(true);
    expect(isVersionCurrent("2.133.0", "2.132.14")).toBe(true);
    expect(isVersionCurrent("2.132.13", "2.132.14")).toBe(false);
  });
});

describe("detectSfCliStatus", () => {
  it("reports latest when installed version matches the registry", async () => {
    const status = await detectSfCliStatus(
      createExec({
        "sf --version": { stdout: "@salesforce/cli/2.132.14 darwin-arm64\n" },
      }),
      stubFetchLatest("2.132.14"),
    );

    expect(status).toEqual({
      installed: true,
      installedVersion: "2.132.14",
      latestVersion: "2.132.14",
      freshness: "latest",
      loading: false,
    });
  });

  it("reports update availability when the registry has a newer version", async () => {
    const status = await detectSfCliStatus(
      createExec({
        "sf --version": { stdout: "@salesforce/cli/2.132.14 darwin-arm64\n" },
      }),
      stubFetchLatest("2.133.0"),
    );

    expect(status.freshness).toBe("update-available");
    expect(status.latestVersion).toBe("2.133.0");
  });

  it("does not run the registry fetch when sf is missing", async () => {
    const calls: string[] = [];
    let fetchCalls = 0;
    const status = await detectSfCliStatus(
      createExec(
        {
          "sf --version": { code: 127 },
        },
        calls,
      ),
      async () => {
        fetchCalls += 1;
        return "2.133.0";
      },
    );

    expect(status).toEqual({ installed: false, freshness: "unknown", loading: false });
    expect(calls).toEqual(["sf --version"]);
    expect(fetchCalls).toBe(0);
  });

  it("skips latest check when Pi offline mode is set", async () => {
    let fetchCalls = 0;
    const status = await detectSfCliStatus(
      createExec({
        "sf --version": { stdout: "@salesforce/cli/2.132.14 darwin-arm64\n" },
      }),
      async () => {
        fetchCalls += 1;
        return "2.133.0";
      },
      { PI_OFFLINE: "1" },
    );

    expect(status).toMatchObject({
      installed: true,
      installedVersion: "2.132.14",
      freshness: "unknown",
      checkSkipped: true,
      skipReason: "offline",
      loading: false,
    });
    expect(fetchCalls).toBe(0);
  });

  it("skips latest check when Pi version checks are disabled", async () => {
    let fetchCalls = 0;
    const status = await detectSfCliStatus(
      createExec({
        "sf --version": { stdout: "@salesforce/cli/2.132.14 darwin-arm64\n" },
      }),
      async () => {
        fetchCalls += 1;
        return "2.133.0";
      },
      { PI_SKIP_VERSION_CHECK: "1" },
    );

    expect(status).toMatchObject({
      installed: true,
      freshness: "unknown",
      checkSkipped: true,
      skipReason: "version-check-disabled",
      loading: false,
    });
    expect(fetchCalls).toBe(0);
  });

  it("keeps installed status when the registry lookup fails", async () => {
    const status = await detectSfCliStatus(
      createExec({
        "sf --version": { stdout: "@salesforce/cli/2.132.14 darwin-arm64\n" },
      }),
      stubFetchLatest(undefined),
    );

    expect(status).toEqual({
      installed: true,
      installedVersion: "2.132.14",
      freshness: "unknown",
      loading: false,
    });
  });
});
