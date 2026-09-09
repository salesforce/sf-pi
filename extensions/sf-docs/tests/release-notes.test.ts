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

  it("rejects release notes that do not match the requested subject", () => {
    expect(
      evaluateReleaseNoteEvidence({
        release: "264",
        releaseNoteIntent: true,
        collection: "admin",
        subjectTokens: [
          "winter",
          "27",
          "release",
          "notes",
          "agent",
          "script",
          "agentforce",
          "language",
          "syntax",
          "updates",
        ],
        results: [
          {
            id: "ordinary-agentforce-page",
            title: "Timesheets Agent with Agentforce",
            url: "https://help.salesforce.com/s/articleView?id=xcloud.timesheets.htm&release=264&type=5",
            release: "264",
          },
          {
            id: "unrelated-release-note",
            title: "Check the Syntax of Your Steptypes JSON File",
            url: "https://help.salesforce.com/s/articleView?id=commerce.rn_steptypes.htm&release=264&type=5",
            filename: "release-notes/264-0-0/rn_steptypes.html",
            release: "264",
          },
        ],
      }),
    ).toMatchObject({ status: "irrelevant_release_note_evidence", candidates: [] });
  });

  it("returns only release-note candidates matching the requested subject", () => {
    const relevant = {
      id: "agent-script-release-note",
      title: "New and Changed Agent Script Functionality",
      url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_agentforce_script_new_changed.htm&release=264&type=5",
      filename: "release-notes/264-0-0/rn_agentforce_script_new_changed.html",
      release: "264",
    };
    expect(
      evaluateReleaseNoteEvidence({
        release: "264",
        releaseNoteIntent: true,
        collection: "admin",
        subjectTokens: ["agent", "script", "agentforce"],
        results: [
          {
            id: "unrelated-release-note",
            title: "Check the Syntax of Your Steptypes JSON File",
            url: "https://help.salesforce.com/s/articleView?id=commerce.rn_steptypes.htm&release=264&type=5",
            release: "264",
          },
          relevant,
        ],
      }),
    ).toMatchObject({ status: "ok", candidates: [relevant] });
  });

  it("keeps product numbers such as Data 360 in the release-note subject", () => {
    expect(
      evaluateReleaseNoteEvidence({
        release: "264",
        releaseNoteIntent: true,
        collection: "admin",
        subjectTokens: ["data", "360", "winter", "27", "release", "notes"],
        results: [
          {
            title: "Data Storage Changes",
            url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_data_storage.htm&release=264&type=5",
            release: "264",
          },
        ],
      }),
    ).toMatchObject({ status: "irrelevant_release_note_evidence", candidates: [] });
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
