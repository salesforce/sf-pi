/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for sf-pi runtime doctor advice. */
import { describe, expect, it } from "vitest";
import { buildRuntimeUpdateAdvice } from "../doctor/diagnostics.ts";

describe("buildRuntimeUpdateAdvice", () => {
  it("does not recommend crossing the ceiling from a supported runtime", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.81.1",
      installedPiPackageVersion: "0.81.1",
      allPiPaths: ["/tmp/bin/pi"],
    });

    expect(advice.join("\n")).toContain("inside the audited >=0.81.1 <0.82.0 window");
    expect(advice.join("\n")).toContain("No unbounded Pi update is recommended");
    expect(advice).not.toContain("pi update --self --force");
    expect(advice.join("\n")).not.toContain("@latest");
  });

  it("directs too-new Pi runtimes to the audited supported patch", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.82.0",
      installedPiPackageVersion: "0.82.0",
      allPiPaths: ["/tmp/bin/pi"],
    });

    expect(advice[0]).toContain("supports >=0.81.1 <0.82.0");
    expect(advice).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.81.1 --force",
    );
    expect(advice).not.toContain("pi update --self --force");
    expect(advice.join("\n")).not.toContain("@latest");
  });

  it("directs too-old Pi runtimes to the audited supported patch", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.81.0",
      installedPiPackageVersion: "0.81.0",
      allPiPaths: ["/tmp/bin/pi"],
    });

    expect(advice[0]).toContain("supports >=0.81.1 <0.82.0");
    expect(advice).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.81.1 --force",
    );
    expect(advice).not.toContain("pi update --self --force");
    expect(advice.join("\n")).not.toContain("@latest");
  });

  it("keeps npm release-age policy details on the exact-version fallback", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.81.0",
      installedPiPackageVersion: "0.81.0",
      allPiPaths: ["/tmp/bin/pi"],
      npmMinReleaseAge: "1440",
    });

    expect(advice.join("\n")).toContain("npm release-age policy detected");
    expect(advice.join("\n")).toContain("min-release-age=1440");
    expect(advice[0]).toContain("Detected pi 0.81.0");
    expect(advice).not.toContain("pi update --self --force");
    expect(advice).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.81.1 --force --min-release-age=0",
    );
  });

  it("keeps npm before policy details on the exact-version fallback", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.81.0",
      installedPiPackageVersion: "0.81.0",
      allPiPaths: ["/tmp/bin/pi"],
      npmBefore: "2026-05-18T00:00:00.000Z",
    });

    expect(advice.join("\n")).toContain("before=2026-05-18T00:00:00.000Z");
    expect(advice).not.toContain("pi update --self --force");
    expect(advice).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.81.1 --force --before=null --min-release-age=0",
    );
  });
});
