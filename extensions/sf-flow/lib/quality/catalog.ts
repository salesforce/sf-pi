/* SPDX-License-Identifier: Apache-2.0 */
/** Data-first SF Flow quality catalog with explicit white-room provenance. */

import type { FlowFamily, FlowSeverity } from "../types.ts";

export type FlowQualityProfile = "generation" | "review" | "audit";
export type FlowQualityCategory =
  "correctness" | "security" | "performance" | "reliability" | "maintainability" | "layout";

export interface FlowQualityRule {
  id: string;
  label: string;
  message: string;
  category: FlowQualityCategory;
  default_severity: FlowSeverity;
  maturity: "stable" | "beta";
  implementation: "implemented" | "planned";
  engine: "core" | "quality" | "planned";
  profiles: FlowQualityProfile[];
  supported_families: FlowFamily[] | ["all"];
  authoring_constraint?: string;
  provenance: {
    implementation: "sf-flow";
    lightning_flow_scanner?: {
      rule_id: string;
      version: "6.19.4";
      url: string;
    };
    code_analyzer?: string[];
    salesforce_docs?: string[];
  };
}

export const LIGHTNING_FLOW_SCANNER_RULE_IDS = [
  "action-call-in-loop",
  "cognitive-complexity",
  "dml-in-loop",
  "duplicate-dml",
  "excessive-cyclomatic-complexity",
  "get-record-all-fields",
  "hardcoded-id",
  "hardcoded-secret",
  "hardcoded-url",
  "inactive-flow",
  "invalid-api-version",
  "invalid-naming-convention",
  "missing-auto-layout",
  "missing-fault-path",
  "missing-flow-description",
  "missing-metadata-description",
  "missing-null-handler",
  "missing-record-trigger-filter",
  "missing-start-reference",
  "process-builder-usage",
  "record-id-as-string",
  "recursive-record-update",
  "same-record-field-updates",
  "soql-in-loop",
  "transform-instead-of-loop",
  "unclear-api-naming",
  "unsafe-running-context",
  "unreachable-element",
  "unspecified-trigger-order",
  "unused-variable",
] as const;

const allProfiles: FlowQualityProfile[] = ["generation", "review", "audit"];
const generationProfiles: FlowQualityProfile[] = ["generation", "review", "audit"];
const reviewProfiles: FlowQualityProfile[] = ["review", "audit"];
const auditProfiles: FlowQualityProfile[] = ["audit"];
const allFamilies: ["all"] = ["all"];
const scannerBase = "https://lightningflowscanner.org/#";
const bestPractices =
  "https://help.salesforce.com/s/articleView?id=platform.flow_prep_bestpractices.htm&type=5";
const contextSafety =
  "https://help.salesforce.com/s/articleView?id=platform.flow_distribute_context_data_safety_system_context.htm&type=5";

function scannerRule(
  input: Omit<FlowQualityRule, "provenance" | "supported_families"> & {
    code_analyzer?: string[];
    salesforce_docs?: string[];
    supported_families?: FlowQualityRule["supported_families"];
  },
): FlowQualityRule {
  return {
    ...input,
    supported_families: input.supported_families ?? allFamilies,
    provenance: {
      implementation: "sf-flow",
      lightning_flow_scanner: {
        rule_id: input.id,
        version: "6.19.4",
        url: `${scannerBase}${input.id}`,
      },
      code_analyzer: input.code_analyzer,
      salesforce_docs: input.salesforce_docs,
    },
  };
}

function nativeRule(
  input: Omit<FlowQualityRule, "provenance" | "supported_families"> & {
    supported_families?: FlowQualityRule["supported_families"];
  },
): FlowQualityRule {
  return {
    ...input,
    supported_families: input.supported_families ?? allFamilies,
    provenance: { implementation: "sf-flow" },
  };
}

