/* SPDX-License-Identifier: Apache-2.0 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { flowFailureHint } from "../lib/failure-hints.ts";
import { createRepairLoopState } from "../lib/repair-loop.ts";
import { validateFlowCheck, type FlowValidationAdapter } from "../lib/validation.ts";

const flowFile = path.join(
  import.meta.dirname,
  "fixtures",
  "Record_Triggered_Example.flow-meta.xml",
);

const draftOnlyFile = path.join(
  import.meta.dirname,
  "fixtures",
  "Catalog_Picker_Draft_Only.flow-meta.xml",
);

const artifacts = {
  writeArtifact: async (kind: string, filename: string) => ({ path: `/tmp/${filename}`, kind }),
};

function passing(id = "0Af000000000001") {
  return { id, success: true, status: "Succeeded", component_failures: [], raw: { success: true } };
}

function failing(problem: string, id = "0Af000000000009") {
  return {
    id,
    success: false,
    status: "Failed",
    component_failures: [{ problem }],
    raw: { success: false },
  };
}

/** Simulates the platform: Draft source validates; Active-staged source reports one error. */
function draftOnlyAdapter(activationProblem: string): FlowValidationAdapter["run"] {
  return vi
    .fn<FlowValidationAdapter["run"]>()
    .mockImplementation(async (input) =>
      input.source.includes("<status>Active</status>") ? failing(activationProblem) : passing(),
    );
}

describe("SF Flow check-only validation", () => {
  it("validates the exact file and an Active-staged copy without changing the file", async () => {
    const before = await readFile(flowFile, "utf8");
    const run = vi.fn<FlowValidationAdapter["run"]>().mockResolvedValue(passing());

    const result = await validateFlowCheck(
      { action: "validate.check", file: flowFile, target_org: "sandbox" },
      process.cwd(),
      {} as never,
      { adapter: { run }, ...artifacts },
    );

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      check_only: true,
      file: flowFile,
      source: before,
    });
    expect(run.mock.calls[1]?.[0].source).toContain("<status>Active</status>");
    expect(await readFile(flowFile, "utf8")).toBe(before);
    expect(result.details).toMatchObject({
      ok: true,
      check_only: true,
      deployment_performed: false,
      activation_ready: true,
    });
  });

  it("refuses a Draft-only pass and returns the activation-lane error with a repair hint", async () => {
    const result = await validateFlowCheck(
      { action: "validate.check", file: draftOnlyFile, target_org: "sandbox" },
      process.cwd(),
      {} as never,
      {
        adapter: {
          run: draftOnlyAdapter(
            'Error in Catalog_Picker_Draft_Only - field integrity exception: unknown (We can\'t find this input attribute: "objectName".)',
          ),
        },
        ...artifacts,
      },
    );

    expect(result.details).toMatchObject({ ok: false, activation_ready: false });
    expect(result.details.lanes).toMatchObject([
      { lane: "draft", status: "passed" },
      {
        lane: "activation",
        status: "failed",
        failures: [{ rule_id: "screen-component-contract" }],
      },
    ]);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("draft-ok · not activation-ready");
    expect(text).toContain("objectName");
  });

  it("skips the activation lane when the Draft lane already fails", async () => {
    const run = vi
      .fn<FlowValidationAdapter["run"]>()
      .mockResolvedValue(failing("Invalid reference"));
    const result = await validateFlowCheck(
      { action: "validate.check", file: flowFile, target_org: "sandbox" },
      process.cwd(),
      {} as never,
      { adapter: { run }, ...artifacts },
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.details.ok).toBe(false);
    expect(result.content[0]?.text).toContain("Invalid reference");
    expect(result.details.lanes).toMatchObject([
      { lane: "draft", status: "failed" },
      { lane: "activation", status: "skipped" },
    ]);
  });

  it("stops the validation repair loop when the same platform failure repeats", async () => {
    const repairState = createRepairLoopState();
    const dependencies = {
      adapter: { run: draftOnlyAdapter("The mapping from recordId isn't supported.") },
      repairState,
      ...artifacts,
    };
    const params = {
      action: "validate.check" as const,
      file: draftOnlyFile,
      target_org: "sandbox",
    };

    const first = await validateFlowCheck(params, process.cwd(), {} as never, dependencies);
    const second = await validateFlowCheck(params, process.cwd(), {} as never, dependencies);

    expect(first.details.repair_loop).toMatchObject({
      status: "continue",
      round: 1,
      max_rounds: 8,
    });
    expect(second.details.repair_loop).toMatchObject({
      status: "stopped",
      reason: "repeated-signature",
    });
    expect(second.content[0]?.text).toContain("Repair budget stopped");
  });

  it("advances the repair loop while each round reports a new failure", async () => {
    const repairState = createRepairLoopState();
    const problems = [
      'A required input parameter is missing: "minRowSelection"',
      'We can\'t find this input attribute: "isRequired".',
    ];
    let index = 0;
    const run = vi
      .fn<FlowValidationAdapter["run"]>()
      .mockImplementation(async (input) =>
        input.source.includes("<status>Active</status>") ? failing(problems[index++]!) : passing(),
      );
    const params = {
      action: "validate.check" as const,
      file: draftOnlyFile,
      target_org: "sandbox",
    };

    await validateFlowCheck(params, process.cwd(), {} as never, {
      adapter: { run },
      repairState,
      ...artifacts,
    });
    const second = await validateFlowCheck(params, process.cwd(), {} as never, {
      adapter: { run },
      repairState,
      ...artifacts,
    });

    expect(second.details.repair_loop).toMatchObject({ status: "continue", round: 2 });
  });
});

