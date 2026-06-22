/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for sf-pi runtime doctor advice. */
import { describe, expect, it } from "vitest";
import { buildRuntimeUpdateAdvice } from "../doctor/diagnostics.ts";

describe("buildRuntimeUpdateAdvice", () => {
  it("leads with the Pi-native forced self-update happy path", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.70.5",
      installedPiPackageVersion: "0.70.5",
      allPiPaths: ["/tmp/bin/pi"],
    });

    expect(advice).toContain("pi update --self --force");
    expect(advice.join("\n")).toContain(
      "If pi --version still looks old, review the diagnostics above",
    );
    expect(advice.join("\n")).not.toContain("npm install -g --ignore-scripts");
  });

  it("keeps npm release-age policy repair details behind the Pi-native happy path", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.70.5",
      installedPiPackageVersion: "0.70.5",
      allPiPaths: ["/tmp/bin/pi"],
      npmMinReleaseAge: "1440",
    });

    expect(advice.join("\n")).toContain("npm release-age policy detected");
    expect(advice.join("\n")).toContain("min-release-age=1440");
    expect(advice[0]).toContain("Detected pi 0.70.5");
    expect(advice).toContain("pi update --self --force");
    expect(advice.indexOf("pi update --self --force")).toBeLessThan(
      advice.findIndex((line) => line.includes("npm install -g --ignore-scripts")),
    );
    expect(advice).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@latest --force --min-release-age=0",
    );
  });

  it("keeps npm before policy repair details behind the Pi-native happy path", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.70.5",
      installedPiPackageVersion: "0.70.5",
      allPiPaths: ["/tmp/bin/pi"],
      npmBefore: "2026-05-18T00:00:00.000Z",
    });

    expect(advice.join("\n")).toContain("before=2026-05-18T00:00:00.000Z");
    expect(advice).toContain("pi update --self --force");
    expect(advice).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@latest --force --before=null --min-release-age=0",
    );
  });
});
