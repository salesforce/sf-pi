/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Targeted tests for the welcome-screen SF CLI status helper.
 */
import { describe, expect, it } from "vitest";
import {
  detectSfCliStatus,
  isVersionCurrent,
  parseSfCliVersion,
  type SfCliExecFn,
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
  it("reports latest when installed version matches npm", async () => {
    const status = await detectSfCliStatus(
      createExec({
        "sf --version": { stdout: "@salesforce/cli/2.132.14 darwin-arm64\n" },
        "npm view @salesforce/cli version": { stdout: "2.132.14\n" },
      }),
    );

    expect(status).toEqual({
      installed: true,
      installedVersion: "2.132.14",
      latestVersion: "2.132.14",
      freshness: "latest",
      loading: false,
    });
  });

  it("reports update availability when npm is newer", async () => {
    const status = await detectSfCliStatus(
      createExec({
        "sf --version": { stdout: "@salesforce/cli/2.132.14 darwin-arm64\n" },
        "npm view @salesforce/cli version": { stdout: "2.133.0\n" },
      }),
    );

    expect(status.freshness).toBe("update-available");
    expect(status.latestVersion).toBe("2.133.0");
  });

  it("does not run npm when sf is missing", async () => {
    const calls: string[] = [];
    const status = await detectSfCliStatus(
      createExec(
        {
          "sf --version": { code: 127 },
        },
        calls,
      ),
    );

    expect(status).toEqual({ installed: false, freshness: "unknown", loading: false });
    expect(calls).toEqual(["sf --version"]);
  });

  it("keeps installed status when npm latest lookup fails", async () => {
    const status = await detectSfCliStatus(
      createExec({
        "sf --version": { stdout: "@salesforce/cli/2.132.14 darwin-arm64\n" },
        "npm view @salesforce/cli version": { code: 1, stderr: "network unavailable" },
      }),
    );

    expect(status).toEqual({
      installed: true,
      installedVersion: "2.132.14",
      freshness: "unknown",
      loading: false,
    });
  });
});
