/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { analyzeFlowSource } from "../lib/analyzer.ts";

function ids(source: string): string[] {
  return analyzeFlowSource(source, "quality.flow-meta.xml", { profile: "generation" }).findings.map(
    (finding) => finding.rule_id,
  );
}

function flow(
  body: string,
  options: { apiVersion?: string; description?: string; processType?: string; start?: string } = {},
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>${options.apiVersion ?? "68.0"}</apiVersion>
  ${body}
  ${options.description === undefined ? "" : `<description>${options.description}</description>`}
  <label>Quality Fixture</label>
  <processType>${options.processType ?? "AutoLaunchedFlow"}</processType>
  ${options.start ?? "<start><locationX>0</locationX><locationY>0</locationY></start>"}
  <status>Draft</status>
</Flow>`;
}

describe("SF Flow preventive quality rules", () => {
  it("detects hardcoded environment values with independently authored messages", () => {
    const findings = ids(
      flow(
        `<textTemplates><name>Secrets</name><text>Endpoint https://api.example.test/v1 token Bearer abcdefghijklmnopqrstuvwxyz record 001000000000001AAA</text></textTemplates>`,
        { description: "Exercises literal safety checks." },
      ),
    );

    expect(findings).toEqual(
      expect.arrayContaining(["hardcoded-id", "hardcoded-url", "hardcoded-secret"]),
    );
  });

  it("detects metadata defaults that degrade first-generation quality", () => {
    const findings = ids(flow("", { apiVersion: "49.0" }));

    expect(findings).toEqual(
      expect.arrayContaining([
        "invalid-api-version",
        "missing-flow-description",
        "missing-auto-layout",
      ]),
    );
  });

  it("detects unsafe and recursive after-save record automation", () => {
    const findings = ids(
      flow(
        `<runInMode>SystemModeWithoutSharing</runInMode>
<recordUpdates>
  <name>Update_Triggering_Record</name><label>Update Triggering Record</label>
  <filters><field>Id</field><operator>EqualTo</operator><value><elementReference>$Record.Id</elementReference></value></filters>
  <object>Account</object>
</recordUpdates>`,
        {
          description: "Exercises record-triggered quality checks.",
          start: `<start><object>Account</object><recordTriggerType>Update</recordTriggerType><triggerType>RecordAfterSave</triggerType><connector><targetReference>Update_Triggering_Record</targetReference></connector></start>`,
        },
      ),
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        "missing-record-trigger-filter",
        "recursive-record-update",
        "same-record-field-updates",
      ]),
    );
  });

  it("does not classify a related-object update filtered by $Record.Id as a recursive same-record update", () => {
    const findings = ids(
      flow(
        `<recordUpdates>
  <name>Update_Related_Contacts</name><label>Update Related Contacts</label>
  <filters><field>AccountId</field><operator>EqualTo</operator><value><elementReference>$Record.Id</elementReference></value></filters>
  <inputAssignments><field>Description</field><value><stringValue>updated</stringValue></value></inputAssignments>
  <object>Contact</object>
</recordUpdates>`,
        {
          description: "Exercises a related-object update from record automation.",
          start: `<start><filterLogic>and</filterLogic><filters><field>AccountNumber</field><operator>EqualTo</operator><value><stringValue>fixture</stringValue></value></filters><object>Account</object><recordTriggerType>Update</recordTriggerType><triggerType>RecordAfterSave</triggerType><connector><targetReference>Update_Related_Contacts</targetReference></connector></start>`,
        },
      ),
    );

    expect(findings).not.toContain("recursive-record-update");
    expect(findings).not.toContain("same-record-field-updates");
  });

  it("detects screen DML that can repeat through backward navigation", () => {
    const findings = ids(
      flow(
        `<screens><name>First_Screen</name><allowBack>true</allowBack><connector><targetReference>Write_Record</targetReference></connector></screens>
<recordUpdates><name>Write_Record</name><object>Account</object><connector><targetReference>Confirmation</targetReference></connector></recordUpdates>
<screens><name>Confirmation</name><allowBack>true</allowBack></screens>`,
        {
          description: "Exercises screen navigation safety.",
          processType: "Flow",
          start: `<start><connector><targetReference>First_Screen</targetReference></connector></start>`,
        },
      ),
    );

    expect(findings).toContain("duplicate-dml");
  });

  it("detects unsafe system context on user-facing Flow families", () => {
    const findings = ids(
      flow(`<runInMode>SystemModeWithoutSharing</runInMode>`, {
        description: "Exercises running context safety.",
        processType: "Flow",
      }),
    );

    expect(findings).toContain("unsafe-running-context");
  });

  it("splits query, DML, and action loop findings", () => {
    const findings = ids(
      flow(
        `<loops><name>Loop_Items</name><collectionReference>items</collectionReference><nextValueConnector><targetReference>Get_One</targetReference></nextValueConnector></loops>
<recordLookups><name>Get_One</name><object>Account</object><connector><targetReference>Call_Action</targetReference></connector><storeOutputAutomatically>true</storeOutputAutomatically></recordLookups>
<actionCalls><name>Call_Action</name><actionName>DoWork</actionName><actionType>apex</actionType><connector><targetReference>Write_One</targetReference></connector></actionCalls>
<recordUpdates><name>Write_One</name><object>Account</object><connector><targetReference>Loop_Items</targetReference></connector></recordUpdates>
<variables><name>items</name><dataType>SObject</dataType><isCollection>true</isCollection><isInput>true</isInput><isOutput>false</isOutput></variables>`,
        {
          description: "Exercises loop quality checks.",
          start: `<start><connector><targetReference>Loop_Items</targetReference></connector></start>`,
        },
      ),
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        "soql-in-loop",
        "dml-in-loop",
        "action-call-in-loop",
        "get-record-all-fields",
        "missing-null-handler",
      ]),
    );
    expect(findings).not.toContain("database-operation-in-loop");
  });

  it("detects unused variables and missing start references", () => {
    const findings = ids(
      flow(
        `<assignments><name>Detached</name><assignmentItems><assignToReference>usedOutput</assignToReference><operator>Assign</operator><value><stringValue>x</stringValue></value></assignmentItems></assignments>
<variables><name>unusedValue</name><dataType>String</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>false</isOutput></variables>
<variables><name>usedOutput</name><dataType>String</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>true</isOutput></variables>`,
        { description: "Exercises resource and start checks." },
      ),
    );

    expect(findings).toEqual(
      expect.arrayContaining(["unused-variable", "missing-start-reference"]),
    );
  });
});
