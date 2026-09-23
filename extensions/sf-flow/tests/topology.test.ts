/* SPDX-License-Identifier: Apache-2.0 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeFlowSource } from "../lib/analyzer.ts";
import { buildAuthoringPlan } from "../lib/author.ts";
import { buildMermaidTopology, buildTopologyEvidence } from "../lib/topology.ts";

const fixture = (name: string) =>
  readFile(path.join(import.meta.dirname, "fixtures", name), "utf8");

describe("SF Flow Mermaid topology", () => {
  it("projects normal and fault connectors into bounded Mermaid", async () => {
    const result = analyzeFlowSource(await fixture("broken.flow"), "broken.flow");
    const topology = buildMermaidTopology(result.model!, 20);

    expect(topology.source).toContain("flowchart TD");
    expect(topology.source).toContain("START · Account · before save · update");
    expect(topology.source).toContain("UPDATE · Write In Loop · Account");
    expect(topology.source).toContain("|Default|");
    expect(topology.source).toContain("|For each|");
    expect(topology.source).not.toContain("|Loop Records|");
    expect(topology.nodes).toBeGreaterThan(0);
    expect(topology.truncated).toBe(false);
  });

  it("bounds Mermaid source before handing it to Pi", async () => {
    const result = analyzeFlowSource(
      await fixture("Record_Triggered_Example.flow-meta.xml"),
      "Record_Triggered_Example.flow-meta.xml",
    );
    const topology = buildTopologyEvidence(result.model!, 1);

    expect(topology.display.source).toContain("flowchart TD");
    expect(topology.display.nodes).toBe(1);
    expect(topology.display.total_nodes).toBe(2);
    expect(topology.display.truncated).toBe(true);
    expect(topology.artifact.nodes).toBe(2);
    expect(topology.artifact.truncated).toBe(false);
  });

  it("displays up to 100 executable elements by default", () => {
    const elements = Array.from({ length: 101 }, (_, index) => ({
      id: `node_${index}`,
      name: `node_${index}`,
      kind: index === 0 ? "start" : "assignments",
      label: `Node ${index}`,
      line: index + 1,
      column: 1,
    }));
    const topology = buildMermaidTopology({
      file: "large.flow-meta.xml",
      family: "autolaunched",
      elements,
      connectors: [],
      resources: [],
      references: [],
    });

    expect(topology.nodes).toBe(100);
    expect(topology.total_nodes).toBe(101);
    expect(topology.truncated).toBe(true);
  });

  it("uses solid, thick, and dotted edges for sequence, durable writes, and faults", () => {
    const topology = buildMermaidTopology({
      file: "edges.flow-meta.xml",
      family: "autolaunched",
      elements: [
        { id: "__start__", name: "Start", kind: "start", line: 1, column: 1 },
        {
          id: "Get_Records",
          name: "Get_Records",
          kind: "recordLookups",
          label: "Get Records",
          detail: "Account",
          line: 2,
          column: 1,
        },
        {
          id: "Should_Create",
          name: "Should_Create",
          kind: "decisions",
          label: "Should Create",
          line: 3,
          column: 1,
        },
        {
          id: "Create_Task",
          name: "Create_Task",
          kind: "recordCreates",
          label: "Create Task",
          detail: "Task",
          line: 4,
          column: 1,
        },
        {
          id: "Handle_Fault",
          name: "Handle_Fault",
          kind: "assignments",
          label: "Handle Fault",
          line: 5,
          column: 1,
        },
      ],
      connectors: [
        {
          from: "__start__",
          to: "Get_Records",
          kind: "connector",
          fault: false,
          line: 1,
          column: 1,
        },
        {
          from: "Get_Records",
          to: "Should_Create",
          kind: "connector",
          fault: false,
          line: 2,
          column: 1,
        },
        {
          from: "Should_Create",
          to: "Create_Task",
          kind: "connector",
          label: "Yes",
          fault: false,
          line: 2,
          column: 1,
        },
        {
          from: "Create_Task",
          to: "Handle_Fault",
          kind: "faultConnector",
          label: "Fault",
          fault: true,
          line: 2,
          column: 1,
        },
      ],
      resources: [],
      references: [],
    });

    expect(topology.source).toContain('n1[("GET · Get Records · Account")]');
    expect(topology.source).toContain("n0 --> n1");
    expect(topology.source).toContain("n1 --> n2");
    expect(topology.source).toContain("==>|Yes|");
    expect(topology.source).toContain("-.->|Fault|");
  });

  it("models an asynchronous-after-commit path as an explicit topology node", () => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><apiVersion>68.0</apiVersion><assignments><name>Immediate</name><label>Immediate</label><assignmentItems><assignToReference>status</assignToReference><operator>Assign</operator><value><stringValue>done</stringValue></value></assignmentItems></assignments><description>Async topology fixture.</description><label>Async Topology</label><processType>AutoLaunchedFlow</processType><recordCreates><name>Create_Task</name><label>Create Task</label><inputAssignments><field>Subject</field><value><stringValue>Async</stringValue></value></inputAssignments><object>Task</object></recordCreates><start><connector><targetReference>Immediate</targetReference></connector><doesRequireRecordChangedToMeetCriteria>true</doesRequireRecordChangedToMeetCriteria><filterLogic>and</filterLogic><filters><field>Name</field><operator>IsNull</operator><value><booleanValue>false</booleanValue></value></filters><object>Account</object><recordTriggerType>Update</recordTriggerType><scheduledPaths><name>After_Commit</name><connector><targetReference>Create_Task</targetReference></connector><pathType>AsyncAfterCommit</pathType></scheduledPaths><triggerType>RecordAfterSave</triggerType></start><status>Draft</status><variables><name>status</name><dataType>String</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>false</isOutput></variables></Flow>`,
      "async-topology.flow-meta.xml",
    );
    const topology = buildMermaidTopology(result.model!, 20);

    expect(result.model?.elements).toContainEqual(
      expect.objectContaining({ name: "After_Commit", kind: "scheduledPaths" }),
    );
    expect(topology.source).toContain("ASYNC · After Commit · after commit");
    expect(topology.source).toContain("-->|Async| ");
    expect(topology.source).toContain("==> ");
  });

  it("describes assignments without turning resources into separate nodes", async () => {
    const result = analyzeFlowSource(
      await fixture("Record_Triggered_Example.flow-meta.xml"),
      "Record_Triggered_Example.flow-meta.xml",
    );
    const topology = buildMermaidTopology(result.model!, 20);

    expect(topology.source).toContain(
      "START · Account · before save · create/update · when Name has value",
    );
    expect(topology.source).toContain(
      "SET · Normalize Description · $Record.Description = Reviewed",
    );
    expect(topology.source).not.toContain('missingEmailCount["');
  });

  it("renders Omni-Channel Route Work as a routing decision instead of a generic action", async () => {
    const result = analyzeFlowSource(
      await fixture("Omni_Channel_Queue.flow-meta.xml"),
      "Omni_Channel_Queue.flow-meta.xml",
    );
    const topology = buildMermaidTopology(result.model!, 20);

    expect(topology.source).toContain("START · Omni-Channel routing");
    expect(topology.source).toContain("ROUTE · Route Work to Queue · queue");
    expect(topology.source).not.toContain("ACTION · Route Work to Queue");
  });

  it("renders skills and availability-aware Omni-Channel actions", async () => {
    const plan = await buildAuthoringPlan(
      {
        action: "author.plan",
        intent: "Check availability and route Omni-Channel work using skills",
        flow_type: "omni-channel",
        omni_destination: "skills",
        omni_check_availability: true,
      },
      process.cwd(),
    );
    const result = analyzeFlowSource(String(plan.details.skeleton), "Omni_Skills.flow-meta.xml");
    const topology = buildMermaidTopology(result.model!, 20);

    expect(topology.source).toContain("CHECK AVAILABILITY");
    expect(topology.source).toContain("ROUTE · Route Work to Skills · skills");
    expect(topology.source).toContain("SET · Set Reason For Not Routing");
  });
});