const scannerRules: FlowQualityRule[] = [
  scannerRule({
    id: "dml-in-loop",
    label: "DML in Loop",
    message:
      "Collect records during iteration and perform one create, update, or delete after the loop.",
    category: "performance",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: generationProfiles,
    authoring_constraint: "Never place Create, Update, or Delete Records on a loop iteration path.",
    code_analyzer: ["flow/DbInLoop"],
    salesforce_docs: [bestPractices],
  }),
  scannerRule({
    id: "soql-in-loop",
    label: "Get Records in Loop",
    message:
      "Load required records before iteration instead of issuing a Get Records operation for each item.",
    category: "performance",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: generationProfiles,
    authoring_constraint: "Move Get Records before loops and reuse the resulting collection.",
    code_analyzer: ["flow/DbInLoop"],
    salesforce_docs: [bestPractices],
  }),
  scannerRule({
    id: "hardcoded-id",
    label: "Hardcoded Salesforce ID",
    message:
      "Replace an org-specific record ID literal with an input, lookup, or configuration-backed value.",
    category: "reliability",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    authoring_constraint: "Do not emit 15- or 18-character Salesforce record ID literals.",
    code_analyzer: ["flow/HardcodedId"],
    salesforce_docs: [bestPractices],
  }),
  scannerRule({
    id: "hardcoded-secret",
    label: "Hardcoded Secret",
    message:
      "Move credential-like material to a supported secret or credential store and reference it indirectly.",
    category: "security",
    default_severity: "high",
    maturity: "beta",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    authoring_constraint:
      "Never place access tokens, private keys, or credential literals in Flow metadata.",
  }),
  scannerRule({
    id: "hardcoded-url",
    label: "Hardcoded URL",
    message:
      "Use a Named Credential or environment-aware configuration instead of embedding an endpoint URL.",
    category: "reliability",
    default_severity: "moderate",
    maturity: "stable",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    authoring_constraint:
      "Resolve service endpoints through Named Credentials or deployable configuration.",
  }),
  scannerRule({
    id: "unsafe-running-context",
    label: "Unsafe Running Context",
    message:
      "Use user context when possible, or narrowly isolate privileged work instead of running the whole Flow without sharing.",
    category: "security",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    supported_families: ["screen", "autolaunched"],
    authoring_constraint:
      "Default screen and caller-launched Flows to user context; justify every privilege elevation.",
    salesforce_docs: [contextSafety],
  }),
  scannerRule({
    id: "duplicate-dml",
    label: "Repeatable Screen DML",
    message:
      "Backward screen navigation can repeat a database change; prevent backtracking or move the write to a safe terminal path.",
    category: "reliability",
    default_severity: "moderate",
    maturity: "stable",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    supported_families: ["screen"],
    authoring_constraint:
      "Do not allow users to navigate backward across an irreversible database operation.",
    salesforce_docs: [bestPractices],
  }),
  scannerRule({
    id: "missing-fault-path",
    label: "Missing Fault Path",
    message:
      "Route failures from database and action elements to an explicit recovery, logging, or user-safe error path.",
    category: "reliability",
    default_severity: "moderate",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: generationProfiles,
    authoring_constraint: "Add explicit fault handling to every supported operation that can fail.",
    salesforce_docs: [bestPractices],
  }),
  scannerRule({
    id: "missing-null-handler",
    label: "Missing Get Records Null Handling",
    message:
      "Branch on an empty Get Records result before downstream elements dereference the returned record.",
    category: "reliability",
    default_severity: "moderate",
    maturity: "stable",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    authoring_constraint:
      "Follow each single-record lookup with a found/not-found decision when absence is possible.",
  }),
  scannerRule({
    id: "recursive-record-update",
    label: "Recursive Triggering Record Update",
    message:
      "An after-save path updates its triggering record and can re-enter automation; move same-record fields before save or add a proven recursion guard.",
    category: "reliability",
    default_severity: "moderate",
    maturity: "stable",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    supported_families: ["record-triggered"],
    authoring_constraint:
      "Do not update the triggering record from after-save without a deliberate recursion guard.",
    code_analyzer: ["flow/SameRecordUpdate"],
  }),
  scannerRule({
    id: "action-call-in-loop",
    label: "Action Call in Loop",
    message:
      "Invoke an action once with a collection-capable contract instead of calling it for every loop item.",
    category: "performance",
    default_severity: "moderate",
    maturity: "stable",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    authoring_constraint:
      "Keep Apex, external service, and other action calls outside loop iteration paths.",
  }),
  scannerRule({
    id: "get-record-all-fields",
    label: "Get Records Stores All Fields",
    message:
      "Select only the fields the Flow consumes rather than materializing the complete record shape.",
    category: "performance",
    default_severity: "moderate",
    maturity: "stable",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    authoring_constraint: "Declare the exact queried fields required by downstream logic.",
    salesforce_docs: [contextSafety],
  }),
  scannerRule({
    id: "invalid-api-version",
    label: "Outdated Flow API Version",
    message: "Set the Flow runtime API version to the project-supported baseline or later.",
    category: "correctness",
    default_severity: "moderate",
    maturity: "stable",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    authoring_constraint:
      "Use the SFDX project source API version for newly authored Flow metadata.",
  }),
  scannerRule({
    id: "missing-record-trigger-filter",
    label: "Missing Record Trigger Entry Criteria",
    message:
      "Add selective Start criteria so the record-triggered Flow does not execute for every matching record operation.",
    category: "performance",
    default_severity: "moderate",
    maturity: "beta",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    supported_families: ["record-triggered"],
    authoring_constraint: "Define selective entry criteria in the Start element.",
    code_analyzer: ["flow/TriggerEntryCriteria"],
  }),
  scannerRule({
    id: "same-record-field-updates",
    label: "Same-Record DML Update",
    message:
      "Assign same-record fields through $Record in before-save timing instead of issuing an Update Records operation.",
    category: "performance",
    default_severity: "moderate",
    maturity: "stable",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    supported_families: ["record-triggered"],
    authoring_constraint: "Use before-save $Record assignments for same-record field changes.",
    code_analyzer: ["flow/SameRecordUpdate"],
  }),
  scannerRule({
    id: "missing-flow-description",
    label: "Missing Flow Description",
    message:
      "Describe the Flow's purpose, trigger, main effect, and operational assumptions for future maintainers.",
    category: "maintainability",
    default_severity: "moderate",
    maturity: "stable",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    authoring_constraint: "Write a meaningful Flow-level description before the first validation.",
    salesforce_docs: [bestPractices],
  }),
  scannerRule({
    id: "unreachable-element",
    label: "Unreachable Element",
    message: "Connect or remove an element that cannot be reached from the Flow entry point.",
    category: "correctness",
    default_severity: "moderate",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: generationProfiles,
    authoring_constraint: "Ensure every executable element belongs to a path reachable from Start.",
  }),
  scannerRule({
    id: "unused-variable",
    label: "Unused Variable",
    message:
      "Remove a local variable that is neither part of the caller contract nor referenced by Flow logic.",
    category: "maintainability",
    default_severity: "low",
    maturity: "stable",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    authoring_constraint:
      "Declare only variables used by logic or an explicit input/output contract.",
  }),
  scannerRule({
    id: "missing-auto-layout",
    label: "Missing Auto Layout",
    message:
      "Use Auto-Layout metadata for newly generated Flows so Flow Builder can maintain a readable canvas.",
    category: "layout",
    default_severity: "low",
    maturity: "stable",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    authoring_constraint: "Set CanvasMode to AUTO_LAYOUT_CANVAS for new Flow metadata.",
  }),
  scannerRule({
    id: "missing-start-reference",
    label: "Missing Start Reference",
    message:
      "Connect Start to the first executable element; caller-launched and screen Flows require a runnable path.",
    category: "correctness",
    default_severity: "high",
    maturity: "beta",
    implementation: "implemented",
    engine: "quality",
    profiles: generationProfiles,
    authoring_constraint:
      "Connect Start to the first executable node unless an event or record trigger is intentionally the complete Flow.",
    code_analyzer: ["flow/MissingNextValueConnector"],
  }),
  ...reviewAndAuditScannerRules(),
];

