/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { parseSoql, stripAllRows, toCountQuery, withLimit } from "../lib/parser.ts";

describe("sf-soql parser", () => {
  it("extracts header comments, top-level fields, object, subqueries, and limit", () => {
    const shape = parseSoql(
      `// sample\nSELECT Id, Name, Owner.Name, (SELECT Id, Email FROM Contacts) FROM Account LIMIT 10`,
    );
    expect(shape.header_comments).toContain("sample");
    expect(shape.primary_object).toBe("Account");
    expect(shape.fields).toEqual(["Id", "Name", "Owner.Name"]);
    expect(shape.relationships).toEqual(["Owner"]);
    expect(shape.subqueries).toEqual([{ relationship: "Contacts", fields: ["Id", "Email"] }]);
    expect(shape.limit).toBe(10);
  });

  it("extracts filter, sort, group, aggregate, and literal fields", () => {
    const shape = parseSoql(
      "SELECT OwnerId, COUNT(Id) total FROM Account WHERE Type = 'Customer' AND Name LIKE '%Acme%' GROUP BY OwnerId ORDER BY OwnerId LIMIT 10",
    );
    expect(shape.where_fields).toEqual(["Type", "Name"]);
    expect(shape.literal_filters).toEqual([
      { field: "Type", operator: "=", value: "Customer" },
      { field: "Name", operator: "LIKE", value: "%Acme%" },
    ]);
    expect(shape.group_by_fields).toEqual(["OwnerId"]);
    expect(shape.order_by_fields).toEqual(["OwnerId"]);
    expect(shape.aggregate_fields).toEqual([{ fn: "COUNT", field: "Id" }]);
    expect(shape.aliases).toEqual(["total"]);
  });

  it("extracts HAVING, bind variables, and TYPEOF clauses", () => {
    const shape = parseSoql(
      "SELECT TYPEOF What WHEN Account THEN Name END, COUNT(Id) total FROM Task WHERE OwnerId = :currentUserId GROUP BY WhatId HAVING COUNT(Id) > 1 ORDER BY total LIMIT 10",
    );
    expect(shape.bind_variables).toEqual(["currentUserId"]);
    expect(shape.type_of_fields).toHaveLength(1);
    expect(shape.fields).toEqual(["TYPEOF What WHEN Account THEN Name END", "COUNT(Id) total"]);
    expect(shape.having_fields).toEqual(["Id"]);
    expect(shape.order_by_fields).toEqual(["total"]);
    expect(shape.aliases).toEqual(["total"]);
  });

  it("normalizes trailing ALL ROWS", () => {
    expect(stripAllRows("SELECT Id FROM Account ALL ROWS")).toEqual({
      soql: "SELECT Id FROM Account",
      allRows: true,
    });
  });

  it("adds or lowers LIMIT for samples", () => {
    expect(withLimit("SELECT Id FROM Account", 25)).toBe("SELECT Id FROM Account LIMIT 25");
    expect(withLimit("SELECT Id FROM Account LIMIT 100", 25)).toBe(
      "SELECT Id FROM Account LIMIT 25",
    );
  });

  it("builds a count query from a filtered query", () => {
    expect(
      toCountQuery("SELECT Id, Name FROM Account WHERE Name LIKE 'A%' ORDER BY Name LIMIT 10"),
    ).toBe("SELECT COUNT() FROM Account WHERE Name LIKE 'A%'");
  });
});
