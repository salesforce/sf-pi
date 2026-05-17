/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { renderCardCollapsed, renderCardExpanded } from "../lib/display/card.ts";
import { apiResultToCard } from "../lib/display/api-card.ts";

describe("d360_api result card", () => {
  it("summarizes query-sql scalar responses", () => {
    const card = apiResultToCard(
      JSON.stringify({
        data: [[9550]],
        metadata: [{ name: "span_count" }],
        returnedRows: 1,
        status: { completionStatus: "ResultsProduced", rowCount: 1, rowsProcessed: 9550 },
      }),
      {
        method: "POST",
        path: "/services/data/v67.0/ssot/query-sql?dataspaceName=default",
        targetOrg: "ExampleOrg",
        status: 200,
        ok: true,
        fullOutputPath: "/tmp/pi-d360-api/output.json",
      },
    );
    const rendered = renderCardCollapsed(card);

    expect(card.status).toBe("success");
    expect(rendered).toContain("🔗 Data 360 API ✅");
    expect(rendered).toContain("span_count = 9550");
    expect(rendered).toContain("📄 Full JSON: /tmp/pi-d360-api/output.json");
  });

  it("summarizes REST list responses", () => {
    const card = apiResultToCard(
      JSON.stringify({
        dataSpaces: [{ name: "default", status: "Active" }],
        totalSize: 1,
      }),
      { method: "GET", path: "/services/data/v67.0/ssot/data-spaces", status: 200, ok: true },
    );

    expect(renderCardExpanded(card)).toContain("• default — Active");
  });

  it("extracts nested query errors", () => {
    const card = apiResultToCard(
      JSON.stringify({
        errorCode: "BAD_REQUEST",
        message: JSON.stringify({
          primaryMessage: 'table "ssot__TelemetryTraceSpan__dlm" does not exist',
        }),
      }),
      { method: "POST", path: "/services/data/v66.0/ssot/query-sql", status: 500, ok: false },
    );
    const rendered = renderCardCollapsed(card);

    expect(card.status).toBe("error");
    expect(rendered).toContain("BAD_REQUEST");
    expect(rendered).toContain('table "ssot__TelemetryTraceSpan__dlm" does not exist');
  });

  it("renders dry-run requests", () => {
    const card = apiResultToCard(
      JSON.stringify({
        dryRun: true,
        method: "POST",
        path: "/services/data/v67.0/ssot/data-streams",
        body: { name: "Example" },
      }),
      { action: "dry_run", ok: true },
    );

    expect(renderCardExpanded(card)).toContain(
      "Resolved Data 360 REST request without network call.",
    );
    expect(renderCardExpanded(card)).toContain("POST /services/data/v67.0/ssot/data-streams");
  });
});
