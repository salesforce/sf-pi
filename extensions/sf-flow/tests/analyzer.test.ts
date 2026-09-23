/* SPDX-License-Identifier: Apache-2.0 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeFlowSource } from "../lib/analyzer.ts";
import { buildAuthoringPlan } from "../lib/author.ts";

const fixture = (name: string) =>
  readFile(path.join(import.meta.dirname, "fixtures", name), "utf8");

describe("SF Flow local diagnostics", () => {
  it.each([
    ["Screen_Example.flow-meta.xml", "screen"],
    ["Autolaunched_Example.flow-meta.xml", "autolaunched"],
    ["Record_Triggered_Example.flow-meta.xml", "record-triggered"],
    ["Schedule_Triggered_Example.flow-meta.xml", "schedule-triggered"],
    ["Platform_Event_Triggered_Example.flow-meta.xml", "platform-event-triggered"],
    ["Omni_Channel_Queue.flow-meta.xml", "omni-channel"],
  ])("recognizes a valid %s fixture", async (name, family) => {
    const result = analyzeFlowSource(await fixture(name), name);

    expect(result.status).not.toBe("failed");
    expect(result.family).toBe(family);
    expect(result.findings.filter((finding) => finding.severity === "high")).toEqual([]);
    expect(result.coverage.ran.length).toBeGreaterThan(0);
  });

  it("reports deterministic graph, reference, loop, fault, and trigger findings", async () => {
    const result = analyzeFlowSource(await fixture("broken.flow"), "broken.flow");
    const ids = new Set(result.findings.map((finding) => finding.rule_id));

    expect([...ids]).toEqual(
      expect.arrayContaining([
        "duplicate-name",
        "dangling-target",
        "unresolved-reference",
        "dml-in-loop",
        "missing-fault-path",
        "element-not-allowed-before-save",
      ]),
    );
    expect(result.findings.every((finding) => finding.line > 0 && finding.column > 0)).toBe(true);
  });

  it("resolves Screen field outputs as local Flow resources", () => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><apiVersion>68.0</apiVersion><decisions><name>Has_Input</name><label>Has Input</label><rules><name>Present</name><conditions><leftValueReference>Request_Summary</leftValueReference><operator>IsNull</operator><rightValue><booleanValue>false</booleanValue></rightValue></conditions><label>Present</label></rules></decisions><description>Screen field reference fixture.</description><label>Screen Fixture</label><processType>Flow</processType><screens><name>Collect</name><label>Collect</label><allowBack>false</allowBack><allowFinish>true</allowFinish><allowPause>false</allowPause><fields><name>Request_Summary</name><dataType>String</dataType><fieldText>Request Summary</fieldText><fieldType>InputField</fieldType><isRequired>true</isRequired></fields><showFooter>true</showFooter><showHeader>true</showHeader></screens><start><connector><targetReference>Collect</targetReference></connector></start><status>Draft</status></Flow>`,
      "screen-fields.flow-meta.xml",
    );

    expect(result.findings.some((finding) => finding.rule_id === "unresolved-reference")).toBe(
      false,
    );
  });

  it("resolves Transform collection item references to their declared collection", () => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><apiVersion>68.0</apiVersion><description>Transform collection reference fixture.</description><label>Transform Collection</label><processType>AutoLaunchedFlow</processType><start><connector><targetReference>Map_Contacts</targetReference></connector></start><status>Draft</status><transforms><name>Map_Contacts</name><label>Map Contacts</label><dataType>SObject</dataType><isCollection>true</isCollection><objectType>Task</objectType><storeOutputAutomatically>true</storeOutputAutomatically><transformValues><transformValueActions><outputFieldApiName>Subject</outputFieldApiName><transformType>Map</transformType><value><elementReference>processedContacts[$EachItem].LastName</elementReference></value></transformValueActions></transformValues></transforms><variables><name>processedContacts</name><dataType>SObject</dataType><isCollection>true</isCollection><isInput>true</isInput><isOutput>false</isOutput><objectType>Contact</objectType></variables></Flow>`,
      "transform-collection.flow-meta.xml",
    );

    expect(result.findings.some((finding) => finding.rule_id === "unresolved-reference")).toBe(
      false,
    );
  });

  it.each([
    ["schedule-triggered", "Scheduled", "Account", "$Record.Name"],
    ["platform-event-triggered", "PlatformEvent", "Fixture_Event__e", "$Record.Message__c"],
  ] as const)("allows $Record in %s context", (_family, triggerType, object, reference) => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><apiVersion>68.0</apiVersion><assignments><name>Capture</name><label>Capture</label><assignmentItems><assignToReference>statusMessage</assignToReference><operator>Assign</operator><value><elementReference>${reference}</elementReference></value></assignmentItems></assignments><description>Triggered record context fixture.</description><label>Triggered Fixture</label><processType>AutoLaunchedFlow</processType><start><connector><targetReference>Capture</targetReference></connector><object>${object}</object><triggerType>${triggerType}</triggerType>${triggerType === "Scheduled" ? "<schedule><frequency>Daily</frequency><startDate>2027-01-01</startDate><startTime>00:00:00.000Z</startTime></schedule>" : ""}</start><status>Draft</status><variables><name>statusMessage</name><dataType>String</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>false</isOutput></variables></Flow>`,
      `${triggerType}.flow-meta.xml`,
    );

    expect(result.findings.some((finding) => finding.rule_id === "record-context")).toBe(false);
  });

  it("rejects Start filters on a platform-event-triggered Flow", () => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><apiVersion>68.0</apiVersion><assignments><name>Capture</name><label>Capture</label><assignmentItems><assignToReference>statusMessage</assignToReference><operator>Assign</operator><value><elementReference>$Record.Message__c</elementReference></value></assignmentItems></assignments><description>Invalid event filter fixture.</description><label>Event Fixture</label><processType>AutoLaunchedFlow</processType><start><connector><targetReference>Capture</targetReference></connector><filterLogic>and</filterLogic><filters><field>Message__c</field><operator>IsNull</operator><value><booleanValue>false</booleanValue></value></filters><object>Fixture_Event__e</object><triggerType>PlatformEvent</triggerType></start><status>Draft</status><variables><name>statusMessage</name><dataType>String</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>false</isOutput></variables></Flow>`,
      "invalid-event-filter.flow-meta.xml",
    );

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule_id: "core-flow-family",
        severity: "high",
        message: expect.stringContaining("does not support Start filters"),
      }),
    );
  });

  it("rejects a Screen that disables both Back and Finish", () => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><apiVersion>68.0</apiVersion><description>Invalid navigation fixture.</description><label>Invalid Screen</label><processType>Flow</processType><screens><name>Collect</name><label>Collect</label><allowBack>false</allowBack><allowFinish>false</allowFinish><allowPause>false</allowPause><showFooter>true</showFooter><showHeader>true</showHeader></screens><start><connector><targetReference>Collect</targetReference></connector></start><status>Draft</status></Flow>`,
      "invalid-screen-navigation.flow-meta.xml",
    );

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule_id: "core-flow-family",
        severity: "high",
        message: expect.stringContaining("but not both"),
      }),
    );
  });

  it("allows Collection Processors in a before-save record-triggered Flow", () => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><apiVersion>68.0</apiVersion><assignments><name>Use_Result</name><label>Use Result</label><assignmentItems><assignToReference>$Record.Phone</assignToReference><operator>Assign</operator><value><stringValue>processed</stringValue></value></assignmentItems></assignments><collectionProcessors><name>Filter_Contacts</name><label>Filter Contacts</label><assignNextValueToReference>currentContact</assignNextValueToReference><collectionProcessorType>FilterCollectionProcessor</collectionProcessorType><collectionReference>contacts</collectionReference><conditions><leftValueReference>currentContact.Email</leftValueReference><operator>IsNull</operator><rightValue><booleanValue>false</booleanValue></rightValue></conditions><connector><targetReference>Use_Result</targetReference></connector></collectionProcessors><description>Before-save collection processor fixture.</description><label>Before Collection</label><processType>AutoLaunchedFlow</processType><start><connector><targetReference>Filter_Contacts</targetReference></connector><object>Account</object><recordTriggerType>Update</recordTriggerType><triggerType>RecordBeforeSave</triggerType></start><status>Draft</status><variables><name>contacts</name><dataType>SObject</dataType><isCollection>true</isCollection><isInput>false</isInput><isOutput>false</isOutput><objectType>Contact</objectType></variables><variables><name>currentContact</name><dataType>SObject</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>false</isOutput><objectType>Contact</objectType></variables></Flow>`,
      "before-save-collection.flow-meta.xml",
    );

    expect(
      result.findings.some((finding) => finding.rule_id === "element-not-allowed-before-save"),
    ).toBe(false);
  });

  it("allows Custom Error in a before-save record-triggered Flow", () => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><apiVersion>68.0</apiVersion><assignments><name>Continue</name><label>Continue</label><assignmentItems><assignToReference>$Record.Description</assignToReference><operator>Assign</operator><value><stringValue>accepted</stringValue></value></assignmentItems></assignments><customErrors><name>Reject_Record</name><label>Reject Record</label><connector><targetReference>Continue</targetReference></connector><customErrorMessages><errorMessage>Rejected by the Flow fixture.</errorMessage><isFieldError>false</isFieldError></customErrorMessages></customErrors><decisions><name>Validate</name><label>Validate</label><defaultConnector><targetReference>Continue</targetReference></defaultConnector><defaultConnectorLabel>Valid</defaultConnectorLabel><rules><name>Rejected</name><conditionLogic>and</conditionLogic><conditions><leftValueReference>$Record.Name</leftValueReference><operator>StartsWith</operator><rightValue><stringValue>Reject</stringValue></rightValue></conditions><connector><targetReference>Reject_Record</targetReference></connector><label>Rejected</label></rules></decisions><description>Before-save custom error fixture.</description><label>Before Custom Error</label><processType>AutoLaunchedFlow</processType><start><connector><targetReference>Validate</targetReference></connector><filterLogic>and</filterLogic><filters><field>Name</field><operator>IsNull</operator><value><booleanValue>false</booleanValue></value></filters><object>Account</object><recordTriggerType>CreateAndUpdate</recordTriggerType><triggerType>RecordBeforeSave</triggerType></start><status>Draft</status></Flow>`,
      "before-save-custom-error.flow-meta.xml",
    );

    expect(
      result.findings.some((finding) => finding.rule_id === "element-not-allowed-before-save"),
    ).toBe(false);
  });

  it("reports a Flow that has no executable path from Start", () => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><apiVersion>68.0</apiVersion><description>Empty Flow fixture.</description><label>Empty Flow</label><processType>AutoLaunchedFlow</processType><start/><status>Draft</status></Flow>`,
      "empty.flow-meta.xml",
    );

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule_id: "missing-start-reference",
        severity: "high",
      }),
    );
  });

  it("validates the Omni-Channel recordId and Route Work contracts", async () => {
    const result = analyzeFlowSource(
      await fixture("Omni_Channel_Queue.flow-meta.xml"),
      "Omni_Channel_Queue.flow-meta.xml",
      { profile: "review" },
    );

    expect(result.family).toBe("omni-channel");
    expect(result.findings.filter((finding) => finding.severity === "high")).toEqual([]);
    expect(result.findings.some((finding) => finding.rule_id === "record-id-as-string")).toBe(
      false,
    );
    expect(result.findings.some((finding) => finding.rule_id === "missing-fault-path")).toBe(false);
    expect(result.coverage.ran).toContain("omni-channel-contract");
  });

  it.each([
    ["agent", true],
    ["skills", false],
  ] as const)(
    "accepts the generated %s Omni-Channel contract",
    async (destination, availability) => {
      const plan = await buildAuthoringPlan(
        {
          action: "author.plan",
          intent: `Route Omni-Channel work to ${destination}`,
          flow_type: "omni-channel",
          omni_destination: destination,
          omni_check_availability: availability,
        },
        process.cwd(),
      );
      const result = analyzeFlowSource(
        String(plan.details.skeleton),
        `Omni_${destination}.flow-meta.xml`,
        { profile: "review" },
      );

      expect(result.family).toBe("omni-channel");
      expect(result.findings.filter((finding) => finding.severity === "high")).toEqual([]);
      if (availability) {
        expect(result.findings.some((finding) => finding.rule_id === "missing-fault-path")).toBe(
          false,
        );
      }
      expect(result.model?.elements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "actionCalls",
            detail: expect.stringContaining(destination === "agent" ? "agent" : "skills"),
          }),
        ]),
      );
    },
  );

  it("reports an availability check that does not match downstream routing", async () => {
    const plan = await buildAuthoringPlan(
      {
        action: "author.plan",
        intent: "Check queue availability before Omni-Channel routing",
        flow_type: "omni-channel",
        omni_destination: "queue",
        omni_check_availability: true,
      },
      process.cwd(),
    );
    const mismatched = String(plan.details.skeleton).replace(
      "<name>routingType</name>\n            <value><stringValue>QueueBased</stringValue></value>",
      "<name>routingType</name>\n            <value><stringValue>Agent</stringValue></value>",
    );
    const result = analyzeFlowSource(mismatched, "Omni_Mismatch.flow-meta.xml");

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule_id: "omni-channel-contract",
        severity: "high",
        message: expect.stringContaining("different routing types"),
      }),
    );
  });

  it("requires a fallback queue for direct-agent Route Work", () => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><actionCalls><name>Route_Direct</name><label>Route Direct</label><actionName>routeWork</actionName><actionType>routeWork</actionType><inputParameters><name>recordId</name><value><elementReference>recordId</elementReference></value></inputParameters><inputParameters><name>serviceChannelId</name><value><elementReference>serviceChannelId</elementReference></value></inputParameters><inputParameters><name>routingType</name><value><stringValue>Agent</stringValue></value></inputParameters><inputParameters><name>agentId</name><value><elementReference>agentId</elementReference></value></inputParameters><versionString>2.0.0</versionString></actionCalls><apiVersion>68.0</apiVersion><description>Invalid direct-agent routing.</description><label>Invalid Direct</label><processType>RoutingFlow</processType><start><connector><targetReference>Route_Direct</targetReference></connector></start><status>Draft</status><variables><name>agentId</name><dataType>String</dataType><isCollection>false</isCollection><isInput>true</isInput><isOutput>false</isOutput></variables><variables><name>recordId</name><dataType>String</dataType><isCollection>false</isCollection><isInput>true</isInput><isOutput>false</isOutput></variables><variables><name>serviceChannelId</name><dataType>String</dataType><isCollection>false</isCollection><isInput>true</isInput><isOutput>false</isOutput></variables></Flow>`,
      "Invalid_Direct.flow-meta.xml",
    );

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule_id: "omni-channel-contract",
        severity: "high",
        message: expect.stringContaining("fallback queue"),
      }),
    );
  });

  it("reports missing Omni-Channel inputs and Route Work", () => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><apiVersion>68.0</apiVersion><description>Invalid Omni fixture.</description><label>Invalid Omni</label><processType>RoutingFlow</processType><start/><status>Draft</status></Flow>`,
      "Invalid_Omni.flow-meta.xml",
    );

    expect(result.family).toBe("omni-channel");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: "omni-channel-contract",
          severity: "high",
          message: expect.stringContaining("recordId"),
        }),
        expect.objectContaining({
          rule_id: "omni-channel-contract",
          severity: "high",
          message: expect.stringContaining("Route Work"),
        }),
      ]),
    );
  });

  it("keeps unknown specialized process types coverage-bounded", () => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><apiVersion>68.0</apiVersion><assignments><name>Use_Record</name><assignmentItems><assignToReference>$Record.Name</assignToReference><operator>Assign</operator><value><stringValue>x</stringValue></value></assignmentItems></assignments><label>Specialized</label><processType>Orchestrator</processType><start/><status>Draft</status></Flow>`,
      "specialized.flow-meta.xml",
    );

    expect(result.findings.some((finding) => finding.rule_id === "record-context")).toBe(false);
    expect(result.coverage.skipped).toContainEqual({
      id: "record-context",
      reason: "specialized Flow record context is not inferred",
    });
  });

  it("fails closed on malformed XML and discloses skipped coverage", () => {
    const result = analyzeFlowSource("<Flow><label>Broken</Flow>", "broken.flow");

    expect(result.status).toBe("failed");
    expect(result.findings.some((finding) => finding.rule_id === "xml-syntax")).toBe(true);
    expect(result.coverage.skipped.length).toBeGreaterThan(0);
  });
});
