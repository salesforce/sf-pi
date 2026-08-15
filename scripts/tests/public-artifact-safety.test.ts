/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  parseTrackedPublicTextFiles,
  scanPublicArtifactTexts,
} from "../lib/public-artifact-safety.mjs";

describe("tracked public artifact safety", () => {
  it("selects tracked public text formats without admitting binary or local-only paths", () => {
    expect(
      parseTrackedPublicTextFiles(
        [
          "README.md",
          "catalog/example.json",
          ".github/workflow.yml",
          "extensions/example/index.ts",
          "scripts/check.sh",
          "assets/image.png",
          "notes/private.bin",
          "",
        ].join("\0"),
      ),
    ).toEqual([
      ".github/workflow.yml",
      "README.md",
      "catalog/example.json",
      "extensions/example/index.ts",
      "scripts/check.sh",
    ]);
  });

  it("finds private-shaped values across Markdown, JSON, YAML, and source", () => {
    const findings = scanPublicArtifactTexts([
      {
        file: "docs/example.md",
        source: `https://tenant--qa.sandbox.${"my.salesforce.com"}`,
      },
      {
        file: "catalog/example.json",
        source: JSON.stringify({ orgId: ["00D4", "A1B2C3D4E5F"].join("") }),
      },
      {
        file: ".github/example.yml",
        source: `channel: ${["C08R", "4ND0M1D"].join("")}`,
      },
      {
        file: "extensions/example.ts",
        source: `const link = "https://workspace.slack.com/${"archives"}/${["C08R", "4ND0M1D"].join(
          "",
        )}/p1";`,
      },
    ]);

    expect(findings.map((finding) => finding.id)).toEqual([
      "salesforce-sandbox-host",
      "salesforce-org-id",
      "slack-channel-id",
      "slack-permalink",
      "slack-channel-id",
    ]);
  });

  it("allows the repository's explicit generic fixture shapes", () => {
    expect(
      scanPublicArtifactTexts([
        {
          file: "fixtures.ts",
          source: [
            "https://example--dev.sandbox.my.salesforce.com",
            "https://example.slack.com/archives/C01ABCEXAMPLE/p1700000000000000",
            "C0123456789 U0123456789 C0AAA00001 U0BBB00002",
            "00D000000000000AAA 00D000000000001",
          ].join("\n"),
        },
      ]),
    ).toEqual([]);
  });
});