function reviewAndAuditScannerRules(): FlowQualityRule[] {
  const implemented = (input: {
    id: (typeof LIGHTNING_FLOW_SCANNER_RULE_IDS)[number];
    label: string;
    message: string;
    category: FlowQualityCategory;
    severity?: FlowSeverity;
    maturity: "stable" | "beta";
    profiles: FlowQualityProfile[];
  }) =>
    scannerRule({
      id: input.id,
      label: input.label,
      message: input.message,
      category: input.category,
      default_severity: input.severity ?? "low",
      maturity: input.maturity,
      implementation: "implemented",
      engine: "quality",
      profiles: input.profiles,
    });
  return [
    implemented({
      id: "cognitive-complexity",
      label: "Cognitive Complexity",
      message: "Reduce nested decisions and loops or extract a focused subflow.",
      category: "maintainability",
      maturity: "beta",
      profiles: reviewProfiles,
    }),
    implemented({
      id: "excessive-cyclomatic-complexity",
      label: "Cyclomatic Complexity",
      message: "Reduce independent branches or split the automation into cohesive Flows.",
      category: "maintainability",
      maturity: "stable",
      profiles: reviewProfiles,
    }),
    implemented({
      id: "unspecified-trigger-order",
      label: "Unspecified Trigger Order",
      message: "Assign an explicit order when record-triggered automation sequencing matters.",
      category: "reliability",
      maturity: "stable",
      profiles: reviewProfiles,
    }),
    implemented({
      id: "record-id-as-string",
      label: "Record ID Passed as String",
      message:
        "Prefer a typed record input when the caller can provide the complete record contract.",
      category: "maintainability",
      maturity: "beta",
      profiles: reviewProfiles,
    }),
    implemented({
      id: "transform-instead-of-loop",
      label: "Transform Instead of Loop",
      message: "A collection-mapping loop can often be expressed more clearly with Transform.",
      category: "performance",
      maturity: "beta",
      profiles: reviewProfiles,
    }),
    implemented({
      id: "missing-metadata-description",
      label: "Missing Element Description",
      message: "Document the element's business purpose and non-obvious assumptions.",
      category: "maintainability",
      severity: "moderate",
      maturity: "beta",
      profiles: reviewProfiles,
    }),
    implemented({
      id: "unclear-api-naming",
      label: "Unclear Element API Name",
      message: "Replace copy-generated or generic API names with intent-revealing names.",
      category: "maintainability",
      severity: "moderate",
      maturity: "stable",
      profiles: reviewProfiles,
    }),
    implemented({
      id: "process-builder-usage",
      label: "Process Builder Metadata",
      message:
        "Treat legacy Process Builder metadata as a migration target rather than new Flow source.",
      category: "maintainability",
      severity: "high",
      maturity: "stable",
      profiles: auditProfiles,
    }),
    implemented({
      id: "inactive-flow",
      label: "Inactive Flow",
      message:
        "Review whether this inactive Flow is an intentional draft, retained version, or removable automation.",
      category: "maintainability",
      severity: "moderate",
      maturity: "stable",
      profiles: auditProfiles,
    }),
    implemented({
      id: "invalid-naming-convention",
      label: "Flow Naming Convention",
      message:
        "Use an API name with at least two clear alphanumeric segments separated by underscores.",
      category: "maintainability",
      severity: "high",
      maturity: "stable",
      profiles: auditProfiles,
    }),
  ];
}

