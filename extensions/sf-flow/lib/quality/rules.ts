/* SPDX-License-Identifier: Apache-2.0 */
/** Independent SF Pi evaluators for generation-relevant Flow quality rules. */

import path from "node:path";
import type { FlowElement, FlowSeverity } from "../types.ts";
import { child, childText, descendants, type XmlNode } from "../xml.ts";
import {
  canReach,
  elementNode,
  firstDownstreamElement,
  isSameRecordUpdate,
  literalNodes,
  type FlowQualityFacts,
} from "./facts.ts";

export interface QualityReportInput {
  rule_id: string;
  message?: string;
  severity?: FlowSeverity;
  node?: XmlNode;
  element?: string;
}

export type QualityReporter = (finding: QualityReportInput) => void;
export type QualityEvaluator = (facts: FlowQualityFacts, report: QualityReporter) => void;

const ID_LITERAL = /(?<![A-Za-z0-9])[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?(?![A-Za-z0-9])/g;
const URL_LITERAL = /https?:\/\/[^\s<>{}"']+/gi;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b00D[A-Za-z0-9]{12,18}![A-Za-z0-9._~+/=-]{20,}\b/,
];
const DML_KINDS = new Set(["recordCreates", "recordUpdates", "recordDeletes"]);
const ACTION_KINDS = new Set(["actionCalls", "apexPluginCalls"]);

export const QUALITY_EVALUATORS: Record<string, QualityEvaluator> = {
  "hardcoded-id": (facts, report) => {
    for (const node of literalNodes(facts)) {
      const match = node.text.match(ID_LITERAL)?.[0];
      if (!match) continue;
      report({
        rule_id: "hardcoded-id",
        node,
        message: `Literal ${mask(match)} looks like an org-specific Salesforce ID.`,
      });
    }
  },

  "hardcoded-secret": (facts, report) => {
    for (const node of literalNodes(facts)) {
      if (!SECRET_PATTERNS.some((pattern) => pattern.test(node.text))) continue;
      report({
        rule_id: "hardcoded-secret",
        node,
        message:
          "Credential-like material appears directly in Flow metadata; move it to a supported credential store.",
      });
    }
  },

  "hardcoded-url": (facts, report) => {
    for (const node of literalNodes(facts)) {
      const match = node.text.match(URL_LITERAL)?.[0];
      if (!match) continue;
      report({
        rule_id: "hardcoded-url",
        node,
        message: `Endpoint ${clip(match)} is embedded in Flow metadata instead of environment-aware configuration.`,
      });
    }
  },

  "unsafe-running-context": (facts, report) => {
    const runInMode = facts.all_nodes.find((node) => node.name === "runInMode");
    if (runInMode?.text.trim() !== "SystemModeWithoutSharing") return;
    report({
      rule_id: "unsafe-running-context",
      node: runInMode,
      message:
        "The Flow runs in system context without sharing and can expose more data than its users can access.",
    });
  },

  "duplicate-dml": (facts, report) => {
    if (facts.model.family !== "screen") return;
    const backEnabledScreens = facts.model.elements.filter((element) => {
      if (element.kind !== "screens") return false;
      return childText(elementNode(facts, element) ?? facts.root, "allowBack") !== "false";
    });
    for (const element of facts.model.elements.filter((candidate) =>
      DML_KINDS.has(candidate.kind),
    )) {
      const downstreamScreen = backEnabledScreens.find((screen) =>
        canReach(facts.model, element.id, screen.id),
      );
      if (!downstreamScreen) continue;
      report({
        rule_id: "duplicate-dml",
        node: elementNode(facts, element),
        element: element.name,
        message: `${element.name} runs before back-enabled screen ${downstreamScreen.name}, so returning through the path can repeat the write.`,
      });
    }
  },

  "missing-null-handler": (facts, report) => {
    for (const element of facts.model.elements.filter(
      (candidate) => candidate.kind === "recordLookups",
    )) {
      const node = elementNode(facts, element);
      if (childText(node ?? facts.root, "getFirstRecordOnly") === "false") continue;
      const downstream = firstDownstreamElement(facts, element.id);
      if (!downstream || downstream.kind === "decisions") continue;
      report({
        rule_id: "missing-null-handler",
        node,
        element: element.name,
        message: `${element.name} continues directly to ${downstream.name} without a found/not-found decision.`,
      });
    }
  },

  "recursive-record-update": (facts, report) => {
    if (facts.model.trigger_type !== "RecordAfterSave") return;
    for (const element of facts.model.elements.filter((candidate) =>
      isSameRecordUpdate(facts, candidate),
    )) {
      report({
        rule_id: "recursive-record-update",
        node: elementNode(facts, element),
        element: element.name,
        message: `${element.name} updates the triggering record from an after-save path and can re-enter record automation.`,
      });
    }
  },

  "action-call-in-loop": (facts, report) => {
    forEachLoopMember(facts, ACTION_KINDS, (element, loopName) =>
      report({
        rule_id: "action-call-in-loop",
        node: elementNode(facts, element),
        element: element.name,
        message: `${element.name} invokes an action on the iteration path of ${loopName}.`,
      }),
    );
  },

  "get-record-all-fields": (facts, report) => {
    for (const element of facts.model.elements.filter(
      (candidate) => candidate.kind === "recordLookups",
    )) {
      const node = elementNode(facts, element);
      if (!node || childText(node, "storeOutputAutomatically") !== "true") continue;
      if (descendants(node).some((candidate) => candidate.name === "queriedFields")) continue;
      report({
        rule_id: "get-record-all-fields",
        node,
        element: element.name,
        message: `${element.name} automatically stores the complete record instead of an explicit field set.`,
      });
    }
  },

  "invalid-api-version": (facts, report) => {
    const node = child(facts.root, "apiVersion");
    const version = Number.parseFloat(node?.text.trim() ?? "0");
    if (Number.isFinite(version) && version >= 50) return;
    report({
      rule_id: "invalid-api-version",
      node: node ?? facts.root,
      message: `Flow API version ${node?.text.trim() || "missing"} is below the supported authoring baseline of 50.0.`,
    });
  },

  "missing-record-trigger-filter": (facts, report) => {
    if (facts.model.family !== "record-triggered") return;
    const start = child(facts.root, "start");
    if (!start) return;
    const hasFilter = descendants(start).some(
      (node) =>
        node.name === "filters" || node.name === "conditions" || node.name === "filterFormula",
    );
    if (hasFilter) return;
    report({
      rule_id: "missing-record-trigger-filter",
      node: start,
      message:
        "The record trigger has no entry criteria and can run for every selected record operation.",
    });
  },

  "same-record-field-updates": (facts, report) => {
    for (const element of facts.model.elements.filter((candidate) =>
      isSameRecordUpdate(facts, candidate),
    )) {
      report({
        rule_id: "same-record-field-updates",
        node: elementNode(facts, element),
        element: element.name,
        message: `${element.name} writes the triggering record with DML instead of using before-save $Record assignment where applicable.`,
      });
    }
  },

  "missing-flow-description": (facts, report) => {
    if (childText(facts.root, "description")) return;
    report({
      rule_id: "missing-flow-description",
      node: facts.root,
      message: "The Flow has no description explaining its trigger, purpose, and primary effect.",
    });
  },

  "unused-variable": (facts, report) => {
    const referenced = new Set(
      facts.model.references.map((reference) => reference.value.split(".")[0]),
    );
    for (const variable of facts.model.resources.filter(
      (resource) => resource.kind === "variables" && !resource.input && !resource.output,
    )) {
      if (referenced.has(variable.name)) continue;
      report({
        rule_id: "unused-variable",
        node: facts.element_nodes.get(variable.name),
        element: variable.name,
        message: `${variable.name} is a local variable that no Flow reference consumes.`,
      });
    }
  },

  "missing-auto-layout": (facts, report) => {
    if (facts.process_metadata.get("CanvasMode") === "AUTO_LAYOUT_CANVAS") return;
    report({
      rule_id: "missing-auto-layout",
      node: facts.root,
      message: "The Flow does not declare AUTO_LAYOUT_CANVAS for maintainable Flow Builder layout.",
    });
  },

  "missing-start-reference": (facts, report) => {
    const executable = facts.model.elements.filter((element) => element.kind !== "start");
    const hasStartEdge = facts.model.connectors.some(
      (connector) => connector.from === "__start__" && connector.to,
    );
    if (executable.length && hasStartEdge) return;
    if (!executable.length && !["autolaunched", "screen"].includes(facts.model.family)) return;
    const start =
      child(facts.root, "start") ?? child(facts.root, "startElementReference") ?? facts.root;
    report({
      rule_id: "missing-start-reference",
      node: start,
      message: executable.length
        ? "Executable elements exist, but Start does not identify the first node to run."
        : "The Flow has no executable element after Start and cannot run.",
    });
  },

  "cognitive-complexity": (facts, report) => {
    const complexity = cognitiveComplexity(facts);
    if (complexity <= 15) return;
    report({
      rule_id: "cognitive-complexity",
      node: facts.root,
      message: `Nested branch and loop structure has cognitive complexity ${complexity}, above the review threshold of 15.`,
    });
  },

  "excessive-cyclomatic-complexity": (facts, report) => {
    const complexity = cyclomaticComplexity(facts);
    if (complexity <= 25) return;
    report({
      rule_id: "excessive-cyclomatic-complexity",
      node: facts.root,
      message: `Flow control paths produce cyclomatic complexity ${complexity}, above the review threshold of 25.`,
    });
  },

  "unspecified-trigger-order": (facts, report) => {
    if (facts.model.family !== "record-triggered" || childText(facts.root, "triggerOrder")) return;
    report({
      rule_id: "unspecified-trigger-order",
      node: child(facts.root, "start") ?? facts.root,
      message:
        "The record-triggered Flow does not declare triggerOrder for deterministic sequencing.",
    });
  },

  "record-id-as-string": (facts, report) => {
    if (facts.model.family === "omni-channel") return;
    for (const variable of facts.model.resources.filter(
      (resource) => resource.kind === "variables" && resource.input,
    )) {
      if (!/(?:^recordid$|id$|_id$)/i.test(variable.name)) continue;
      const node = facts.element_nodes.get(variable.name);
      if (!node || childText(node, "dataType") !== "String") continue;
      report({
        rule_id: "record-id-as-string",
        node,
        element: variable.name,
        message: `${variable.name} is an input String that appears to carry a record ID rather than a typed record contract.`,
      });
    }
  },

  "transform-instead-of-loop": (facts, report) => {
    for (const [loopName, body] of facts.loop_bodies) {
      const members = [...body]
        .map((id) => facts.model.elements.find((element) => element.id === id))
        .filter((element): element is FlowElement => Boolean(element));
      if (!members.length || members.some((element) => element.kind !== "assignments")) continue;
      const loop = facts.model.elements.find((element) => element.id === loopName);
      report({
        rule_id: "transform-instead-of-loop",
        node: loop ? elementNode(facts, loop) : facts.root,
        element: loopName,
        message: `${loopName} only maps values through Assignment elements and is a candidate for Transform.`,
      });
    }
  },

  "missing-metadata-description": (facts, report) => {
    for (const element of facts.model.elements.filter((candidate) => candidate.kind !== "start")) {
      const node = elementNode(facts, element);
      if (!node || childText(node, "description")) continue;
      report({
        rule_id: "missing-metadata-description",
        node,
        element: element.name,
        message: `${element.name} has no description of its business purpose.`,
      });
    }
  },

  "unclear-api-naming": (facts, report) => {
    const unclear = /^(?:copy(?:_\d+)?_of_|element_?\d*$|assignment_?\d*$|decision_?\d*$)/i;
    for (const element of facts.model.elements.filter((candidate) => candidate.kind !== "start")) {
      if (!unclear.test(element.name)) continue;
      report({
        rule_id: "unclear-api-naming",
        node: elementNode(facts, element),
        element: element.name,
        message: `${element.name} looks generated or generic rather than intent-revealing.`,
      });
    }
  },

  "process-builder-usage": (facts, report) => {
    if (!new Set(["Workflow", "InvocableProcess"]).has(facts.model.process_type ?? "")) return;
    report({
      rule_id: "process-builder-usage",
      node: child(facts.root, "processType") ?? facts.root,
      message: `processType ${facts.model.process_type} represents legacy Process Builder automation.`,
    });
  },

  "inactive-flow": (facts, report) => {
    const status = child(facts.root, "status");
    if (status?.text.trim() === "Active") return;
    report({
      rule_id: "inactive-flow",
      node: status ?? facts.root,
      message: `Flow status is ${status?.text.trim() || "missing"}; confirm that the inactive source is intentional.`,
    });
  },

  "invalid-naming-convention": (facts, report) => {
    const name = flowApiName(facts.model.file);
    if (/^[A-Za-z0-9]+_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*$/.test(name)) return;
    report({
      rule_id: "invalid-naming-convention",
      node: facts.root,
      message: `Flow API name ${name} does not use two or more clear underscore-separated segments.`,
    });
  },
};

function forEachLoopMember(
  facts: FlowQualityFacts,
  kinds: Set<string>,
  visit: (element: FlowElement, loopName: string) => void,
): void {
  for (const [loopName, body] of facts.loop_bodies) {
    for (const id of body) {
      const element = facts.model.elements.find((candidate) => candidate.id === id);
      if (element && kinds.has(element.kind)) visit(element, loopName);
    }
  }
}

function cognitiveComplexity(facts: FlowQualityFacts): number {
  const startTargets = facts.model.connectors
    .filter((connector) => connector.from === "__start__" && connector.to)
    .map((connector) => connector.to as string);
  const contributions = new Map<string, number>();
  const visitedDepth = new Map<string, number>();
  let total = 0;
  const visit = (id: string, depth: number, pathIds: Set<string>) => {
    if (pathIds.has(id)) return;
    const priorDepth = visitedDepth.get(id);
    if (priorDepth !== undefined && priorDepth >= depth) return;
    visitedDepth.set(id, depth);
    const element = facts.model.elements.find((candidate) => candidate.id === id);
    if (!element) return;
    const branch = element.kind === "decisions" || element.kind === "loops";
    if (branch) {
      const contribution = 1 + depth;
      const priorContribution = contributions.get(id) ?? 0;
      if (contribution > priorContribution) {
        total += contribution - priorContribution;
        contributions.set(id, contribution);
      }
    }
    const nextPath = new Set(pathIds).add(id);
    for (const connector of facts.model.connectors.filter(
      (candidate) => candidate.from === id && candidate.to,
    )) {
      visit(connector.to as string, branch ? depth + 1 : depth, nextPath);
    }
  };
  for (const target of startTargets) visit(target, 0, new Set());
  return total;
}

function cyclomaticComplexity(facts: FlowQualityFacts): number {
  let complexity = 1;
  for (const element of facts.model.elements) {
    const normalEdges = facts.model.connectors.filter(
      (connector) => connector.from === element.id && connector.to && !connector.fault,
    ).length;
    if (normalEdges > 1) complexity += normalEdges - 1;
    if (element.kind === "loops") complexity += 1;
  }
  return complexity;
}

function flowApiName(file: string): string {
  const base = path.basename(file);
  return base.replace(/\.flow-meta\.xml$|\.flow$/i, "");
}

function mask(value: string): string {
  return value.length <= 8 ? "[redacted]" : `${value.slice(0, 3)}…${value.slice(-3)}`;
}

function clip(value: string, max = 48): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
