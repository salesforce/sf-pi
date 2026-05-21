/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for /sf-browser evidence report formatting. */
import { describe, expect, it } from "vitest";
import { formatCaptureLines } from "../lib/evidence-report.ts";

const CAPTURE = {
  id: 3,
  label: "after-enable-feature",
  path: "/tmp/evidence/000003-after-enable-feature.png",
  thumbnailPath: "/tmp/evidence/000003-after-enable-feature.thumb.jpg",
  createdAt: "2026-05-21T01:15:05.814Z",
  imageMode: "artifact" as const,
  includedImage: false,
  url: "https://example.my.salesforce-setup.com/lightning/setup/Example/home",
};

describe("evidence report", () => {
  it("formats capture rows with audit status", () => {
    const lines = formatCaptureLines({
      ...CAPTURE,
      setupAuditTrail: {
        status: "queried",
        targetOrg: "dev",
        lookbackMinutes: 5,
        rowCount: 2,
        rows: [],
      },
    });

    expect(lines).toContain("- #3 after-enable-feature");
    expect(lines).toContain("  Setup Audit Trail: queried, 2 row(s)");
    expect(lines).toContain("  Path: /tmp/evidence/000003-after-enable-feature.png");
  });

  it("omits audit status when audit enrichment was not requested", () => {
    const lines = formatCaptureLines(CAPTURE);

    expect(lines.join("\n")).not.toContain("Setup Audit Trail");
  });
});
