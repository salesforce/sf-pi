/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { buildAuthoringPlan } from "../lib/author.ts";

describe("preventive Flow authoring constraints", () => {
  it("compiles family-aware generation rules into the initial blueprint", async () => {
    const result = await buildAuthoringPlan(
      {
        action: "author.plan",
        intent: "When an account is updated, update a related record after save",
        flow_type: "record-triggered",
        trigger_timing: "after-save",
        record_event: "update",
        object: "Account",
      },
      process.cwd(),
    );
    const constraints = result.details.generation_constraints as Array<{ rule_id: string }>;
    const ids = constraints.map((constraint) => constraint.rule_id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "missing-record-trigger-filter",
        "recursive-record-update",
        "dml-in-loop",
        "hardcoded-id",
      ]),
    );

    const digest = result.details.digest as {
      sections: Array<{ title: string; rows: Array<{ label: string; value: string }> }>;
    };
    const overview = digest.sections.find((section) => section.title === "Generation Guardrails");
    const displayed = digest.sections
      .filter((section) => section.title.endsWith("Guardrails") && section !== overview)
      .flatMap((section) => section.rows.map((entry) => entry.label));

    expect(overview?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Applicable", value: String(constraints.length) }),
        expect.objectContaining({
          label: "Displayed",
          value: `${constraints.length} of ${constraints.length}`,
        }),
        expect.objectContaining({
          label: "Meaning",
          value: expect.stringContaining("not detected violations"),
        }),
      ]),
    );
    expect(displayed.sort()).toEqual(ids.sort());
    expect(overview).toBeDefined();
  });
});
