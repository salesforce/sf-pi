/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for npm release-age policy parsing. */
import { describe, expect, it } from "vitest";
import { pickPolicyVisibleVersion, resolveNpmReleaseAgePolicy } from "../npm-release-age-policy.ts";

describe("npm release-age policy", () => {
  it("prefers an explicit before cutoff", () => {
    const policy = resolveNpmReleaseAgePolicy({
      before: "2026-05-19T00:00:00.000Z",
      minReleaseAge: "3",
      now: new Date("2026-05-22T00:00:00.000Z"),
    });

    expect(policy?.source).toBe("before");
    expect(policy?.cutoff?.toISOString()).toBe("2026-05-19T00:00:00.000Z");
  });

  it("derives the cutoff from min-release-age days", () => {
    const policy = resolveNpmReleaseAgePolicy({
      minReleaseAge: "3",
      now: new Date("2026-05-22T00:00:00.000Z"),
    });

    expect(policy?.source).toBe("min-release-age");
    expect(policy?.releaseAgeDays).toBe(3);
    expect(policy?.cutoff?.toISOString()).toBe("2026-05-19T00:00:00.000Z");
  });

  it("chooses the newest version published before the cutoff", () => {
    const version = pickPolicyVisibleVersion(
      {
        "0.75.1": "2026-05-18T00:00:00.000Z",
        "0.75.2": "2026-05-19T01:00:00.000Z",
        "0.75.3": "2026-05-20T00:00:00.000Z",
        created: "2026-05-01T00:00:00.000Z",
      },
      new Date("2026-05-19T12:00:00.000Z"),
      "0.75.3",
    );

    expect(version).toBe("0.75.2");
  });
});
