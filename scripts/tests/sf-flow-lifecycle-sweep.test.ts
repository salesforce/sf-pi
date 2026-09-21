/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { parseLifecycleSweepArgs } from "../e2e/sf-flow-lifecycle-sweep.ts";

describe("sf-flow lifecycle sweep", () => {
  it("requires an explicit org argument shape", () => {
    expect(parseLifecycleSweepArgs(["--org", "FlowLifecycleDev"])).toEqual({
      org: "FlowLifecycleDev",
    });
    expect(() => parseLifecycleSweepArgs(["--org"])).toThrow("--org requires");
    expect(() => parseLifecycleSweepArgs(["--runtime"])).toThrow("Unknown argument");
  });
});
