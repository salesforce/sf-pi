/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { scanManualEvidenceTexts } from "../lib/manual-evidence.mjs";

const VALID = `---
evidence: manual-live-verification
as_of: 2026-07-12
owner: sf-example
revalidate_after: 2026-10-12
revalidation_trigger: Public API behavior or owning registry changes
---

# Live verification

Bounded public-safe summary.
`;

describe("manual evidence freshness", () => {
  it("accepts current evidence with an owner and revalidation contract", () => {
    expect(
      scanManualEvidenceTexts(
        [{ file: "extensions/sf-example/references/live-verification.md", source: VALID }],
        "2026-08-11",
      ),
    ).toEqual([]);
  });

  it("requires metadata on live-verification documents", () => {
    expect(
      scanManualEvidenceTexts(
        [
          {
            file: "extensions/sf-example/references/live-verification.md",
            source: "# Live verification\n",
          },
        ],
        "2026-08-11",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("frontmatter") }),
      ]),
    );
  });

  it("fails expired evidence and invalid date order", () => {
    const findings = scanManualEvidenceTexts(
      [
        {
          file: "docs/live-verification.md",
          source: VALID.replace("as_of: 2026-07-12", "as_of: 2026-11-01").replace(
            "revalidate_after: 2026-10-12",
            "revalidate_after: 2026-10-01",
          ),
        },
        {
          file: "docs/another.md",
          source: VALID.replace("revalidate_after: 2026-10-12", "revalidate_after: 2026-08-01"),
        },
      ],
      "2026-08-11",
    );

    expect(findings.map((finding: { message: string }) => finding.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must not precede as_of"),
        expect.stringContaining("requires revalidation"),
      ]),
    );
  });

  it("requires a stable public owner and revalidation trigger", () => {
    const findings = scanManualEvidenceTexts(
      [
        {
          file: "docs/manual.md",
          source: VALID.replace("owner: sf-example", "owner: ").replace(
            "revalidation_trigger: Public API behavior or owning registry changes",
            "revalidation_trigger: ",
          ),
        },
      ],
      "2026-08-11",
    );

    expect(findings.map((finding: { message: string }) => finding.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("owner"),
        expect.stringContaining("revalidation_trigger"),
      ]),
    );
  });
});
