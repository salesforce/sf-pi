/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { buildIssueUrl } from "../lib/github.ts";

describe("sf-feedback GitHub helpers", () => {
  it("builds a prefilled GitHub issue URL", () => {
    const url = buildIssueUrl("[Bug] Broken", "Body text", ["feedback", "bug"]);

    expect(url).toContain("https://github.com/salesforce/sf-pi/issues/new?");
    expect(url).toContain("title=%5BBug%5D+Broken");
    expect(url).toContain("body=Body+text");
    expect(url).toContain("labels=feedback%2Cbug");
  });
});
