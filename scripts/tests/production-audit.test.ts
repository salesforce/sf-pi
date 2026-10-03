/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { evaluateAuditReport } from "../check-production-audit.mjs";

const allowlist = [
  {
    id: "GHSA-vfj7-8cjw-p6xm",
    packageName: "braces",
    expiresOn: "2026-11-02",
    reason: "No patched release is available.",
  },
];

function report(advisoryId = "GHSA-vfj7-8cjw-p6xm") {
  return {
    vulnerabilities: {
      parent: { severity: "high", via: ["leaf"] },
      leaf: {
        severity: "high",
        via: [
          {
            source: 1,
            name: "braces",
            severity: "high",
            url: `https://github.com/advisories/${advisoryId}`,
          },
        ],
      },
    },
  };
}

describe("production audit policy", () => {
  it("accepts only an active exact advisory exception through transitive parents", () => {
    const result = evaluateAuditReport(report(), allowlist, new Date("2026-10-03T00:00:00Z"));

    expect(result).toMatchObject({ ok: true, unresolved: [], stale: [] });
    expect(result.allowed).toEqual(["GHSA-vfj7-8cjw-p6xm"]);
  });

  it("rejects a different high-severity advisory", () => {
    const result = evaluateAuditReport(
      report("GHSA-xxxx-yyyy-zzzz"),
      allowlist,
      new Date("2026-10-03T00:00:00Z"),
    );

    expect(result.ok).toBe(false);
    expect(result.unresolved[0]).toMatchObject({ id: "GHSA-xxxx-yyyy-zzzz" });
  });

  it("rejects expired and stale exceptions", () => {
    const expired = evaluateAuditReport(report(), allowlist, new Date("2026-11-03T00:00:00Z"));
    expect(expired.ok).toBe(false);
    expect(expired.unresolved[0]?.reason).toContain("expired");

    const stale = evaluateAuditReport(
      { vulnerabilities: {} },
      allowlist,
      new Date("2026-10-03T00:00:00Z"),
    );
    expect(stale.ok).toBe(false);
    expect(stale.stale).toEqual(["GHSA-vfj7-8cjw-p6xm"]);
  });
});
