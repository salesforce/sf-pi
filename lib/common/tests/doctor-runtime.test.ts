/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for sf-pi runtime doctor advice. */
import { describe, expect, it } from "vitest";
import { buildRuntimeUpdateAdvice } from "../doctor/diagnostics.ts";

describe("buildRuntimeUpdateAdvice", () => {
  it("includes --min-release-age=0 when npm release-age gating is configured", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.70.5",
      installedPiPackageVersion: "0.70.5",
      allPiPaths: ["/tmp/bin/pi"],
      npmMinReleaseAge: "1440",
    });

    expect(advice.join("\n")).toContain("npm min-release-age is 1440");
    expect(advice).toContain(
      "npm install -g @mariozechner/pi-coding-agent@latest --force --min-release-age=0",
    );
  });

  it("keeps the normal install command when npm release-age gating is not configured", () => {
    const advice = buildRuntimeUpdateAdvice({
      piVersion: "0.70.5",
      installedPiPackageVersion: "0.70.5",
      allPiPaths: ["/tmp/bin/pi"],
    });

    expect(advice).toContain("npm install -g @mariozechner/pi-coding-agent@latest --force");
    expect(advice.join("\n")).not.toContain("--min-release-age=0");
  });
});
