/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { parseSoql } from "../lib/parser.ts";
import { validateQuerySemantics } from "../lib/query-semantics.ts";

const findings = (query: string) =>
  validateQuerySemantics(parseSoql(query, { apiVersion: 68, context: "api" }));

describe("sf-soql query semantic validation", () => {
  it.each([
    ["Aggregate Limit", "SELECT MAX(CreatedDate) FROM Account LIMIT 1"],
    ["convertTimezone", "SELECT convertTimezone(CreatedDate) FROM Opportunity LIMIT 1"],
    [
      "Date Function Literal",
      "SELECT CreatedDate FROM Opportunity WHERE CALENDAR_YEAR(CreatedDate) = THIS_YEAR LIMIT 1",
    ],
    [
      "Date Function Grouping",
      "SELECT CALENDAR_YEAR(CreatedDate), Amount FROM Opportunity LIMIT 1",
    ],
  ])("blocks documented semantic restriction %s", (label, query) => {
    expect(findings(query)).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", label })]),
    );
  });

  it.each([
    "SELECT MAX(CreatedDate) FROM Account",
    "SELECT HOUR_IN_DAY(convertTimezone(CreatedDate)), SUM(Amount) FROM Opportunity GROUP BY HOUR_IN_DAY(convertTimezone(CreatedDate))",
    "SELECT CALENDAR_YEAR(CreatedDate), SUM(Amount) FROM Opportunity GROUP BY CALENDAR_YEAR(CreatedDate)",
    "SELECT CreatedDate, Amount FROM Opportunity WHERE CALENDAR_YEAR(CreatedDate) = 2009 LIMIT 1",
  ])("accepts documented semantic shape: %s", (query) => {
    expect(findings(query)).toEqual([]);
  });
});
