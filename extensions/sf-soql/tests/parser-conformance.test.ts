/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { parseSoql } from "../lib/parser.ts";
import { OFFICIAL_ADVANCED_EXAMPLES } from "./fixtures/official-advanced-examples.ts";
import { OFFICIAL_FUNCTION_EXAMPLES } from "./fixtures/official-function-examples.ts";
import { OFFICIAL_SELECT_EXAMPLES } from "./fixtures/official-select-examples.ts";

interface SyntaxCase {
  name: string;
  query: string;
  context: "api" | "apex";
  valid: boolean;
}

const CURRENT_SYNTAX_CASES: SyntaxCase[] = [
  {
    name: "relationship and object aliases",
    query: "SELECT a.Id, a.Owner.Name FROM Account a LIMIT 1",
    context: "api",
    valid: true,
  },
  {
    name: "bounded field expansion",
    query: "SELECT FIELDS(ALL) FROM Account LIMIT 200",
    context: "api",
    valid: true,
  },
  {
    name: "FORMULA WHERE expression",
    query: "SELECT Id FROM Opportunity WHERE FORMULA('Amount - ExpectedRevenue') > 100",
    context: "api",
    valid: true,
  },
  {
    name: "FORMULA outside WHERE",
    query: "SELECT FORMULA('Amount - ExpectedRevenue') FROM Opportunity",
    context: "api",
    valid: false,
  },
  {
    name: "API bind variable",
    query: "SELECT Id FROM Account WHERE Name = :name",
    context: "api",
    valid: false,
  },
  {
    name: "Apex bind variable",
    query: "SELECT Id FROM Account WHERE Name = :name",
    context: "apex",
    valid: true,
  },
  {
    name: "Apex-only record lock in API context",
    query: "SELECT Id FROM Account LIMIT 1 FOR UPDATE",
    context: "api",
    valid: false,
  },
  {
    name: "inline comment",
    query: "SELECT Id /* field */ FROM Account LIMIT 1",
    context: "api",
    valid: true,
  },
  {
    name: "malformed limit",
    query: "SELECT Id FROM Account LIMIT 'many'",
    context: "api",
    valid: false,
  },
];

describe("sf-soql parser conformance", () => {
  it.each(CURRENT_SYNTAX_CASES)("classifies $name", ({ query, context, valid }) => {
    const shape = parseSoql(query, { apiVersion: 68, context });
    expect(shape.syntax_errors === undefined).toBe(valid);
  });

  it.each(OFFICIAL_SELECT_EXAMPLES)("accepts official SELECT example: %s", (query) => {
    const shape = parseSoql(query, { apiVersion: 68, context: "api" });
    expect(shape.syntax_errors).toBeUndefined();
  });

  it.each(OFFICIAL_FUNCTION_EXAMPLES)("accepts official function example: %s", (query) => {
    const shape = parseSoql(query, { apiVersion: 68, context: "api" });
    expect(shape.syntax_errors).toBeUndefined();
  });

  it.each(OFFICIAL_ADVANCED_EXAMPLES)(
    "accepts official advanced example: $query",
    ({ query, context, minApiVersion }) => {
      const shape = parseSoql(query, { apiVersion: minApiVersion ?? 68, context });
      expect(shape.syntax_errors).toBeUndefined();
    },
  );

  it("uses the supplied org API version rather than a pinned parser version", () => {
    const query = "SELECT Id FROM Opportunity WHERE FORMULA('Amount - ExpectedRevenue') > 100";
    const v66 = parseSoql(query, { apiVersion: 66, context: "api" });
    const v67 = parseSoql(query, { apiVersion: 67, context: "api" });
    const v68 = parseSoql(query, { apiVersion: 68, context: "api" });

    expect(v66.syntax_errors).toBeDefined();
    expect(v67.syntax_errors).toBeUndefined();
    expect(v68.syntax_errors).toBeUndefined();
    expect(v67.syntax_api_version).toBe(67);
    expect(v68.syntax_api_version).toBe(68);
  });
});
