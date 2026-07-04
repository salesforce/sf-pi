/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  evaluateReleaseNoteEvidence,
  resultHasReleaseNoteMarkers,
  resultMatchesRelease,
} from "../lib/release-notes.ts";

describe("Release-Note Evidence", () => {
  it("recognizes release-note URL and article markers", () => {
    expect(
      resultHasReleaseNoteMarkers({
        title: "Sales",
        url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_sales.htm&release=260&type=5",
      }),
    ).toBe(true);
    expect(
      resultHasReleaseNoteMarkers({
        title: "Lightning Sales Console",
        url: "https://help.salesforce.com/s/articleView?id=service.console_lex_sales_intro.htm&release=260&type=5",
      }),
    ).toBe(false);
  });

  it("matches release metadata and URL release parameters", () => {
    expect(resultMatchesRelease({ release: "260.0.0" }, "260")).toBe(true);
    expect(
      resultMatchesRelease(
        { url: "https://help.salesforce.com/s/articleView?id=x.htm&release=260.0.0&type=5" },
        "260",
      ),
    ).toBe(true);
    expect(resultMatchesRelease({ release: "262" }, "260")).toBe(false);
  });

  it("reports coverage gaps for bounded release-note collections", () => {
    expect(
      evaluateReleaseNoteEvidence({
        release: "252",
        releaseNoteIntent: true,
        collection: "admin",
        results: [],
      }),
    ).toMatchObject({ status: "coverage_gap" });
  });

  it("distinguishes current docs with release metadata from release-note evidence", () => {
    expect(
      evaluateReleaseNoteEvidence({
        release: "260",
        releaseNoteIntent: true,
        collection: "admin",
        results: [
          {
            title: "Lightning Sales Console",
            url: "https://help.salesforce.com/s/articleView?id=service.console_lex_sales_intro.htm&release=260&type=5",
            release: "260",
          },
        ],
      }),
    ).toMatchObject({ status: "not_release_note_evidence" });
  });

  it("accepts matching release-note evidence", () => {
    expect(
      evaluateReleaseNoteEvidence({
        release: "260",
        releaseNoteIntent: true,
        collection: "admin",
        results: [
          {
            title: "Salesforce Spring ’26 Release Notes",
            url: "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=260&type=5",
            release: "260",
          },
        ],
      }),
    ).toMatchObject({ status: "ok" });
  });
});
