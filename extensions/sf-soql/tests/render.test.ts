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

  it("includes bounded row previews and artifact paths in tool text", () => {
    const result = toolResultFromDigest(
      buildDigest({
        action: "query.run",
        status: "pass",
        icon: "⚡",
        title: "SOQL Run · MessagingSession",
        query: { normalized: "SELECT Id, Name FROM MessagingSession LIMIT 2" },
        result: {
          rows_returned: 2,
          columns: ["Id", "Name"],
          sample_rows: [
            { Id: "0Mw1", Name: "MS-1" },
            { Id: "0Mw2", Name: "MS-2" },
          ],
        },
        artifacts: [{ kind: "raw", path: "/tmp/result.raw.json" }],
        sections: [],
      }),
    );

    expect(result.content[0]?.text).toContain("Row Preview:");
    expect(result.content[0]?.text).toContain("| Id | Name |");
    expect(result.content[0]?.text).toContain("MS-1");
    expect(result.content[0]?.text).toContain("Artifacts:");
    expect(result.content[0]?.text).toContain("/tmp/result.raw.json");
  });

  it("includes schema field previews in tool text", () => {
    const result = toolResultFromDigest(
      buildDigest({
        action: "schema.describe",
        status: "pass",
        icon: "🧬",
        title: "SOQL Schema · ConversationEntry",
        schema_preview: {
          total_fields: 11,
          fields: [
            { name: "Id", type: "id", filterable: true, sortable: true },
            { name: "Message", type: "textarea", filterable: false, sortable: false },
          ],
        },
        artifacts: [{ kind: "schema-describe", path: "/tmp/schema.json" }],
        sections: [],
      }),
    );

    expect(result.content[0]?.text).toContain("Field Preview:");
    expect(result.content[0]?.text).toContain("| Id | id | yes | yes |");
    expect(result.content[0]?.text).toContain("+9 more fields in artifacts/details.");
    expect(result.content[0]?.text).toContain("Schema Describe: /tmp/schema.json");
  });

  it("includes bounded validation findings in tool text", () => {
    const result = toolResultFromDigest(
      buildDigest({
        action: "query.validate",
        status: "fail",
        icon: "🛡️",
        title: "SOQL Validation · ConversationEntry",
        validation: {
          verdict: "invalid",
          findings: [
            {
              severity: "error",
              icon: "❌",
              label: "Field",
              message: "Message is not filterable.",
            },
            { severity: "info", icon: "ℹ️", label: "Parser", message: "Parsed successfully." },
          ],
        },
        sections: [],
      }),
    );

    expect(result.content[0]?.text).toContain("Findings:");
    expect(result.content[0]?.text).toContain("[error] Field: Message is not filterable.");
    expect(result.content[0]?.text).not.toContain("Parsed successfully");
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
