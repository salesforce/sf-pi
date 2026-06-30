/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { clampTimeoutSeconds, discoverTests, extractTestNames, planTest } from "../lib/tests.ts";
import { makeLwcFixture } from "./helpers.ts";

describe("sf-lwc local test discovery", () => {
  it("extracts Jest test names without requiring a parser dependency", () => {
    expect(extractTestNames("it('renders', () => {}); test(\"saves\", () => {});")).toEqual([
      "renders",
      "saves",
    ]);
  });

  it("discovers colocated LWC Jest tests", async () => {
    const root = await makeLwcFixture();
    const discovery = await discoverTests(root);

    expect(discovery.testFiles).toHaveLength(1);
    expect(discovery.testFiles[0].component).toBe("helloWorld");
    expect(discovery.testFiles[0].tests).toEqual(["renders hello", "dispatches event"]);
    expect(discovery.runnable).toBe(false);
  });

  it("plans the component colocated test", async () => {
    const root = await makeLwcFixture();
    const plan = await planTest({ action: "test.plan", component: "helloWorld" }, root);

    expect(plan.selected?.component).toBe("helloWorld");
    expect(plan.reason).toContain("colocated");
  });

  it("clamps local Jest timeout bounds", () => {
    expect(clampTimeoutSeconds(undefined)).toBe(120);
    expect(clampTimeoutSeconds(0)).toBe(1);
    expect(clampTimeoutSeconds(9999)).toBe(300);
  });
});
