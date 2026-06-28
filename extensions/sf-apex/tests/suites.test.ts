/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { suiteRows } from "../lib/suites.ts";

describe("suiteRows", () => {
  it("renders empty suite state", () => {
    expect(suiteRows([])).toEqual([{ icon: "⚪", label: "Suites", value: "none found" }]);
  });

  it("renders suite member counts when included", () => {
    expect(
      suiteRows([
        {
          id: "05F000000000001",
          name: "CoreSuite",
          members: [
            { ApexTestSuiteId: "05F000000000001", ApexClassId: "01p000000000001" },
            { ApexTestSuiteId: "05F000000000001", ApexClassId: "01p000000000002" },
          ],
        },
      ]),
    ).toEqual([{ icon: "✅", label: "CoreSuite", value: "05F000000000001 · 2 members" }]);
  });
});
