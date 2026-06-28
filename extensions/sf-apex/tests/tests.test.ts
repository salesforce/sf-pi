/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { summarizeTestResults } from "../lib/tests.ts";

describe("summarizeTestResults", () => {
  it("counts passing and failing targeted test methods", () => {
    expect(
      summarizeTestResults([
        { Outcome: "Pass", MethodName: "passes" },
        { Outcome: "Fail", MethodName: "fails" },
        { Outcome: "CompileFail", MethodName: "compileFails" },
      ]),
    ).toEqual({ total: 3, passing: 1, failing: 2 });
  });
});
