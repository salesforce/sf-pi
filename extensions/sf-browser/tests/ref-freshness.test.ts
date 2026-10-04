/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import type { BrowserSnapshotRefLookup } from "../../../lib/common/sf-browser-snapshot-state.ts";
import { assertFreshBrowserRefLookup } from "../lib/ref-freshness.ts";

function lookup(
  status: BrowserSnapshotRefLookup["status"],
  overrides: Partial<BrowserSnapshotRefLookup> = {},
): BrowserSnapshotRefLookup {
  return { status, ...overrides };
}

describe("SF Browser ref freshness", () => {
  it("accepts a ref from the fresh current snapshot", () => {
    expect(
      assertFreshBrowserRefLookup(
        lookup("fresh", {
          ref: { ref: "e42", role: "button", label: "Save", line: 'button "Save" ref=e42' },
          ageMs: 500,
          url: "https://example.test/lightning/setup/Example/home",
        }),
        "e42",
      ),
    ).toMatchObject({ ref: "e42", label: "Save" });
  });

  it.each([
    ["stale", "stale"],
    ["missing-session", "no current sf_browser_snapshot"],
    ["missing-ref", "was not published by the latest sf_browser_snapshot"],
  ] as const)("rejects %s refs before invoking agent-browser", (status, message) => {
    expect(() => assertFreshBrowserRefLookup(lookup(status), "e42")).toThrow(message);
  });
});
