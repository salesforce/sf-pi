/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { validateFindOnly, validateSelectOnly } from "../lib/validators.ts";

describe("query validators", () => {
  it("accepts read-only SELECT", () => {
    expect(validateSelectOnly("SELECT Id FROM Account LIMIT 1", "SOQL").ok).toBe(true);
    expect(
      validateSelectOnly(
        "/* comment */ SELECT * FROM ssot__Individual__dlm LIMIT 5",
        "Data 360 SQL",
      ).ok,
    ).toBe(true);
  });

  it("rejects non-SELECT and mutation tokens", () => {
    expect(validateSelectOnly("DELETE FROM Account", "SOQL").ok).toBe(false);
    expect(validateSelectOnly("SELECT Id FROM Account; DELETE FROM Account", "SOQL").ok).toBe(
      false,
    );
  });

  it("warns about SELECT without LIMIT", () => {
    const result = validateSelectOnly("SELECT Id FROM Account", "SOQL");
    expect(result.ok).toBe(true);
    expect(result.warnings?.[0]).toContain("no LIMIT");
  });

  it("accepts FIND-only SOSL", () => {
    expect(validateFindOnly("FIND {acme} RETURNING Account(Id, Name) LIMIT 5").ok).toBe(true);
  });

  it("rejects non-FIND SOSL", () => {
    expect(validateFindOnly("SELECT Id FROM Account").ok).toBe(false);
  });
});
