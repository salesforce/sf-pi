/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { classifyAnonymousApex } from "../lib/anonymous.ts";

describe("classifyAnonymousApex", () => {
  it("allows read-only probes", () => {
    expect(classifyAnonymousApex("System.debug(UserInfo.getUserId());")).toEqual({
      mutating: false,
      reasons: [],
    });
  });

  it("flags DML and async work", () => {
    const risk = classifyAnonymousApex(
      "insert new Account(Name = 'Example'); System.enqueueJob(new MyJob());",
    );

    expect(risk.mutating).toBe(true);
    expect(risk.reasons).toContain("DML keyword");
    expect(risk.reasons).toContain("async enqueue");
  });
});
