/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { parseSourceTarget } from "../lib/source.ts";

describe("parseSourceTarget", () => {
  it("parses Apex ids", () => {
    expect(parseSourceTarget("01p000000000001AAA")).toEqual({
      raw: "01p000000000001AAA",
      id: "01p000000000001AAA",
    });
    expect(parseSourceTarget("01q000000000001AAA")).toEqual({
      raw: "01q000000000001AAA",
      id: "01q000000000001AAA",
    });
  });

  it("parses namespaced and file-style targets", () => {
    expect(parseSourceTarget("ns.ExampleService.cls")).toEqual({
      raw: "ns.ExampleService.cls",
      namespace: "ns",
      name: "ExampleService",
    });
    expect(parseSourceTarget("force-app/main/default/triggers/Example.trigger")).toEqual({
      raw: "force-app/main/default/triggers/Example.trigger",
      name: "Example",
    });
  });
});
