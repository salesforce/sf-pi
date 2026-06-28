/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { normalizeCoverageRows } from "../lib/coverage.ts";

describe("normalizeCoverageRows", () => {
  it("normalizes coverage rows with member names and percentages", () => {
    expect(
      normalizeCoverageRows(
        [
          {
            ApexClassOrTriggerId: "01pA",
            NumLinesCovered: 8,
            NumLinesUncovered: 2,
          },
        ],
        [{ Id: "01pA", Name: "ExampleService", type: "ApexClass" }],
      ),
    ).toEqual([
      {
        apex_id: "01pA",
        name: "ExampleService",
        type: "ApexClass",
        covered: 8,
        uncovered: 2,
        total: 10,
        pct: 80,
      },
    ]);
  });

  it("keeps line arrays only when requested", () => {
    const rows = normalizeCoverageRows(
      [
        {
          ApexClassOrTrigger: { Id: "01pB", Name: "OtherService" },
          NumLinesCovered: 1,
          NumLinesUncovered: 1,
          Coverage: { coveredLines: [1], uncoveredLines: [2] },
        },
      ],
      [],
      true,
    );

    expect(rows[0]).toMatchObject({
      apex_id: "01pB",
      name: "OtherService",
      pct: 50,
      covered_lines: [1],
      uncovered_lines: [2],
    });
  });

  it("sorts lowest coverage first", () => {
    const rows = normalizeCoverageRows([
      { ApexClassOrTriggerId: "01pHigh", NumLinesCovered: 9, NumLinesUncovered: 1 },
      { ApexClassOrTriggerId: "01pLow", NumLinesCovered: 1, NumLinesUncovered: 9 },
    ]);

    expect(rows.map((row) => row.apex_id)).toEqual(["01pLow", "01pHigh"]);
  });
});
