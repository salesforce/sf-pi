/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for sf-pi runtime doctor advice. */
import { describe, expect, it } from "vitest";
import { buildRuntimeUpdateAdvice } from "../doctor/diagnostics.ts";

describe("buildRuntimeUpdateAdvice", () => {
  it("reports the exact audited runtime without blocking future stable updates", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.82.0",
      installedPiPackageVersion: "0.82.0",
      allPiPaths: ["/tmp/bin/pi"],
    });

    expect(advice.join("\n")).toContain("inside the audited >=0.82.0 <0.85.0 window");
    expect(advice.join("\n")).toContain("newer stable pre-1.0 releases");
    expect(advice.join("\n")).not.toContain("No unbounded Pi update is recommended");
    expect(advice.join("\n")).not.toContain("npm install -g");
  });

  it("loads a newer stable Pi without recommending a downgrade", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.85.0",
      installedPiPackageVersion: "0.85.0",
      allPiPaths: ["/tmp/bin/pi"],
    });

    expect(advice.join("\n")).toContain("forward-compatibility mode");
    expect(advice.join("\n")).toContain("No downgrade is recommended");
    expect(advice.join("\n")).not.toContain("npm install -g");
  });

  it("directs a Pi major version to the audited stable patch", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "1.0.0",
      installedPiPackageVersion: "1.0.0",
      allPiPaths: ["/tmp/bin/pi"],
    });

    expect(advice[0]).toContain("loads stable Pi >=0.82.0 <1.0.0");
    expect(advice).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.2 --force",
    );
  });

  it("directs a prerelease to the audited stable patch", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.85.0-rc.1",
      installedPiPackageVersion: "0.85.0-rc.1",
      allPiPaths: ["/tmp/bin/pi"],
    });

    expect(advice[0]).toContain("loads stable Pi >=0.82.0 <1.0.0");
    expect(advice).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.2 --force",
    );
  });

  it("directs too-old Pi runtimes to the audited stable patch", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.81.0",
      installedPiPackageVersion: "0.81.0",
      allPiPaths: ["/tmp/bin/pi"],
    });

    expect(advice[0]).toContain("loads stable Pi >=0.82.0 <1.0.0");
    expect(advice).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.2 --force",
    );
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
    expect(advice).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.2 --force --min-release-age=0",
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
    expect(advice).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.2 --force --before=null --min-release-age=0",
    );
  });
});
