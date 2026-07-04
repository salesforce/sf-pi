/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  docsCollectionProfilesFor,
  getDocsCollectionProfile,
  summarizeDocsCollectionProfile,
} from "../lib/collection-profiles.ts";

describe("Docs Collection Profiles", () => {
  it("describes admin release-note coverage without using seasonal releases as collection versions", () => {
    const profile = getDocsCollectionProfile("admin");

    expect(profile).toMatchObject({
      collection: "admin",
      releaseNotes:
        "Salesforce release notes are available for the latest three release-note releases.",
    });
    expect(profile?.caveats.join(" ")).toContain("Use version=current");
    expect(profile?.caveats.join(" ")).toContain("+release:<n>");
  });

  it("keeps developer and legacydeveloper reference boundaries explicit", () => {
    const developer = summarizeDocsCollectionProfile(getDocsCollectionProfile("developer")!);
    const legacy = summarizeDocsCollectionProfile(getDocsCollectionProfile("legacydeveloper")!);

    expect(developer.references).toContain("use legacydeveloper");
    expect(legacy.references).toContain("Apex Reference");
    expect(legacy.references).toContain("Metadata API");
  });

  it("returns only known profiles in requested order", () => {
    expect(
      docsCollectionProfilesFor(["developer", "unknown", "admin"]).map((p) => p.collection),
    ).toEqual(["developer", "admin"]);
  });
});
