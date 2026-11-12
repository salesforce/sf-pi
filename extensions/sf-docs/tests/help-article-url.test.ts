/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { indexedHelpArticleUrl, releaseFromSearchResults } from "../lib/help-article-url.ts";

const INDEXED =
  "https://help.salesforce.com/s/articleView?id=ai.sample_action_ref.htm&release=264.0.0&type=5";

describe("indexedHelpArticleUrl", () => {
  it("keeps id and type, sets release, and drops extras such as language", () => {
    expect(
      indexedHelpArticleUrl(
        "https://help.salesforce.com/s/articleView?id=ai.sample_action_ref.htm&type=5&language=en_US",
        "264.0.0",
      ),
    ).toBe(INDEXED);
    expect(
      indexedHelpArticleUrl(
        "https://help.salesforce.com/s/articleView?id=ai.sample_action_ref.htm&release=262.0.0",
        "264.0.0",
      ),
    ).toBe(INDEXED);
  });

  it("returns undefined for an already indexed URL, a non-Help URL, or a non-release value", () => {
    expect(indexedHelpArticleUrl(INDEXED, "264.0.0")).toBeUndefined();
    expect(indexedHelpArticleUrl("https://developer.salesforce.com/docs/x", "264.0.0")).toBe(
      undefined,
    );
    expect(
      indexedHelpArticleUrl("https://help.salesforce.com/s/articleView?type=5", "264.0.0"),
    ).toBeUndefined();
    expect(
      indexedHelpArticleUrl("https://help.salesforce.com/s/articleView?id=x.htm", "current"),
    ).toBeUndefined();
  });
});

describe("releaseFromSearchResults", () => {
  it("reads the release from the first Help article result", () => {
    expect(
      releaseFromSearchResults([
        { url: "https://developer.salesforce.com/docs/example" },
        {
          url: "https://help.salesforce.com/s/articleView?id=ind.other.htm&release=264.0.0&type=5",
        },
      ]),
    ).toBe("264.0.0");
  });

  it("prefers the most common release and ignores release-notes pages", () => {
    const help = (id: string, release: string) => ({
      url: `https://help.salesforce.com/s/articleView?id=${id}&release=${release}&type=5`,
    });
    expect(
      releaseFromSearchResults([
        help("release-notes.rn_one.htm", "262.0.0"),
        help("release-notes.rn_two.htm", "262.0.0"),
        help("ind.article_one.htm", "264.0.0"),
        help("release-notes.rn_three.htm", "260"),
        help("platform.article_two.htm", "264.0.0"),
      ]),
    ).toBe("264.0.0");
    expect(releaseFromSearchResults([help("release-notes.rn_one.htm", "262.0.0")])).toBe(undefined);
  });

  it("returns undefined when no result carries a release", () => {
    expect(
      releaseFromSearchResults([{ url: "https://help.salesforce.com/s/articleView?id=x.htm" }]),
    ).toBeUndefined();
    expect(releaseFromSearchResults(undefined)).toBeUndefined();
  });
});