const nativeRules: FlowQualityRule[] = [
  nativeRule({
    id: "xml-syntax",
    label: "XML Syntax",
    message: "Repair malformed XML before Flow analysis continues.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
  }),
  nativeRule({
    id: "flow-root",
    label: "Flow Root",
    message: "Use Flow as the root metadata element.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
  }),
  nativeRule({
    id: "required-core-metadata",
    label: "Required Core Metadata",
    message: "Provide the core metadata required by the local Flow lifecycle.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
  }),
  nativeRule({
    id: "core-flow-family",
    label: "Core Flow Family",
    message: "Align process, trigger, and required Start metadata for the selected core family.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
  }),
  nativeRule({
    id: "omni-channel-contract",
    label: "Omni-Channel Flow Contract",
    message: "Provide the required work-item input and a reachable, configured Route Work action.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
    supported_families: ["omni-channel"],
    authoring_constraint:
      "Use processType RoutingFlow, scalar Text input recordId, and reachable Route Work v2 with grounded service-channel and destination inputs; direct agents require fallback queues, skills require routing configurations, and no-route paths assign reasonForNotRouting.",
  }),
  nativeRule({
    id: "duplicate-name",
    label: "Duplicate API Name",
    message: "Give every Flow element and resource a unique API name.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
  }),
  nativeRule({
    id: "dangling-target",
    label: "Dangling Connector",
    message: "Point each connector at an existing Flow element.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
  }),
  nativeRule({
    id: "unresolved-reference",
    label: "Unresolved Reference",
    message: "Reference an existing Flow element, resource, or supported global.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
  }),
  nativeRule({
    id: "record-context",
    label: "Record Context",
    message: "Use $Record globals only where record-trigger context exists.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
  }),
  nativeRule({
    id: "element-not-allowed-before-save",
    label: "Before-Save Element",
    message: "Use only element types supported by before-save record-triggered Flows.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
  }),
  nativeRule({
    id: "conflicting-create-output-storage",
    label: "Conflicting Create Records Output",
    message:
      "Choose either an assigned record ID variable or automatic output storage for Create Records.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
    authoring_constraint:
      "Do not combine assignRecordIdToReference with storeOutputAutomatically on Create Records.",
  }),
  nativeRule({
    id: "invalid-async-path-configuration",
    label: "Invalid Asynchronous Path Configuration",
    message: "Use only metadata fields supported by an asynchronous-after-commit path.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
    supported_families: ["record-triggered"],
    authoring_constraint:
      "Keep AsyncAfterCommit paths free of label, time source, offset, record field, and batch-size metadata.",
  }),
  nativeRule({
    id: "missing-async-path-entry-guard",
    label: "Missing Asynchronous Path Entry Guard",
    message:
      "Require an update to newly meet entry criteria or use Is Changed before running asynchronously after commit.",
    category: "reliability",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
    supported_families: ["record-triggered"],
    authoring_constraint:
      "Guard update-triggered AsyncAfterCommit paths with changed-to-meet criteria or an Is Changed condition.",
  }),
  nativeRule({
    id: "invalid-start-filter-logic",
    label: "Invalid Start Filter Logic",
    message: "Use valid numbered AND/OR condition logic with balanced parentheses.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
    supported_families: ["record-triggered", "schedule-triggered"],
    authoring_constraint:
      "Reference valid condition indexes in custom Start filter logic and use balanced AND/OR expressions.",
  }),
  nativeRule({
    id: "invalid-record-filter",
    label: "Invalid Record Filter",
    message:
      "Use a supported FlowRecordFilter operator and a compatible literal or reference value.",
    category: "correctness",
    default_severity: "high",
    maturity: "stable",
    implementation: "implemented",
    engine: "core",
    profiles: allProfiles,
    authoring_constraint:
      "Use supported record-filter operators and values whose literal type is compatible with the operator.",
  }),
];

export const FLOW_QUALITY_RULES: FlowQualityRule[] = [...nativeRules, ...scannerRules];
export const FLOW_QUALITY_RULE_BY_ID = new Map(FLOW_QUALITY_RULES.map((rule) => [rule.id, rule]));

export function qualityRulesForProfile(profile: FlowQualityProfile): FlowQualityRule[] {
  return FLOW_QUALITY_RULES.filter(
    (rule) => rule.implementation === "implemented" && rule.profiles.includes(profile),
  );
}

export function generationConstraintsForFamily(family: FlowFamily) {
  return qualityRulesForProfile("generation")
    .filter(
      (rule) =>
        rule.authoring_constraint &&
        (rule.supported_families[0] === "all" ||
          (rule.supported_families as readonly string[]).includes(family)),
    )
    .map((rule) => ({
      rule_id: rule.id,
      severity: rule.default_severity,
      instruction: rule.authoring_constraint as string,
    }));
}
