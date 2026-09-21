/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { analyzeFlowSource } from "../lib/analyzer.ts";

function findings(
  source: string,
  profile: "review" | "audit",
  file = "Domain_Purpose.flow-meta.xml",
) {
  return analyzeFlowSource(source, file, { profile }).findings.map((finding) => finding.rule_id);
}

function flow(
  body: string,
  options: { processType?: string; status?: string; start?: string } = {},
) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>68.0</apiVersion>
  ${body}
  <description>Fresh SF Pi review fixture.</description>
  <label>Review Fixture</label>
  <processMetadataValues><name>CanvasMode</name><value><stringValue>AUTO_LAYOUT_CANVAS</stringValue></value></processMetadataValues>
  <processType>${options.processType ?? "AutoLaunchedFlow"}</processType>
  ${options.start ?? "<start><locationX>0</locationX><locationY>0</locationY></start>"}
  <status>${options.status ?? "Draft"}</status>
</Flow>`;
}

describe("SF Flow review and audit quality rules", () => {
  it("reports trigger order, record-id strings, missing descriptions, and unclear names", () => {
    const ids = findings(
      flow(
        `<assignments><name>Copy_1_Of_Assignment</name><label>Copied Assignment</label><assignmentItems><assignToReference>result</assignToReference><operator>Assign</operator><value><stringValue>x</stringValue></value></assignmentItems></assignments>
<variables><name>recordId</name><dataType>String</dataType><isCollection>false</isCollection><isInput>true</isInput><isOutput>false</isOutput></variables>
<variables><name>result</name><dataType>String</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>true</isOutput></variables>`,
        {
          start: `<start><filterFormula>TRUE</filterFormula><object>Account</object><recordTriggerType>Update</recordTriggerType><triggerType>RecordAfterSave</triggerType><connector><targetReference>Copy_1_Of_Assignment</targetReference></connector></start>`,
        },
      ),
      "review",
    );

    expect(ids).toEqual(
      expect.arrayContaining([
        "unspecified-trigger-order",
        "record-id-as-string",
        "missing-metadata-description",
        "unclear-api-naming",
      ]),
    );
  });

  it("suggests Transform for an assignment-only loop", () => {
    const ids = findings(
      flow(
        `<loops><name>Map_Items</name><collectionReference>items</collectionReference><nextValueConnector><targetReference>Map_One</targetReference></nextValueConnector></loops>
<assignments><name>Map_One</name><description>Maps one item.</description><assignmentItems><assignToReference>output</assignToReference><operator>Add</operator><value><elementReference>Map_Items</elementReference></value></assignmentItems><connector><targetReference>Map_Items</targetReference></connector></assignments>
<variables><name>items</name><dataType>String</dataType><isCollection>true</isCollection><isInput>true</isInput><isOutput>false</isOutput></variables>
<variables><name>output</name><dataType>String</dataType><isCollection>true</isCollection><isInput>false</isInput><isOutput>true</isOutput></variables>`,
        {
          start: `<start><connector><targetReference>Map_Items</targetReference></connector></start>`,
        },
      ),
      "review",
    );

    expect(ids).toContain("transform-instead-of-loop");
  });

  it("reports complexity metrics only in review or audit profiles", () => {
    const decisions = Array.from({ length: 27 }, (_, index) => {
      const next = index === 26 ? undefined : `Decision_${index + 1}`;
      return `<decisions><name>Decision_${index}</name><description>Decision ${index}</description><defaultConnector${next ? `><targetReference>${next}</targetReference></defaultConnector` : "/"}><rules><name>Branch_${index}</name>${next ? `<connector><targetReference>${next}</targetReference></connector>` : ""}</rules></decisions>`;
    }).join("\n");
    const source = flow(decisions, {
      start: `<start><connector><targetReference>Decision_0</targetReference></connector></start>`,
    });
    const review = findings(source, "review");
    const generation = analyzeFlowSource(source, "Domain_Purpose.flow-meta.xml", {
      profile: "generation",
    }).findings.map((finding) => finding.rule_id);

    expect(review).toEqual(
      expect.arrayContaining(["cognitive-complexity", "excessive-cyclomatic-complexity"]),
    );
    expect(generation).not.toContain("cognitive-complexity");
    expect(generation).not.toContain("excessive-cyclomatic-complexity");
  });

  it("keeps migration and naming policy in audit only", () => {
    const source = flow("", { processType: "Workflow", status: "Draft" });
    const audit = findings(source, "audit", "BadName.flow-meta.xml");
    const review = findings(source, "review", "BadName.flow-meta.xml");

    expect(audit).toEqual(
      expect.arrayContaining([
        "process-builder-usage",
        "inactive-flow",
        "invalid-naming-convention",
      ]),
    );
    expect(review).not.toContain("process-builder-usage");
    expect(review).not.toContain("inactive-flow");
    expect(review).not.toContain("invalid-naming-convention");
  });
});
