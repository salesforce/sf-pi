/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { buildSummaryText, cleanD360CliOutput, formatD360Output } from "../lib/truncation.ts";

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

  it("summarizes error array rows readably", () => {
    const text = buildSummaryText(
      JSON.stringify([
        {
          errorCode: "BAD_REQUEST",
          message:
            'INVALID_ARGUMENT: table "Definitely_Not_A_DMO__dlm" does not exist in the query plane',
        },
      ]),
      "/tmp/output.json",
    );

    expect(text).toContain("Shape: JSON array (1 items).");
    expect(text).toContain('BAD_REQUEST: INVALID_ARGUMENT: table "Definitely_Not_A_DMO__dlm"');
  });

  it("strips sf cli beta warning noise and keeps JSON", () => {
    const warning =
      "\u001b[1m\u001b[33mWarning:\u001b[39m\u001b[22m This command is currently in beta.\n" +
      "Any aspect of this command can change without advanced notice.\n" +
      "Don't use beta commands in your scripts.";

    expect(cleanD360CliOutput('{"ok":true}', warning)).toBe('{"ok":true}');
    expect(cleanD360CliOutput("", `${warning}\n[{"errorCode":"NOT_FOUND"}]`)).toBe(
      '[{"errorCode":"NOT_FOUND"}]',
    );
  });

  it("supports file_only output mode", async () => {
    const formatted = await formatD360Output('{"ok":true}', "file_only");

    expect(formatted.outputMode).toBe("file_only");
    expect(formatted.fullOutputPath).toBeTruthy();
    expect(formatted.text).toContain("Data 360 response saved to");
  });
});
