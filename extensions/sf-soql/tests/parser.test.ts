/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { parseSoql, stripAllRows, toCountQuery, withLimit } from "../lib/parser.ts";

const parse = (query: string, context: "api" | "apex" = "api") =>
  parseSoql(query, { apiVersion: 68, context });

describe("sf-soql parser", () => {
  it("extracts header comments, top-level fields, object, subqueries, and limit", () => {
    const shape = parse(
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
    const shape = parse(
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
    const shape = parse(
      "SELECT TYPEOF What WHEN Account THEN Name END, COUNT(Id) total FROM Task WHERE OwnerId = :currentUserId GROUP BY WhatId HAVING COUNT(Id) > 1 ORDER BY total LIMIT 10",
      "apex",
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
    const shape = parse(
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
    const shape = parse(
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
    const shape = parse(
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

  it("refuses to silently redefine grouped-query count semantics", () => {
    expect(() => toCountQuery("SELECT Industry, COUNT(Id) FROM Account GROUP BY Industry")).toThrow(
      "query.count does not rewrite grouped queries",
    );
  });

  it("inserts a sample limit before trailing query modifiers", () => {
    expect(withLimit("SELECT Id FROM Account FOR VIEW", 25)).toBe(
      "SELECT Id FROM Account LIMIT 25 FOR VIEW",
    );
    expect(withLimit("SELECT Id FROM FAQ__kav UPDATE TRACKING", 25)).toBe(
      "SELECT Id FROM FAQ__kav LIMIT 25 UPDATE TRACKING",
    );
  });

  it("uses API and Apex parsing contexts for bind variables", () => {
    const apiShape = parse("SELECT Id FROM Account WHERE Name = :name LIMIT 1");
    const apexShape = parse("SELECT Id FROM Account WHERE Name = :name LIMIT 1", "apex");

    expect(apiShape.syntax_context).toBe("api");
    expect(apiShape.syntax_api_version).toBe(68);
    expect(apiShape.syntax_errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining(":") })]),
    );
    expect(apexShape.syntax_errors).toBeUndefined();
    expect(apexShape.bind_variables).toEqual(["name"]);
  });

  it("strips inline comments without treating comment markers inside strings as comments", () => {
    const shape = parse(
      "SELECT Id /* selected */ FROM Account WHERE Website = 'https://example.invalid/x' LIMIT 1",
    );

    expect(shape.syntax_errors).toBeUndefined();
    expect(shape.normalized).toBe(
      "SELECT Id                FROM Account WHERE Website = 'https://example.invalid/x' LIMIT 1",
    );
  });

  it("extracts object aliases and canonical selected-field paths", () => {
    const shape = parse("SELECT a.Id, a.Owner.Name FROM Account a LIMIT 1");

    expect(shape.object_alias).toBe("a");
    expect(shape.object_aliases).toEqual({ a: "" });
    expect(shape.selected_fields).toEqual([
      { kind: "field", raw: "a.Id", field: "Id" },
      { kind: "field", raw: "a.Owner.Name", field: "Owner.Name" },
    ]);
  });

  it("resolves chained multi-object aliases to canonical relationship paths", () => {
    const shape = parse(
      "SELECT c.Id, a.Name, o.Name FROM Contact c, c.Account a, a.Owner o WHERE a.Name != null AND o.Name != null LIMIT 1",
    );

    expect(shape.object_aliases).toEqual({ c: "", a: "Account", o: "Account.Owner" });
    expect(shape.selected_fields).toEqual([
      { kind: "field", raw: "c.Id", field: "Id" },
      { kind: "field", raw: "a.Name", field: "Account.Name" },
      { kind: "field", raw: "o.Name", field: "Account.Owner.Name" },
    ]);
    expect(shape.where_fields).toEqual(["Account.Name", "Account.Owner.Name"]);
  });

  it("recognizes current FORMULA syntax from the official SOQL grammar", () => {
    const shape = parse(
      "SELECT Id FROM Opportunity WHERE FORMULA('Amount - ExpectedRevenue') > 100 LIMIT 1",
    );

    expect(shape.syntax_errors).toBeUndefined();
    expect(shape.formula_expressions).toEqual([
      { left_field: "Amount", operator: "-", right_field: "ExpectedRevenue" },
    ]);
  });

  it("extracts FIELDS expansions for semantic validation", () => {
    const shape = parse("SELECT Id, FIELDS(CUSTOM) FROM Account LIMIT 200");

    expect(shape.field_expansions).toEqual(["CUSTOM"]);
    expect(shape.selected_fields).toEqual([
      { kind: "field", raw: "Id", field: "Id" },
      { kind: "fields", raw: "FIELDS(CUSTOM)", expansion: "CUSTOM" },
    ]);
  });
});