describe("SF Flow Builder readiness", () => {
  const builderReadyFile = path.join(
    import.meta.dirname,
    "fixtures",
    "shape",
    "Catalog_Picker_Builder_Ready.flow-meta.xml",
  );

  it("reports builder-ready only when both lanes pass with no high local findings", async () => {
    const run = vi.fn<FlowValidationAdapter["run"]>().mockResolvedValue(passing());
    const result = await validateFlowCheck(
      { action: "validate.check", file: builderReadyFile, target_org: "sandbox" },
      process.cwd(),
      {} as never,
      { adapter: { run }, ...artifacts },
    );
    expect(result.details).toMatchObject({
      ok: true,
      activation_ready: true,
      builder_ready: true,
      local_high_findings: 0,
    });
    expect(result.content[0]?.text).toContain("builder-ready");
  });

  it("refuses green when only Builder-reported local findings remain", async () => {
    const run = vi.fn<FlowValidationAdapter["run"]>().mockResolvedValue(passing());
    const result = await validateFlowCheck(
      { action: "validate.check", file: draftOnlyFile, target_org: "sandbox" },
      process.cwd(),
      {} as never,
      { adapter: { run }, ...artifacts },
    );
    expect(result.details).toMatchObject({
      ok: false,
      activation_ready: true,
      builder_ready: false,
    });
    expect(result.details.local_high_findings).toBeGreaterThan(0);
    expect(result.content[0]?.text).toContain("activation-ready · local high findings");
  });
});

describe("Flow failure hints", () => {
  it.each([
    ["Screen component 'Table' is missing a type mapping 'T'.", "screen-component-contract"],
    ['A required input parameter is missing: "selectionMode"', "screen-component-contract"],
    [
      'The input parameter "Data" can accept multiple values, so the assigned value must be a flow variable with the isCollection property set to true.',
      "collection-scalar-mismatch",
    ],
    [
      "The mapping from “recordId” to “OpportunityLineItem[$EachItem].OpportunityId” isn’t supported. Map to a target field that references an equal or greater number of collections as the source field.",
      "transform-scalar-into-collection",
    ],
    [
      "In an Assignment element, “Sort_Items” isn’t a valid reference for the value.",
      "invalid-reference",
    ],
    ['The data type of "Family_Choices" can\'t be "String".', "choice-set-datatype"],
    [
      'The field "null__NotFound" for the object "PricebookEntry" doesn\'t exist.',
      "record-field-path",
    ],
    ['The field "Amount__x" for the object "PricebookEntry" doesn\'t exist.', "unknown-field"],
    ['A condition doesn\'t support "X" Is null false.', "condition-operand-type"],
  ])("maps %s", (problem, ruleId) => {
    expect(flowFailureHint(problem)?.rule_id).toBe(ruleId);
  });

  it("returns undefined for unknown problems", () => {
    expect(flowFailureHint("Something new")).toBeUndefined();
  });
});
