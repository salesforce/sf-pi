/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { classifySetupSnapshot } from "../lib/sf_browser_snapshot-tool.ts";

describe("Classic Setup snapshot settling", () => {
  it("treats native Lightning controls as ready even when force-aloha-page exists elsewhere", () => {
    const snapshot = [
      '- heading "External Client App Manager" [level=1, ref=e1]',
      '- button "New External Client App" [ref=e2]',
      '- columnheader "External Client App Name" [ref=e3]',
      '- rowheader "Example App" [ref=e4]',
    ].join("\n");

    expect(classifySetupSnapshot(snapshot)).toBe("native-content");
  });

  it("keeps a blank Classic shell pending until its iframe is observable", () => {
    const snapshot = [
      '- heading "Session Settings" [level=1, ref=e1]',
      '- treeitem "Session Settings" [selected, ref=e2]',
    ].join("\n");

    expect(classifySetupSnapshot(snapshot)).toBe("empty");
  });

  it("stops settling as soon as the Classic iframe appears", () => {
    expect(
      classifySetupSnapshot(
        '- heading "Session Settings" [level=1, ref=e1]\n- Iframe "Session Settings" [ref=e2]',
      ),
    ).toBe("iframe");
  });
});
