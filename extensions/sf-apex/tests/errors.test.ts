/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { ambiguousTargetError, classifyApexError } from "../lib/errors.ts";

describe("classifyApexError", () => {
  it("classifies explicit ambiguous target errors", () => {
    const result = classifyApexError(ambiguousTargetError("Cannot decide"));

    expect(result.category).toBe("AMBIGUOUS_TARGET");
    expect(result.next_step).toContain("class_names");
  });

  it("classifies auth, network, timeout, not found, and tooling errors", () => {
    expect(classifyApexError(new Error("INVALID_SESSION_ID"))).toMatchObject({
      category: "AUTH",
    });
    expect(classifyApexError(new Error("ETIMEDOUT"))).toMatchObject({ category: "NETWORK" });
    expect(classifyApexError(new Error("Polling client timed out"))).toMatchObject({
      category: "TIMEOUT",
    });
    expect(classifyApexError(new Error("404 not found"))).toMatchObject({ category: "NOT_FOUND" });
    expect(classifyApexError(new Error("Something unexpected"))).toMatchObject({
      category: "TOOLING_API",
    });
  });

  it("classifies compile and runtime exception messages", () => {
    expect(classifyApexError(new Error("Compile problem: unexpected token"))).toMatchObject({
      category: "COMPILE_ERROR",
    });
    expect(
      classifyApexError(new Error("ExceptionMessage: System.NullPointerException")),
    ).toMatchObject({
      category: "RUNTIME_EXCEPTION",
    });
  });
});
