/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { componentInspect, fileDiagnose, testRun } from "../lib/operations.ts";
import type { SfLwcSessionState } from "../lib/types.ts";
import { makeLwcFixture } from "./helpers.ts";

describe("sf-lwc operation recommendations", () => {
  it("recommends LWC authoring and SLDS2 uplift guidance from component style signals", async () => {
    const root = await makeLwcFixture();
    const result = await componentInspect(
      { action: "component.inspect", workspace: root, component: "helloWorld" },
      root,
    );

    expect(result.details.recommended_skills).toEqual([
      "generating-lwc-components",
      "uplifting-components-to-slds2",
    ]);
    expect(result.details.recommended_tools).toEqual(["sf_apex", "sf_soql", "code_analyzer"]);
  });

  it("recommends SLDS2 guidance for CSS diagnostics", async () => {
    const root = await makeLwcFixture();
    const result = await fileDiagnose(
      {
        action: "file.diagnose",
        workspace: root,
        file: "force-app/main/default/lwc/helloWorld/helloWorld.css",
      },
      root,
    );

    expect(result.details.recommended_skills).toEqual([
      "generating-lwc-components",
      "uplifting-components-to-slds2",
    ]);
  });

  it("recommends LWC authoring guidance for local Jest runs", async () => {
    const root = await makeLwcFixture({ withRunner: true });
    const state: SfLwcSessionState = {};
    const result = await testRun(
      { action: "test.run", workspace: root, component: "helloWorld", timeout_seconds: 10 },
      root,
      state,
    );

    expect(result.details.recommended_skills).toEqual(["generating-lwc-components"]);
  });
});
