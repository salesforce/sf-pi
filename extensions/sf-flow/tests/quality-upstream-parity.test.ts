/* SPDX-License-Identifier: Apache-2.0 */
/** Dev-only black-box parity probes. No upstream production imports are allowed. */

import scanner from "@flow-scanner/lightning-flow-scanner-core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeFlowSource } from "../lib/analyzer.ts";
import { LIGHTNING_FLOW_SCANNER_RULE_IDS } from "../lib/quality/catalog.ts";

const roots: string[] = [];

async function scanBoth(
  source: string,
  filename: string,
  profile: "generation" | "review" | "audit",
) {
  const root = await mkdtemp(path.join(tmpdir(), "sf-flow-parity-"));
  roots.push(root);
  const file = path.join(root, filename);
  await writeFile(file, source);
  const parsed = await scanner.parse([file]);
  const upstreamResult = scanner.scan(parsed, { betaMode: true })[0];
  return {
    upstream: new Set(
      upstreamResult.ruleResults
        .filter((result) => result.occurs)
        .map((result) => result.ruleDefinition.ruleId),
    ),
    local: new Set(
      analyzeFlowSource(source, file, { profile }).findings.map((finding) => finding.rule_id),
    ),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Lightning Flow Scanner black-box parity", () => {
  it("pins the complete 6.19.4 public rule surface", () => {
    const stable = scanner.getRules().map((rule) => rule.ruleId);
    const betaIds = [
      "hardcoded-secret",
      "missing-record-trigger-filter",
      "cognitive-complexity",
      "record-id-as-string",
      "transform-instead-of-loop",
      "missing-metadata-description",
      "missing-start-reference",
    ];
    const beta = scanner.getRules(betaIds).map((rule) => rule.ruleId);

    expect([...stable, ...beta].sort()).toEqual([...LIGHTNING_FLOW_SCANNER_RULE_IDS].sort());
  });

  it("agrees on selected high-value rule occurrences using fresh SF Pi fixtures", async () => {
    const source = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>49.0</apiVersion>
  <loops><name>Loop_Items</name><collectionReference>items</collectionReference><nextValueConnector><targetReference>Find_One</targetReference></nextValueConnector></loops>
  <recordLookups><name>Find_One</name><object>Account</object><connector><targetReference>Write_One</targetReference></connector><filters><field>Id</field><operator>EqualTo</operator><value><stringValue>001000000000001AAA</stringValue></value></filters></recordLookups>
  <recordUpdates><name>Write_One</name><object>Account</object><connector><targetReference>Loop_Items</targetReference></connector></recordUpdates>
  <assignments><name>Detached_Node</name></assignments>
  <label>Parity Fixture</label><processType>AutoLaunchedFlow</processType>
  <start><connector><targetReference>Loop_Items</targetReference></connector></start>
  <status>Draft</status>
  <variables><name>items</name><dataType>SObject</dataType><isCollection>true</isCollection><isInput>true</isInput><isOutput>false</isOutput></variables>
</Flow>`;
    const { upstream, local } = await scanBoth(source, "Parity_Fixture.flow-meta.xml", "review");

    for (const ruleId of [
      "dml-in-loop",
      "soql-in-loop",
      "hardcoded-id",
      "missing-flow-description",
      "unreachable-element",
    ]) {
      expect({ ruleId, local: local.has(ruleId), upstream: upstream.has(ruleId) }).toMatchObject({
        local: true,
        upstream: true,
      });
    }
  });

  it("agrees on hardcoded literal findings", async () => {
    const source = `<?xml version="1.0"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>68.0</apiVersion><textTemplates><name>Environment_Literals</name><text>https://api.example.test/v1 001000000000001AAA -----BEGIN PRIVATE KEY-----</text></textTemplates><description>Fresh literal parity fixture.</description><label>Literal Parity</label><processType>AutoLaunchedFlow</processType><start/><status>Active</status></Flow>`;
    const { upstream, local } = await scanBoth(
      source,
      "Literal_Parity.flow-meta.xml",
      "generation",
    );
    for (const ruleId of ["hardcoded-id", "hardcoded-secret"]) {
      expect({ ruleId, local: local.has(ruleId), upstream: upstream.has(ruleId) }).toMatchObject({
        local: true,
        upstream: true,
      });
    }
    // Documented divergence: SF Pi also detects endpoint literals in text templates.
    expect({ local: local.has("hardcoded-url"), upstream: upstream.has("hardcoded-url") }).toEqual({
      local: true,
      upstream: false,
    });
  });

  it("agrees on lookup field, null, and fault handling findings", async () => {
    const source = `<?xml version="1.0"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>68.0</apiVersion><recordLookups><name>Find_Account</name><object>Account</object><storeOutputAutomatically>true</storeOutputAutomatically><connector><targetReference>Use_Account</targetReference></connector></recordLookups><assignments><name>Use_Account</name><description>Uses lookup output.</description><assignmentItems><assignToReference>result</assignToReference><operator>Assign</operator><value><elementReference>Find_Account.Name</elementReference></value></assignmentItems></assignments><description>Fresh lookup parity fixture.</description><label>Lookup Parity</label><processType>AutoLaunchedFlow</processType><start><connector><targetReference>Find_Account</targetReference></connector></start><status>Active</status><variables><name>result</name><dataType>String</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>true</isOutput></variables></Flow>`;
    const { upstream, local } = await scanBoth(source, "Lookup_Parity.flow-meta.xml", "generation");
    for (const ruleId of ["get-record-all-fields", "missing-fault-path"]) {
      expect({ ruleId, local: local.has(ruleId), upstream: upstream.has(ruleId) }).toMatchObject({
        local: true,
        upstream: true,
      });
    }
    // Documented divergence: SF Pi requires an immediate found/not-found decision.
    expect({
      local: local.has("missing-null-handler"),
      upstream: upstream.has("missing-null-handler"),
    }).toEqual({ local: true, upstream: false });
  });

  it("agrees on record-trigger entry and same-record update findings", async () => {
    const source = `<?xml version="1.0"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>68.0</apiVersion><recordUpdates><name>Update_Triggering_Record</name><object>Account</object><filters><field>Id</field><operator>EqualTo</operator><value><elementReference>$Record.Id</elementReference></value></filters></recordUpdates><description>Fresh record parity fixture.</description><label>Record Parity</label><processType>AutoLaunchedFlow</processType><start><object>Account</object><recordTriggerType>Update</recordTriggerType><triggerType>RecordAfterSave</triggerType><connector><targetReference>Update_Triggering_Record</targetReference></connector></start><status>Active</status></Flow>`;
    const { upstream, local } = await scanBoth(source, "Record_Parity.flow-meta.xml", "generation");
    expect({
      local: local.has("missing-record-trigger-filter"),
      upstream: upstream.has("missing-record-trigger-filter"),
    }).toEqual({ local: true, upstream: true });
    for (const ruleId of ["recursive-record-update", "same-record-field-updates"]) {
      // Documented divergence: SF Pi recognizes a same-object Id-filter update directly.
      expect({ ruleId, local: local.has(ruleId), upstream: upstream.has(ruleId) }).toMatchObject({
        local: true,
        upstream: false,
      });
    }
  });

  it("agrees on action-loop and screen navigation safety", async () => {
    const loopSource = `<?xml version="1.0"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>68.0</apiVersion><loops><name>Loop_Items</name><collectionReference>items</collectionReference><nextValueConnector><targetReference>Call_Action</targetReference></nextValueConnector></loops><actionCalls><name>Call_Action</name><actionName>DoWork</actionName><actionType>apex</actionType><connector><targetReference>Loop_Items</targetReference></connector></actionCalls><description>Fresh action-loop parity fixture.</description><label>Action Loop Parity</label><processType>AutoLaunchedFlow</processType><start><connector><targetReference>Loop_Items</targetReference></connector></start><status>Active</status><variables><name>items</name><dataType>String</dataType><isCollection>true</isCollection><isInput>true</isInput><isOutput>false</isOutput></variables></Flow>`;
    const loop = await scanBoth(loopSource, "Action_Loop_Parity.flow-meta.xml", "generation");
    expect({
      local: loop.local.has("action-call-in-loop"),
      upstream: loop.upstream.has("action-call-in-loop"),
    }).toEqual({ local: true, upstream: true });

    const screenSource = `<?xml version="1.0"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>68.0</apiVersion><screens><name>First_Screen</name><description>Collects input.</description><allowBack>true</allowBack><connector><targetReference>Write_Record</targetReference></connector></screens><recordUpdates><name>Write_Record</name><object>Account</object><connector><targetReference>Confirmation</targetReference></connector></recordUpdates><screens><name>Confirmation</name><description>Shows confirmation.</description><allowBack>true</allowBack></screens><description>Fresh screen parity fixture.</description><label>Screen Parity</label><processType>Flow</processType><start><connector><targetReference>First_Screen</targetReference></connector></start><status>Active</status></Flow>`;
    const screen = await scanBoth(screenSource, "Screen_Parity.flow-meta.xml", "generation");
    // Documented divergence: SF Pi treats DML before a back-enabled downstream screen as repeatable.
    expect({
      local: screen.local.has("duplicate-dml"),
      upstream: screen.upstream.has("duplicate-dml"),
    }).toEqual({ local: true, upstream: false });
  });

  it("agrees on metadata hygiene and unused resource findings", async () => {
    const source = `<?xml version="1.0"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>49.0</apiVersion><assignments><name>Detached</name><description>Detached element.</description></assignments><label>Metadata Parity</label><processType>AutoLaunchedFlow</processType><start/><status>Active</status><variables><name>unusedValue</name><dataType>String</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>false</isOutput></variables></Flow>`;
    const { upstream, local } = await scanBoth(
      source,
      "Metadata_Parity.flow-meta.xml",
      "generation",
    );
    for (const ruleId of ["invalid-api-version", "missing-flow-description", "unused-variable"]) {
      expect({ ruleId, local: local.has(ruleId), upstream: upstream.has(ruleId) }).toMatchObject({
        local: true,
        upstream: true,
      });
    }
    for (const ruleId of ["missing-auto-layout", "missing-start-reference"]) {
      // Documented divergence: SF Pi reports missing metadata/default graph entry on this minimal source.
      expect({ ruleId, local: local.has(ruleId), upstream: upstream.has(ruleId) }).toMatchObject({
        local: true,
        upstream: false,
      });
    }
  });

  it("agrees on unsafe system context for a screen Flow", async () => {
    const source = `<?xml version="1.0"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>68.0</apiVersion><runInMode>SystemModeWithoutSharing</runInMode><description>Fresh context parity fixture.</description><label>Context Parity</label><processType>Flow</processType><start/><status>Active</status></Flow>`;
    const { upstream, local } = await scanBoth(
      source,
      "Context_Parity.flow-meta.xml",
      "generation",
    );
    expect({
      local: local.has("unsafe-running-context"),
      upstream: upstream.has("unsafe-running-context"),
    }).toEqual({ local: true, upstream: true });
  });

  it("agrees on review-profile metadata and contract findings", async () => {
    const source = `<?xml version="1.0"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata">
<apiVersion>68.0</apiVersion>
<assignments><name>Copy_2_of_Assignment</name><label>Copied Assignment</label><assignmentItems><assignToReference>result</assignToReference><operator>Assign</operator><value><stringValue>x</stringValue></value></assignmentItems></assignments>
<description>Fresh parity fixture.</description><label>Review Parity</label><processType>AutoLaunchedFlow</processType>
<start><filterFormula>TRUE</filterFormula><object>Account</object><recordTriggerType>Update</recordTriggerType><triggerType>RecordAfterSave</triggerType><connector><targetReference>Copy_2_of_Assignment</targetReference></connector></start>
<status>Draft</status>
<variables><name>recordId</name><dataType>String</dataType><isCollection>false</isCollection><isInput>true</isInput><isOutput>false</isOutput></variables>
<variables><name>result</name><dataType>String</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>true</isOutput></variables>
</Flow>`;
    const { upstream, local } = await scanBoth(source, "Review_Parity.flow-meta.xml", "review");

    for (const ruleId of [
      "unspecified-trigger-order",
      "missing-metadata-description",
      "unclear-api-naming",
    ]) {
      expect({ ruleId, local: local.has(ruleId), upstream: upstream.has(ruleId) }).toMatchObject({
        local: true,
        upstream: true,
      });
    }
    // Documented divergence: SF Pi flags an input recordId String contract directly;
    // upstream 6.19.4 did not report this fresh minimal fixture.
    expect({
      local: local.has("record-id-as-string"),
      upstream: upstream.has("record-id-as-string"),
    }).toEqual({ local: true, upstream: false });
  });

  it("agrees on assignment-only loop transformation guidance", async () => {
    const source = `<?xml version="1.0"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata">
<apiVersion>68.0</apiVersion>
<loops><name>Map_Items</name><collectionReference>items</collectionReference><nextValueConnector><targetReference>Map_One</targetReference></nextValueConnector></loops>
<assignments><name>Map_One</name><description>Maps one item.</description><assignmentItems><assignToReference>output</assignToReference><operator>Add</operator><value><elementReference>Map_Items</elementReference></value></assignmentItems><connector><targetReference>Map_Items</targetReference></connector></assignments>
<description>Fresh transform parity fixture.</description><label>Transform Parity</label><processType>AutoLaunchedFlow</processType><start><connector><targetReference>Map_Items</targetReference></connector></start><status>Draft</status>
<variables><name>items</name><dataType>String</dataType><isCollection>true</isCollection><isInput>true</isInput><isOutput>false</isOutput></variables>
<variables><name>output</name><dataType>String</dataType><isCollection>true</isCollection><isInput>false</isInput><isOutput>true</isOutput></variables>
</Flow>`;
    const { upstream, local } = await scanBoth(source, "Transform_Parity.flow-meta.xml", "review");
    expect({
      local: local.has("transform-instead-of-loop"),
      upstream: upstream.has("transform-instead-of-loop"),
    }).toEqual({ local: true, upstream: true });
  });

  it("agrees on complexity threshold findings", async () => {
    const decisions = Array.from({ length: 27 }, (_, index) => {
      const next = index === 26 ? undefined : `Decision_${index + 1}`;
      return `<decisions><name>Decision_${index}</name><description>Decision ${index}</description><defaultConnector${next ? `><targetReference>${next}</targetReference></defaultConnector` : "/"}><rules><name>Branch_${index}</name>${next ? `<connector><targetReference>${next}</targetReference></connector>` : ""}</rules></decisions>`;
    }).join("\n");
    const source = `<?xml version="1.0"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>68.0</apiVersion>${decisions}<description>Fresh complexity parity fixture.</description><label>Complexity Parity</label><processType>AutoLaunchedFlow</processType><start><connector><targetReference>Decision_0</targetReference></connector></start><status>Draft</status></Flow>`;
    const { upstream, local } = await scanBoth(source, "Complexity_Parity.flow-meta.xml", "review");
    for (const ruleId of ["cognitive-complexity", "excessive-cyclomatic-complexity"]) {
      expect({ ruleId, local: local.has(ruleId), upstream: upstream.has(ruleId) }).toMatchObject({
        local: true,
        upstream: true,
      });
    }
  });

  it("agrees on audit-only legacy, inactive, and naming findings", async () => {
    const legacySource = `<?xml version="1.0"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>68.0</apiVersion><description>Fresh legacy parity fixture.</description><label>Legacy Parity</label><processType>Workflow</processType><start/><status>Draft</status></Flow>`;
    const legacy = await scanBoth(legacySource, "Legacy_Process.flow-meta.xml", "audit");
    expect({
      local: legacy.local.has("process-builder-usage"),
      upstream: legacy.upstream.has("process-builder-usage"),
    }).toEqual({ local: true, upstream: true });
    // Documented divergence: upstream 6.19.4 excludes Workflow from inactive-flow applicability.
    expect({
      local: legacy.local.has("inactive-flow"),
      upstream: legacy.upstream.has("inactive-flow"),
    }).toEqual({ local: true, upstream: false });

    const draftSource = `<?xml version="1.0"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>68.0</apiVersion><description>Fresh draft parity fixture.</description><label>Draft Parity</label><processType>AutoLaunchedFlow</processType><start/><status>Draft</status></Flow>`;
    const draft = await scanBoth(draftSource, "BadName.flow-meta.xml", "audit");
    for (const ruleId of ["inactive-flow", "invalid-naming-convention"]) {
      expect({
        ruleId,
        local: draft.local.has(ruleId),
        upstream: draft.upstream.has(ruleId),
      }).toMatchObject({ local: true, upstream: true });
    }
  });
});
