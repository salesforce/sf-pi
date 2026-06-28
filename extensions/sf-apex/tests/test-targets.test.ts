/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { parseClassTarget, parseTestTarget } from "../lib/test-targets.ts";

describe("Apex test target parsing", () => {
  const namespaces = new Set(["ns"]);

  it("parses class names and class ids", () => {
    expect(parseClassTarget("ExampleTest")).toEqual({ className: "ExampleTest" });
    expect(parseClassTarget("ns.ExampleTest")).toEqual({
      className: "ns.ExampleTest",
    });
    expect(parseClassTarget("01p000000000001AAA")).toEqual({
      classId: "01p000000000001AAA",
    });
  });

  it("parses class-method and namespaced class-method targets", () => {
    expect(parseTestTarget("ExampleTest.shouldPass", namespaces)).toEqual({
      className: "ExampleTest",
      methodName: "shouldPass",
    });
    expect(parseTestTarget("ns.ExampleTest.shouldPass", namespaces)).toEqual({
      className: "ns.ExampleTest",
      methodName: "shouldPass",
    });
  });

  it("treats known namespace two-part test input as a whole namespaced class", () => {
    expect(parseTestTarget("ns.ExampleTest", namespaces)).toEqual({
      className: "ns.ExampleTest",
    });
  });

  it("rejects unsupported ambiguous shapes", () => {
    expect(() => parseTestTarget("a.b.c.d", namespaces)).toThrow(/Unsupported Apex test target/);
    expect(() => parseClassTarget("a.b.c")).toThrow(/Unsupported Apex class target/);
  });
});
