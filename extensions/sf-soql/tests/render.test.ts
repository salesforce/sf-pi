/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { buildDigest, row, section, toolResultFromDigest } from "../lib/digest.ts";
import { renderSoqlResultMarkdown } from "../lib/render.ts";

describe("sf-soql renderer", () => {
  it("renders SOQL result cards with API rails", () => {
    const result = toolResultFromDigest(
      buildDigest({
        action: "query.run",
        status: "pass",
        icon: "⚡",
        title: "SOQL Run · Account",
        query: { normalized: "SELECT Id, Name, Owner.Name FROM Account LIMIT 25" },
        api_calls: [{ method: "GET", path: "/query?q=SELECT...", detail: "maxRows=25" }],
        sections: [section("📦", "Result Summary", [row("📦", "Rows", 2)])],
      }),
    );
    const rendered = renderSoqlResultMarkdown(result);
    expect(rendered).toContain("✅ ⚡ SOQL Run · Account");
    expect(rendered).toContain("API");
    expect(rendered).toContain("/query?q=SELECT...");
    expect(rendered).toContain("SOQL Query");
    expect(rendered).toContain("SELECT Id, Name, Owner.Name FROM Account LIMIT 25");
    expect(rendered).toContain("Result Summary");
    expect(result.details.recommended_skills).toEqual(["querying-soql"]);
  });

  it("shows ALL ROWS in the query block for queryAll runs", () => {
    const result = toolResultFromDigest(
      buildDigest({
        action: "query.queryAll",
        status: "warning",
        icon: "🕰️",
        title: "SOQL QueryAll · Account",
        query: { normalized: "SELECT Id FROM Account LIMIT 5", operation: "queryAll" },
        sections: [section("🕰️", "Scope Warning", [row("🗑️", "Deleted rows", "included")])],
      }),
    );
    const rendered = renderSoqlResultMarkdown(result);
    expect(rendered).toContain("SELECT Id FROM Account LIMIT 5\n  ALL ROWS");
  });

  it("wraps long row labels for relationship-heavy cards", () => {
    const result = toolResultFromDigest(
      buildDigest({
        action: "schema.relationships",
        status: "pass",
        icon: "🔗",
        title: "SOQL Relationships · Example__c",
        sections: [
          section("⬇️", "Parent-to-Child", [
            row("🔹", "VeryLongRelationshipName", "VeryLongChildObject__c.Parent__c"),
          ]),
        ],
      }),
    );
    const rendered = renderSoqlResultMarkdown(result);
    expect(rendered).toContain(
      "🔹 VeryLongRelationshipName\n     VeryLongChildObject__c.Parent__c",
    );
  });
});
