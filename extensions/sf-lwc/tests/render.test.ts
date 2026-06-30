/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { buildDigest, row, section } from "../lib/digest.ts";
import { renderLwcResultMarkdown } from "../lib/render.ts";
import { toolResultFromDigest } from "../lib/result.ts";

describe("sf-lwc renderer", () => {
  it("renders LWC result cards with local rails", () => {
    const result = toolResultFromDigest(
      buildDigest({
        action: "component.inspect",
        status: "pass",
        icon: "🧩",
        title: "LWC Component · helloWorld",
        local_rail: [{ kind: "bundle", target: "force-app/main/default/lwc/helloWorld" }],
        sections: [section("📄", "Bundle", [row("🧪", "Tests", 1)])],
        recommended_skills: ["generating-lwc-components", "uplifting-components-to-slds2"],
        recommended_tools: ["code_analyzer"],
      }),
    );

    const rendered = renderLwcResultMarkdown(result);
    expect(rendered).toContain("✅ 🧩 LWC Component · helloWorld");
    expect(rendered).toContain("Local");
    expect(rendered).toContain("force-app/main/default/lwc/helloWorld");
    expect(rendered).toContain("Bundle");
    expect(rendered).toContain("Recommended Guidance");
    expect(rendered).toContain("generating-lwc-components");
    expect(rendered).toContain("uplifting-components-to-slds2");
    expect(result.details.recommended_skills).toEqual([
      "generating-lwc-components",
      "uplifting-components-to-slds2",
    ]);
    expect(result.details.recommended_tools).toEqual(["code_analyzer"]);
  });
});
