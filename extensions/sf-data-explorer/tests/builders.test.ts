/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { buildData360Sql } from "../lib/modes/data360-sql.ts";
import { buildSoql } from "../lib/modes/soql.ts";
import { buildSosl } from "../lib/modes/sosl.ts";

describe("query builders", () => {
  it("builds basic SOQL with WHERE and LIMIT", () => {
    expect(
      buildSoql({
        selectedObject: { name: "Account", label: "Account", custom: false, queryable: true },
        selectedFieldNames: ["Id", "Name"],
        whereClause: "Name LIKE 'A%'",
        limit: 25,
      }),
    ).toBe("SELECT\n  Id,\n  Name\nFROM Account\nWHERE Name LIKE 'A%'\nLIMIT 25");
  });

  it("builds simple SOSL with global LIMIT outside RETURNING object parentheses", () => {
    const sosl = buildSosl({
      selectedObject: {
        name: "Account",
        label: "Account",
        custom: false,
        queryable: true,
        searchable: true,
      },
      selectedFieldNames: ["Id", "Name"],
      whereClause: "acme",
      limit: 10,
    });
    expect(sosl).toBe("FIND {acme}\nIN ALL FIELDS\nRETURNING Account(Id, Name)\nLIMIT 10");
    expect(sosl).not.toContain("{acme LIMIT 10}");
    expect(sosl).not.toContain("Name LIMIT 10)");
  });

  it("builds Data 360 SQL and quotes unusual identifiers", () => {
    expect(
      buildData360Sql({
        selectedObject: { name: "ssot__Individual__dlm", entityType: "DMO" },
        selectedFieldNames: ["ssot__Id__c", "Full Name"],
        whereClause: "ssot__Id__c IS NOT NULL",
        limit: 5,
      }),
    ).toBe(
      'SELECT\n  ssot__Id__c,\n  "Full Name"\nFROM ssot__Individual__dlm\nWHERE ssot__Id__c IS NOT NULL\nLIMIT 5',
    );
  });
});
