/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for Salesforce record-id URL normalization. */
import { describe, expect, it } from "vitest";
import { salesforce15CharId } from "../salesforce-id.ts";

describe("salesforce15CharId", () => {
  it("keeps 15-character ids and strips the 18-character checksum suffix", () => {
    expect(salesforce15CharId("0xI000000000001")).toBe("0xI000000000001");
    expect(salesforce15CharId("0xI000000000001AAA")).toBe("0xI000000000001");
  });

  it("refuses malformed ids", () => {
    expect(() => salesforce15CharId("not-an-id")).toThrow("15 or 18 character Salesforce id");
  });
});
