/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { buildSummaryText, formatD360Output } from "../lib/truncation.ts";

describe("sf-data360 output formatting", () => {
  it("summarizes top-level JSON shapes", () => {
    const text = buildSummaryText(
      JSON.stringify({
        totalSize: 2,
        dataModelObject: [
          { label: "Account", name: "ssot__Account__dlm" },
          { label: "Individual", name: "ssot__Individual__dlm" },
        ],
      }),
      "/tmp/output.json",
    );

    expect(text).toContain("Top-level keys: totalSize, dataModelObject.");
    expect(text).toContain("- dataModelObject: array (2 items)");
    expect(text).toContain("Account (ssot__Account__dlm)");
  });

  it("supports file_only output mode", async () => {
    const formatted = await formatD360Output('{"ok":true}', "file_only");

    expect(formatted.outputMode).toBe("file_only");
    expect(formatted.fullOutputPath).toBeTruthy();
    expect(formatted.text).toContain("Data 360 response saved to");
  });
});
