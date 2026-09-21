/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { analyzeFlowSource } from "../lib/analyzer.ts";

const BEFORE_SAVE_BODY = `<assignments><name>Complete</name><label>Complete</label><assignmentItems><assignToReference>$Record.Description</assignToReference><operator>Assign</operator><value><stringValue>done</stringValue></value></assignmentItems></assignments>`;
const COMPLETION_BODY = `<assignments><name>Complete</name><label>Complete</label><assignmentItems><assignToReference>done</assignToReference><operator>Assign</operator><value><booleanValue>true</booleanValue></value></assignmentItems></assignments><variables><name>done</name><dataType>Boolean</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>false</isOutput></variables>`;

function flow(body: string, start = "<start/>"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>68.0</apiVersion>
  ${body}
  <description>Exercises deterministic Flow metadata configuration diagnostics.</description>
  <label>Configuration Fixture</label>
  <processMetadataValues><name>CanvasMode</name><value><stringValue>AUTO_LAYOUT_CANVAS</stringValue></value></processMetadataValues>
  <processType>AutoLaunchedFlow</processType>
  ${start}
  <status>Draft</status>
</Flow>`;
}

function analyze(name: string, body: string, start: string) {
  return analyzeFlowSource(flow(body, start), `${name}.flow-meta.xml`);
}

function filter(
  field: string | undefined,
  operator: string,
  valueType: string,
  value: string,
): string {
  return `<filters>${field ? `<field>${field}</field>` : ""}<operator>${operator}</operator><value><${valueType}>${value}</${valueType}></value></filters>`;
}

function beforeSaveStart(filters: string[], logic = "and"): string {
  return `<start><connector><targetReference>Complete</targetReference></connector><filterLogic>${logic}</filterLogic>${filters.join("")}<object>Account</object><recordTriggerType>Update</recordTriggerType><triggerType>RecordBeforeSave</triggerType></start>`;
}

function asyncPathStart(
  input: {
    triggerType?: string;
    guard?: string;
    criteria?: string;
    pathMetadata?: string;
  } = {},
): string {
  const triggerType = input.triggerType ?? "RecordAfterSave";
  const recordTrigger =
    triggerType === "RecordAfterSave"
      ? "<object>Account</object><recordTriggerType>Update</recordTriggerType>"
      : "";
  return `<start><connector><targetReference>Complete</targetReference></connector>${input.guard ?? ""}${input.criteria ?? filter("Name", "IsNull", "booleanValue", "false")}${recordTrigger}<scheduledPaths><name>After_Commit</name><connector><targetReference>Complete</targetReference></connector>${input.pathMetadata ?? ""}<pathType>AsyncAfterCommit</pathType></scheduledPaths><triggerType>${triggerType}</triggerType></start>`;
}

function expectHighRule(
  result: ReturnType<typeof analyzeFlowSource>,
  ruleId: string,
  message?: string,
): void {
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      rule_id: ruleId,
      severity: "high",
      ...(message ? { message: expect.stringContaining(message) } : {}),
    }),
  );
}

describe("SF Flow metadata configuration diagnostics", () => {
  it("rejects Create Records with conflicting record ID output storage", () => {
    const result = analyze(
      "conflicting-create-output",
      `<recordCreates><name>Create_Contact</name><label>Create Contact</label><assignRecordIdToReference>createdContactId</assignRecordIdToReference><object>Contact</object><storeOutputAutomatically>true</storeOutputAutomatically></recordCreates><variables><name>createdContactId</name><dataType>String</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>false</isOutput></variables>`,
      `<start><connector><targetReference>Create_Contact</targetReference></connector><triggerType>None</triggerType></start>`,
    );

    expectHighRule(result, "conflicting-create-output-storage");
    expect(result.findings).toContainEqual(expect.objectContaining({ element: "Create_Contact" }));
  });

  it("requires asynchronous-after-commit paths to use after-save record timing", () => {
    const result = analyze(
      "wrong-family-async-path",
      COMPLETION_BODY,
      asyncPathStart({ triggerType: "None", criteria: "" }),
    );

    expectHighRule(result, "invalid-async-path-configuration", "RecordAfterSave");
  });

  it("requires update-triggered asynchronous paths to use a transition or Is Changed guard", () => {
    const result = analyze("unguarded-async-path", COMPLETION_BODY, asyncPathStart());

    expectHighRule(result, "missing-async-path-entry-guard");
    expect(result.findings).toContainEqual(expect.objectContaining({ element: "After_Commit" }));
  });

  it("rejects malformed custom Start filter logic", () => {
    const result = analyze(
      "malformed-filter-logic",
      BEFORE_SAVE_BODY,
      beforeSaveStart(
        [
          filter("Name", "IsNull", "booleanValue", "false"),
          filter("Phone", "IsNull", "booleanValue", "false"),
        ],
        "1 AND (2 OR)",
      ),
    );

    expectHighRule(result, "invalid-start-filter-logic", "syntax");
  });

  it("rejects custom Start filter logic that references a missing condition index", () => {
    const result = analyze(
      "missing-filter-index",
      BEFORE_SAVE_BODY,
      beforeSaveStart(
        [
          filter("Name", "IsNull", "booleanValue", "false"),
          filter("Phone", "IsNull", "booleanValue", "false"),
        ],
        "1 AND 3",
      ),
    );

    expectHighRule(result, "invalid-start-filter-logic", "3");
  });

  it("rejects a record filter without its required field", () => {
    const result = analyze(
      "missing-record-filter-field",
      BEFORE_SAVE_BODY,
      beforeSaveStart([filter(undefined, "EqualTo", "stringValue", "SFPI")]),
    );

    expectHighRule(result, "invalid-record-filter", "field");
  });

  it("rejects an unsupported record filter operator", () => {
    const result = analyze(
      "unsupported-record-filter",
      BEFORE_SAVE_BODY,
      beforeSaveStart([filter("Name", "BeginsWith", "stringValue", "SFPI")]),
    );

    expectHighRule(result, "invalid-record-filter", "BeginsWith");
  });

  it("rejects a non-boolean literal for IsNull", () => {
    const result = analyze(
      "invalid-is-null-value",
      BEFORE_SAVE_BODY,
      beforeSaveStart([filter("Name", "IsNull", "stringValue", "false")]),
    );

    expectHighRule(result, "invalid-record-filter", "booleanValue");
  });

  it("rejects a non-string literal for a string record-filter operator", () => {
    const result = analyze(
      "invalid-string-operator-value",
      BEFORE_SAVE_BODY,
      beforeSaveStart([filter("Name", "Contains", "numberValue", "42")]),
    );

    expectHighRule(result, "invalid-record-filter", "stringValue");
  });

  it("rejects Boolean values for ordered comparison operators", () => {
    const literal = analyze(
      "invalid-ordered-comparison",
      BEFORE_SAVE_BODY,
      beforeSaveStart([filter("AnnualRevenue", "GreaterThan", "booleanValue", "true")]),
    );
    const reference = analyze(
      "invalid-typed-reference-comparison",
      `${BEFORE_SAVE_BODY}<variables><name>booleanThreshold</name><dataType>Boolean</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>false</isOutput></variables>`,
      beforeSaveStart([
        filter("AnnualRevenue", "GreaterThan", "elementReference", "booleanThreshold"),
      ]),
    );

    expectHighRule(literal, "invalid-record-filter", "booleanValue");
    expectHighRule(reference, "invalid-record-filter", "Boolean");
  });

  it("accepts all supported record-filter operators with compatible literal types", () => {
    const result = analyze(
      "valid-record-filters",
      BEFORE_SAVE_BODY,
      beforeSaveStart(
        [
          filter("Name", "EqualTo", "stringValue", "A"),
          filter("Name", "NotEqualTo", "stringValue", "B"),
          filter("AnnualRevenue", "GreaterThan", "numberValue", "1"),
          filter("AnnualRevenue", "LessThan", "numberValue", "10"),
          filter(
            "CreatedDate",
            "GreaterThanOrEqualTo",
            "dateTimeValue",
            "2026-01-01T00:00:00.000Z",
          ),
          filter("CloseDate__c", "LessThanOrEqualTo", "dateValue", "2027-01-01"),
          filter("Name", "StartsWith", "stringValue", "A"),
          filter("Name", "EndsWith", "stringValue", "Z"),
          filter("Name", "Contains", "stringValue", "M"),
          filter("Phone", "IsNull", "booleanValue", "false"),
        ],
        "1 AND 2 AND 3 AND 4 AND 5 AND 6 AND 7 AND 8 AND 9 AND 10",
      ),
    );

    expect(result.findings.some((finding) => finding.rule_id === "invalid-record-filter")).toBe(
      false,
    );
    expect(
      result.findings.some((finding) => finding.rule_id === "invalid-start-filter-logic"),
    ).toBe(false);
  });

  it("accepts both supported update-trigger guards for asynchronous paths", () => {
    const transition = analyze(
      "transition-guard",
      COMPLETION_BODY,
      asyncPathStart({
        guard:
          "<doesRequireRecordChangedToMeetCriteria>true</doesRequireRecordChangedToMeetCriteria>",
      }),
    );
    const isChanged = analyze(
      "is-changed-guard",
      COMPLETION_BODY,
      asyncPathStart({
        criteria:
          "<conditionLogic>and</conditionLogic><conditions><leftValueReference>$Record.Name</leftValueReference><operator>IsChanged</operator><rightValue><booleanValue>true</booleanValue></rightValue></conditions>",
      }),
    );

    for (const result of [transition, isChanged]) {
      expect(
        result.findings.some((finding) => finding.rule_id === "missing-async-path-entry-guard"),
      ).toBe(false);
    }
    expect(
      isChanged.findings.some((finding) => finding.rule_id === "missing-record-trigger-filter"),
    ).toBe(false);
  });

  it("rejects fields that are incompatible with an asynchronous-after-commit path", () => {
    const result = analyze(
      "invalid-async-path",
      COMPLETION_BODY,
      asyncPathStart({
        guard:
          "<doesRequireRecordChangedToMeetCriteria>true</doesRequireRecordChangedToMeetCriteria>",
        pathMetadata: "<label>After Commit</label>",
      }),
    );

    expectHighRule(result, "invalid-async-path-configuration", "label");
  });
});
