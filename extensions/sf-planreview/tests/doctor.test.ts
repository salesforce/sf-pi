/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import type { PlannotatorRuntimeStatus } from "../../../lib/common/plannotator-runtime.ts";
import { buildPlanReviewDoctor } from "../lib/doctor.ts";

const base: PlannotatorRuntimeStatus = {
  installed: false,
  standaloneReady: false,
  herdrReady: false,
  managedState: "missing",
  herdrState: "missing",
  loading: false,
};

describe("SF Plan Review doctor", () => {
  it("treats ordinary absence as setup guidance, not a broken install", () => {
    const report = buildPlanReviewDoctor(base);
    expect(report.extensionId).toBe("sf-planreview");
    expect(report.checks.find((check) => check.id === "planreview.runtime")?.severity).toBe("warn");
    expect(report.checks.find((check) => check.id === "planreview.standalone")?.fix).toContain(
      "/sf-planreview setup",
    );
    expect(
      buildPlanReviewDoctor(base, 2).checks.find((check) => check.id === "planreview.retention")
        ?.fix,
    ).toContain("/sf-planreview cleanup");
  });

  it("does not suggest managed setup on an unsupported platform", () => {
    const report = buildPlanReviewDoctor({ ...base, managedState: "unsupported" });
    const standalone = report.checks.find((check) => check.id === "planreview.standalone");
    expect(standalone?.title).toContain("not supported");
    expect(standalone?.fix).not.toContain("/sf-planreview setup");
  });

  it("reports Lite and damaged installs distinctly", () => {
    const report = buildPlanReviewDoctor({ ...base, managedState: "damaged", herdrState: "lite" });
    expect(report.checks.find((check) => check.id === "planreview.standalone")?.severity).toBe(
      "error",
    );
    expect(report.checks.find((check) => check.id === "planreview.herdr")?.severity).toBe("warn");
  });

  it("explains when standalone use depends on Herdr's bundled binary", () => {
    const report = buildPlanReviewDoctor({
      ...base,
      installed: true,
      herdrReady: true,
      herdrState: "ready",
      version: "0.9.4",
    });
    expect(report.checks.find((check) => check.id === "planreview.standalone")?.title).toContain(
      "via Herdr",
    );
  });

  it("reports a working managed runtime and Full Herdr plugin", () => {
    const report = buildPlanReviewDoctor({
      ...base,
      installed: true,
      standaloneReady: true,
      herdrReady: true,
      managedState: "verified",
      herdrState: "ready",
      version: "0.9.4",
    });
    expect(report.checks.map((check) => check.severity)).toEqual(["ok", "ok", "ok"]);
  });
});
