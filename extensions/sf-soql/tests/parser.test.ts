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
    expect(shape.subqueries?.[0]).toMatchObject({
      relationship: "Contacts",
      fields: ["Id", "Email"],
    });
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
    expect(shape.type_of_clauses).toEqual([
      { relationship: "What", when: [{ object: "Account", fields: ["Name"] }] },
    ]);
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

  it("lowers only the top-level LIMIT when child subqueries also have limits", () => {
    expect(
      withLimit("SELECT Id, (SELECT Id FROM Contacts LIMIT 50) FROM Account LIMIT 100", 5),
    ).toBe("SELECT Id, (SELECT Id FROM Contacts LIMIT 50) FROM Account LIMIT 5");
  });

  it("extracts child-subquery clauses for recursive validation", () => {
    const shape = parseSoql(
      "SELECT Id, (SELECT Id, Owner.Name FROM Contacts WHERE Missing__c = true ORDER BY BuyerAttributes LIMIT 2) FROM Account LIMIT 1",
    );
    const subquery = shape.subqueries?.[0];
    expect(subquery).toMatchObject({
      relationship: "Contacts",
      fields: ["Id", "Owner.Name"],
      where_fields: ["Missing__c"],
      order_by_fields: ["BuyerAttributes"],
      limit: 2,
    });
  });

  it("extracts fields nested inside date and distance functions", () => {
    const shape = parseSoql(
      "SELECT CALENDAR_YEAR(CreatedDate) yearValue FROM Account WHERE CALENDAR_YEAR(CreatedDate) = 2026 AND DISTANCE(Location__c, GEOLOCATION(37.0, -122.0), 'mi') < 10 GROUP BY CALENDAR_YEAR(CreatedDate) LIMIT 5",
    );
    expect(shape.function_fields).toEqual(
      expect.arrayContaining([
        { function: "CALENDAR_YEAR", field: "CreatedDate", context: "select" },
        { function: "CALENDAR_YEAR", field: "CreatedDate", context: "where" },
        { function: "DISTANCE", field: "Location__c", context: "where" },
        { function: "CALENDAR_YEAR", field: "CreatedDate", context: "group_by" },
      ]),
    );
    expect(shape.where_fields).toEqual([]);
    expect(shape.group_by_fields).toEqual([]);
  });

  it("separates semi-join fields from the outer WHERE clause", () => {
    const shape = parseSoql(
      "SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Contact WHERE Email != null) AND Type != null LIMIT 5",
    );
    expect(shape.where_fields).toEqual(["Id", "Type"]);
    expect(shape.semi_joins?.[0]).toMatchObject({
      outer_field: "Id",
      object: "Contact",
      fields: ["AccountId"],
      where_fields: ["Email"],
    });
  });

  it("builds a count query from a filtered query", () => {
    expect(
      toCountQuery("SELECT Id, Name FROM Account WHERE Name LIKE 'A%' ORDER BY Name LIMIT 10"),
    ).toBe("SELECT COUNT() FROM Account WHERE Name LIKE 'A%'");
  });
});
