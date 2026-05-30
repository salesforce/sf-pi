/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { planAutoScanGroups } from "../lib/auto-scan-plan.ts";

describe("Auto Scan Plan", () => {
  it("groups mixed changed files by selector and identifies production ApexGuru candidates", () => {
    const plan = planAutoScanGroups([
      "force-app/main/default/classes/Foo.cls",
      "force-app/main/default/classes/Foo.cls",
      "force-app/main/default/classes/FooTest.cls",
      "force-app/main/default/lwc/foo/foo.js",
      "force-app/main/default/flows/MyFlow.flow-meta.xml",
      "notes.md",
    ]);

    expect(plan.groups).toEqual([
      {
        selector: "eslint:Recommended",
        targets: ["force-app/main/default/lwc/foo/foo.js"],
      },
      {
        selector: "flow:Recommended",
        targets: ["force-app/main/default/flows/MyFlow.flow-meta.xml"],
      },
      {
        selector: "pmd:Recommended",
        targets: [
          "force-app/main/default/classes/Foo.cls",
          "force-app/main/default/classes/FooTest.cls",
        ],
      },
    ]);
    expect(plan.apexGuruCandidates).toEqual(["force-app/main/default/classes/Foo.cls"]);
    expect(plan.skipped).toEqual(["notes.md"]);
  });
});
