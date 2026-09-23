/* SPDX-License-Identifier: Apache-2.0 */
/** Fast local Flow diagnostics over a small, source-located XML model. */

import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  FlowAnalysis,
  FlowConnector,
  FlowElement,
  FlowFamily,
  FlowFinding,
  FlowModel,
  FlowResource,
  FlowSeverity,
} from "./types.ts";
import { findFlowConfigurationIssues, FLOW_CONFIGURATION_RULE_IDS } from "./configuration.ts";
import { omniActionInputValue, omniRoutingLabel, runOmniChannelChecks } from "./omni-analyzer.ts";
import { child, childText, descendants, parseFlowXml, type XmlNode } from "./xml.ts";
import { FLOW_QUALITY_RULES, type FlowQualityProfile } from "./quality/catalog.ts";
import { buildFlowQualityFacts } from "./quality/facts.ts";
import { runFlowQuality } from "./quality/runner.ts";

export const MAX_FLOW_BYTES = 2 * 1024 * 1024;

const RULES = [
  "xml-syntax",
  "flow-root",
  "required-core-metadata",
  "core-flow-family",
  "omni-channel-contract",
  "duplicate-name",
  "dangling-target",
  "unreachable-element",
  "unresolved-reference",
  "record-context",
  ...FLOW_CONFIGURATION_RULE_IDS,
  "dml-in-loop",
  "soql-in-loop",
  "missing-fault-path",
  "element-not-allowed-before-save",
] as const;

const ELEMENT_KINDS = new Set([
  "actionCalls",
  "apexPluginCalls",
  "assignments",
  "collectionProcessors",
  "customErrors",
  "decisions",
  "loops",
  "recordCreates",
  "recordDeletes",
  "recordLookups",
  "recordRollbacks",
  "recordUpdates",
  "screens",
  "subflows",
  "transforms",
  "waits",
]);
const RESOURCE_KINDS = new Set([
  "choices",
  "constants",
  "dynamicChoiceSets",
  "formulas",
  "stages",
  "textTemplates",
  "variables",
]);
const DATABASE_KINDS = new Set([
  "recordCreates",
  "recordDeletes",
  "recordLookups",
  "recordUpdates",
]);
const FAULTABLE_MODERATE = new Set([
  "actionCalls",
  "apexPluginCalls",
  "recordCreates",
  "recordDeletes",
  "recordUpdates",
]);
const BEFORE_SAVE_ALLOWED = new Set([
  "assignments",
  "collectionProcessors",
  "customErrors",
  "decisions",
  "recordLookups",
  "loops",
]);
const REFERENCE_FIELDS = new Set([
  "assignToReference",
  "collectionReference",
  "elementReference",
  "inputReference",
  "leftValueReference",
  "outputReference",
  "recordReference",
  "sourceReference",
  "valueReference",
]);
const KNOWN_GLOBALS = new Set([
  "$Api",
  "$Flow",
  "$GlobalConstant",
  "$Label",
  "$Organization",
  "$Permission",
  "$Profile",
  "$Record",
  "$Record__Prior",
  "$Setup",
  "$System",
  "$User",
  "$UserRole",
]);

export interface AnalyzeFlowOptions {
  profile?: FlowQualityProfile;
}

export function analyzeFlowSource(
  source: string,
  file: string,
  options: AnalyzeFlowOptions = {},
): FlowAnalysis {
  const profile = options.profile ?? "generation";
  const findings: FlowFinding[] = [];
  const ran: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const report = (
    rule_id: string,
    severity: FlowSeverity,
    message: string,
    node?: XmlNode,
    element?: string,
  ) => {
    findings.push({
      rule_id,
      severity,
      message,
      line: node?.line ?? 1,
      column: node?.column ?? 1,
      element,
    });
  };

  const parsed = parseFlowXml(source);
  ran.push("xml-syntax");
  if (parsed.errors.length) {
    for (const error of parsed.errors) {
      findings.push({
        rule_id: "xml-syntax",
        severity: "high",
        message: error.message,
        line: error.line,
        column: error.column,
      });
    }
    skipUnrunnableProfileRules(profile, ran, skipped, "XML did not parse");
    return finish(file, "unknown", findings, { ran, skipped });
  }

  const root = parsed.root;
  ran.push("flow-root");
  if (!root) {
    report("flow-root", "high", "Flow metadata has no XML root element.");
    skipUnrunnableProfileRules(profile, ran, skipped, "XML has no root");
    return finish(file, "unknown", findings, { ran, skipped });
  }
  if (root.name !== "Flow") {
    report("flow-root", "high", `Expected <Flow> root but found <${root.name}>.`, root);
    skipUnrunnableProfileRules(profile, ran, skipped, "root is not Flow");
    return finish(file, "unknown", findings, { ran, skipped });
  }

  const model = buildModel(root, file, source);
  runRequiredMetadata(root, model, report);
  ran.push("required-core-metadata");
  runFamilyChecks(root, model, report, skipped);
  ran.push("core-flow-family");
  if (model.family === "omni-channel") ran.push("omni-channel-contract");
  runDuplicateNames(model, report);
  ran.push("duplicate-name");
  runConnectorChecks(model, report);
  ran.push("dangling-target", "unreachable-element");
  const canProveRecordContext = model.family !== "specialized" && model.family !== "unknown";
  runReferenceChecks(model, report, canProveRecordContext);
  ran.push("unresolved-reference");
  if (canProveRecordContext) ran.push("record-context");
  else
    skipped.push({
      id: "record-context",
      reason: "specialized Flow record context is not inferred",
    });
  for (const issue of findFlowConfigurationIssues(root)) {
    report(issue.rule_id, "high", issue.message, issue.node, issue.element);
  }
  ran.push(...FLOW_CONFIGURATION_RULE_IDS);
  runLoopChecks(model, report);
  ran.push("dml-in-loop", "soql-in-loop");
  runFaultChecks(model, report);
  ran.push("missing-fault-path");
  runBeforeSaveChecks(model, report);
  ran.push("element-not-allowed-before-save");

  const quality = runFlowQuality(buildFlowQualityFacts(source, root, model), profile);
  findings.push(...quality.findings);
  ran.push(...quality.ran);
  skipped.push(...quality.skipped);

  const result = finish(file, model.family, findings, { ran, skipped });
  result.model = model;
  return result;
}

export async function analyzeFlowFile(
  input: string,
  cwd: string,
  options: AnalyzeFlowOptions = {},
): Promise<FlowAnalysis> {
  const file = await resolveFlowFile(input, cwd);
  const source = await readFile(file.absolute, "utf8");
  if (Buffer.byteLength(source) > MAX_FLOW_BYTES) {
    throw new Error(`Flow file exceeds the ${MAX_FLOW_BYTES}-byte limit.`);
  }
  return analyzeFlowSource(source, file.display, options);
}

export async function resolveFlowFile(
  input: string,
  cwd: string,
): Promise<{ absolute: string; display: string }> {
  const normalized = input.startsWith("@") ? input.slice(1) : input;
  if (!normalized || normalized.includes("\0") || normalized.split(/[\\/]+/).includes("..")) {
    throw new Error("file must be a workspace-contained Flow metadata path");
  }
  const workspace = await realpath(cwd);
  const candidate = path.resolve(workspace, normalized);
  const absolute = await realpath(candidate).catch(() => {
    throw new Error(`Flow file not found: ${normalized}`);
  });
  const relative = path.relative(workspace, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("file must stay inside the current workspace");
  }
  const stats = await lstat(absolute);
  if (!stats.isFile()) throw new Error("file must name one regular file");
  if (!isFlowFile(absolute)) throw new Error("file must end in .flow-meta.xml or .flow");
  if (stats.size > MAX_FLOW_BYTES)
    throw new Error(`Flow file exceeds the ${MAX_FLOW_BYTES}-byte limit.`);
  return { absolute, display: relative || path.basename(absolute) };
}

export function isFlowFile(file: string): boolean {
  return file.endsWith(".flow-meta.xml") || file.endsWith(".flow");
}

function buildModel(root: XmlNode, file: string, source: string): FlowModel {
  const processType = childText(root, "processType");
  const startNode = child(root, "start");
  const triggerType = startNode ? childText(startNode, "triggerType") : undefined;
  const family = flowFamily(processType, triggerType);
  const elements: FlowElement[] = [];
  const connectors: FlowConnector[] = [];
  const resources: FlowResource[] = [];

  if (startNode) {
    elements.push({
      id: "__start__",
      name: "Start",
      kind: "start",
      line: startNode.line,
      column: startNode.column,
    });
    connectors.push(...directConnectorsFor(startNode, "__start__"));
    for (const scheduledPath of startNode.children.filter(
      (candidate) => candidate.name === "scheduledPaths",
    )) {
      const name = childText(scheduledPath, "name") ?? `scheduledPaths@${scheduledPath.line}`;
      const asyncAfterCommit = childText(scheduledPath, "pathType") === "AsyncAfterCommit";
      elements.push({
        id: name,
        name,
        kind: "scheduledPaths",
        label: childText(scheduledPath, "label") ?? name.replaceAll("_", " "),
        detail: asyncAfterCommit ? "after commit" : scheduledPathDetail(scheduledPath),
        line: scheduledPath.line,
        column: scheduledPath.column,
      });
      connectors.push({
        from: "__start__",
        to: name,
        kind: "scheduledPathConnector",
        label: asyncAfterCommit ? "Async" : "Scheduled",
        fault: false,
        line: scheduledPath.line,
        column: scheduledPath.column,
      });
      connectors.push(...directConnectorsFor(scheduledPath, name));
    }
  }
  const legacyStart = child(root, "startElementReference");
  if (legacyStart?.text.trim()) {
    connectors.push({
      from: "__start__",
      to: legacyStart.text.trim(),
      kind: "startElementReference",
      fault: false,
      line: legacyStart.line,
      column: legacyStart.column,
    });
  }

  for (const node of root.children) {
    if (ELEMENT_KINDS.has(node.name)) {
      const name = childText(node, "name") ?? `${node.name}@${node.line}`;
      elements.push({
        id: name,
        name,
        kind: node.name,
        label: childText(node, "label"),
        detail: elementDetail(node),
        line: node.line,
        column: node.column,
      });
      connectors.push(...connectorsFor(node, name));
      if (node.name === "screens") {
        for (const field of node.children.filter((candidate) => candidate.name === "fields")) {
          const fieldName = childText(field, "name");
          if (!fieldName) continue;
          resources.push({
            name: fieldName,
            kind: "screenField",
            line: field.line,
            column: field.column,
          });
        }
      }
    } else if (RESOURCE_KINDS.has(node.name)) {
      const name = childText(node, "name");
      if (!name) continue;
      resources.push({
        name,
        kind: node.name,
        line: node.line,
        column: node.column,
        input: childText(node, "isInput") === "true",
        output: childText(node, "isOutput") === "true",
      });
    }
  }

  const references = descendants(root)
    .filter((node) => REFERENCE_FIELDS.has(node.name) && node.text.trim())
    .map((node) => ({
      value: node.text.trim(),
      line: node.line,
      column: node.column,
      owner: ownerName(node),
    }));
  const seenReference = new Set(
    references.map((reference) => `${reference.line}:${reference.value}`),
  );
  for (const match of source.matchAll(/\{!\s*([^}\s]+)\s*}/g)) {
    const value = match[1];
    const line = source.slice(0, match.index).split("\n").length;
    const column = match.index - source.lastIndexOf("\n", match.index - 1);
    const key = `${line}:${value}`;
    if (!seenReference.has(key)) references.push({ value, line, column, owner: undefined });
  }

  return {
    file,
    label: childText(root, "label"),
    api_version: childText(root, "apiVersion"),
    process_type: processType,
    trigger_type: triggerType,
    record_trigger_type: startNode ? childText(startNode, "recordTriggerType") : undefined,
    object: startNode ? childText(startNode, "object") : undefined,
    start_criteria: startNode
      ? startNode.children
          .filter((candidate) => candidate.name === "filters")
          .map(filterDetail)
          .filter((value): value is string => Boolean(value))
      : undefined,
    family,
    elements,
    connectors,
    resources,
    references,
  };
}

function connectorsFor(node: XmlNode, from: string): FlowConnector[] {
  return descendants(node)
    .filter(isConnectorNode)
    .map((candidate) => flowConnector(candidate, from));
}

function directConnectorsFor(node: XmlNode, from: string): FlowConnector[] {
  return node.children.filter(isConnectorNode).map((candidate) => flowConnector(candidate, from));
}

function isConnectorNode(node: XmlNode): boolean {
  return /Connector$/.test(node.name) || node.name === "connector";
}

function flowConnector(node: XmlNode, from: string): FlowConnector {
  return {
    from,
    to: childText(node, "targetReference"),
    kind: node.name,
    label: semanticConnectorLabel(node),
    fault: node.name === "faultConnector",
    line: node.line,
    column: node.column,
  };
}

function scheduledPathDetail(node: XmlNode): string | undefined {
  const offset = childText(node, "offsetNumber");
  const unit = childText(node, "offsetUnit")?.toLowerCase();
  const source = childText(node, "timeSource");
  return (
    [offset && unit ? `${offset} ${unit}` : undefined, source].filter(Boolean).join(" · ") ||
    undefined
  );
}

function semanticConnectorLabel(connector: XmlNode): string | undefined {
  if (connector.name === "faultConnector") return "Fault";
  if (connector.name === "nextValueConnector") return "For each";
  if (connector.name === "noMoreValuesConnector") return "After last";
  if (connector.name === "defaultConnector") {
    return connector.parent ? childText(connector.parent, "defaultConnectorLabel") : undefined;
  }
  if (connector.name === "connector" && connector.parent?.name === "rules") {
    return childText(connector.parent, "label") ?? childText(connector.parent, "name");
  }
  return undefined;
}

function elementDetail(node: XmlNode): string | undefined {
  if (node.name === "assignments") {
    const items = node.children
      .filter((candidate) => candidate.name === "assignmentItems")
      .slice(0, 2)
      .map((item) => {
        const target = childText(item, "assignToReference");
        const operator = childText(item, "operator");
        const value = referenceOrValue(child(item, "value"));
        if (!target) return undefined;
        if (operator === "Add") return `${target} += ${value ?? "value"}`;
        if (operator === "Subtract") return `${target} -= ${value ?? "value"}`;
        return value ? `${target} = ${value}` : target;
      })
      .filter((value): value is string => Boolean(value));
    return items.join(", ") || undefined;
  }
  if (node.name === "recordLookups") {
    const object = childText(node, "object") ?? "records";
    const filters = node.children
      .filter((candidate) => candidate.name === "filters")
      .slice(0, 2)
      .map(filterDetail)
      .filter((value): value is string => Boolean(value));
    return [object, ...filters].join(" · ");
  }
  if (node.name === "recordCreates") return childText(node, "object") ?? "record";
  if (node.name === "recordUpdates") {
    return (
      childText(node, "object") ??
      childText(node, "inputReference") ??
      childText(node, "recordReference") ??
      "record"
    );
  }
  if (node.name === "recordDeletes") {
    return childText(node, "object") ?? childText(node, "inputReference") ?? "record";
  }
  if (node.name === "loops") return childText(node, "collectionReference");
  if (node.name === "decisions") {
    const outcomes = node.children.filter((candidate) => candidate.name === "rules").length + 1;
    return `${outcomes} outcomes`;
  }
  if (node.name === "actionCalls") {
    const action = childText(node, "actionName") ?? childText(node, "actionType");
    if (action === "routeWork") {
      const routingType = omniActionInputValue(node, "routingType");
      return [action, omniRoutingLabel(routingType)].filter(Boolean).join(" · ");
    }
    return action;
  }
  if (node.name === "subflows") return childText(node, "flowName");
  if (node.name === "screens") {
    const fields = node.children.filter((candidate) => candidate.name === "fields").length;
    return fields ? `${fields} fields` : undefined;
  }
  return undefined;
}

function filterDetail(filter: XmlNode): string | undefined {
  const field = childText(filter, "field");
  const operator = childText(filter, "operator");
  const value = referenceOrValue(child(filter, "value"));
  if (!field) return undefined;
  if (operator === "IsNull" && value === "true") return `${field} is blank`;
  if (operator === "IsNull" && value === "false") return `${field} has value`;
  return [field, operatorWord(operator), value].filter(Boolean).join(" ");
}

function referenceOrValue(value: XmlNode | undefined): string | undefined {
  if (!value) return undefined;
  for (const name of [
    "elementReference",
    "stringValue",
    "numberValue",
    "booleanValue",
    "dateValue",
    "dateTimeValue",
  ]) {
    const text = childText(value, name);
    if (text !== undefined) return text;
  }
  return undefined;
}

function operatorWord(operator: string | undefined): string | undefined {
  if (operator === "EqualTo") return "=";
  if (operator === "NotEqualTo") return "≠";
  if (operator === "IsNull") return "is null";
  if (operator === "GreaterThan") return ">";
  if (operator === "GreaterThanOrEqualTo") return "≥";
  if (operator === "LessThan") return "<";
  if (operator === "LessThanOrEqualTo") return "≤";
  return operator;
}

function flowFamily(processType?: string, triggerType?: string): FlowFamily {
  if (processType === "Flow") return "screen";
  if (processType === "RoutingFlow") return "omni-channel";
  if (processType !== "AutoLaunchedFlow") return processType ? "specialized" : "unknown";
  if (["RecordBeforeSave", "RecordBeforeDelete", "RecordAfterSave"].includes(triggerType ?? "")) {
    return "record-triggered";
  }
  if (triggerType === "Scheduled") return "schedule-triggered";
  if (triggerType === "PlatformEvent") return "platform-event-triggered";
  if (!triggerType || triggerType === "None") return "autolaunched";
  return "specialized";
}

function runRequiredMetadata(root: XmlNode, model: FlowModel, report: Report): void {
  for (const name of ["apiVersion", "label", "processType", "status"] as const) {
    if (!childText(root, name)) {
      report(
        "required-core-metadata",
        "high",
        `Flow is missing required <${name}> metadata.`,
        root,
      );
    }
  }
  if (!model.elements.some((element) => element.kind === "start")) {
    report("required-core-metadata", "high", "Flow has no <start> element.", root);
  }
}

function runFamilyChecks(
  root: XmlNode,
  model: FlowModel,
  report: Report,
  skipped: Array<{ id: string; reason: string }>,
): void {
  const start = child(root, "start");
  if (model.family === "specialized" || model.family === "unknown") {
    skipped.push({
      id: "core-flow-family-detail",
      reason: `local V1 does not infer specialized process/trigger semantics (${model.process_type ?? "unknown"}/${model.trigger_type ?? "none"})`,
    });
    return;
  }
  if (model.family === "screen" && model.trigger_type && model.trigger_type !== "None") {
    report(
      "core-flow-family",
      "high",
      "Screen Flow must not declare an autolaunched trigger.",
      start,
    );
  }
  if (model.family === "screen") {
    for (const screen of root.children.filter((node) => node.name === "screens")) {
      if (
        childText(screen, "allowBack") === "false" &&
        childText(screen, "allowFinish") === "false"
      ) {
        report(
          "core-flow-family",
          "high",
          "A Screen can disable allowBack or allowFinish, but not both.",
          screen,
          childText(screen, "name"),
        );
      }
    }
  }
  if (model.family !== "screen") {
    const screen = model.elements.find((element) => element.kind === "screens");
    if (screen) {
      reportAt(
        "core-flow-family",
        "high",
        "Autolaunched Flow cannot contain a Screen element.",
        screen,
        report,
      );
    }
  }
  if (model.family === "record-triggered") {
    if (!model.object)
      report("core-flow-family", "high", "Record-triggered Flow requires a start object.", start);
    if (!model.record_trigger_type) {
      report(
        "core-flow-family",
        "high",
        "Record-triggered Flow requires <recordTriggerType>.",
        start,
      );
    }
  }
  if (model.family === "schedule-triggered" && start && !child(start, "schedule")) {
    report("core-flow-family", "high", "Schedule-triggered Flow requires <schedule>.", start);
  }
  if (model.family === "platform-event-triggered" && !model.object) {
    report(
      "core-flow-family",
      "high",
      "Platform event-triggered Flow requires an event object.",
      start,
    );
  }
  if (
    model.family === "platform-event-triggered" &&
    start?.children.some((node) => node.name === "filters")
  ) {
    report(
      "core-flow-family",
      "high",
      "Platform event-triggered Flow does not support Start filters.",
      start,
    );
  }
  if (model.family === "omni-channel") runOmniChannelChecks(root, model, report);
}

function runDuplicateNames(model: FlowModel, report: Report): void {
  const seen = new Map<string, FlowElement | FlowResource>();
  for (const item of [
    ...model.elements.filter((element) => element.kind !== "start"),
    ...model.resources,
  ]) {
    const key = item.name.toLowerCase();
    const prior = seen.get(key);
    if (prior) {
      reportAt(
        "duplicate-name",
        "high",
        `API name "${item.name}" duplicates a declaration on line ${prior.line}.`,
        item,
        report,
      );
    } else {
      seen.set(key, item);
    }
  }
}

function runConnectorChecks(model: FlowModel, report: Report): void {
  const names = new Set(model.elements.map((element) => element.id));
  for (const connector of model.connectors) {
    if (!connector.to) {
      reportAt(
        "dangling-target",
        "high",
        `${connector.kind} from "${displayElement(model, connector.from)}" has no targetReference.`,
        connector,
        report,
      );
    } else if (!names.has(connector.to)) {
      reportAt(
        "dangling-target",
        "high",
        `Connector from "${displayElement(model, connector.from)}" targets missing element "${connector.to}".`,
        connector,
        report,
      );
    }
  }

  const start = model.elements.find((element) => element.kind === "start");
  if (!start) return;
  const reached = reach(model, [start.id]);
  for (const element of model.elements) {
    if (element.kind === "start" || reached.has(element.id)) continue;
    reportAt(
      "unreachable-element",
      "moderate",
      `${elementLabel(element)} is unreachable from Start.`,
      element,
      report,
    );
  }
}

function runReferenceChecks(
  model: FlowModel,
  report: Report,
  canProveRecordContext: boolean,
): void {
  const names = new Set([
    ...model.elements.map((element) => element.name),
    ...model.resources.map((resource) => resource.name),
  ]);
  const recordContext = [
    "record-triggered",
    "schedule-triggered",
    "platform-event-triggered",
  ].includes(model.family);
  const reported = new Set<string>();
  for (const reference of model.references) {
    const first = reference.value.split(".")[0].replace(/\[\$EachItem\]$/u, "");
    const key = `${reference.line}:${reference.column}:${first}`;
    if (reported.has(key)) continue;
    if (first.startsWith("$")) {
      if (!KNOWN_GLOBALS.has(first)) {
        reportReference(
          "unresolved-reference",
          "high",
          `Unknown global reference "${first}".`,
          reference,
          report,
        );
      } else if (
        canProveRecordContext &&
        (first === "$Record" || first === "$Record__Prior") &&
        !recordContext
      ) {
        reportReference(
          "record-context",
          "high",
          `${first} is unavailable for the ${model.family} Flow context.`,
          reference,
          report,
        );
      }
      reported.add(key);
      continue;
    }
    if (!names.has(first)) {
      reportReference(
        "unresolved-reference",
        "high",
        `Reference "${reference.value}" has no local element or resource named "${first}".`,
        reference,
        report,
      );
      reported.add(key);
    }
  }
}

function runLoopChecks(model: FlowModel, report: Report): void {
  for (const loop of model.elements.filter((element) => element.kind === "loops")) {
    const entries = model.connectors
      .filter(
        (connector): connector is FlowConnector & { to: string } =>
          connector.from === loop.id &&
          connector.kind === "nextValueConnector" &&
          typeof connector.to === "string",
      )
      .map((connector) => connector.to);
    const body = reach(model, entries, loop.id);
    for (const id of body) {
      const element = model.elements.find((candidate) => candidate.id === id);
      if (!element || !DATABASE_KINDS.has(element.kind)) continue;
      const ruleId = element.kind === "recordLookups" ? "soql-in-loop" : "dml-in-loop";
      reportAt(
        ruleId,
        "high",
        `${elementLabel(element)} runs inside loop "${loop.name}". Collect values and perform one database operation after the loop.`,
        element,
        report,
      );
    }
  }
}

function runFaultChecks(model: FlowModel, report: Report): void {
  for (const element of model.elements) {
    if (
      model.family === "omni-channel" &&
      element.kind === "actionCalls" &&
      element.detail?.startsWith("routeWork")
    ) {
      continue;
    }
    const severity =
      element.kind === "recordLookups"
        ? "low"
        : FAULTABLE_MODERATE.has(element.kind)
          ? "moderate"
          : undefined;
    if (!severity) continue;
    const hasFault = model.connectors.some(
      (connector) => connector.from === element.id && connector.fault && connector.to,
    );
    if (!hasFault) {
      reportAt(
        "missing-fault-path",
        severity,
        `${elementLabel(element)} has no fault path.`,
        element,
        report,
      );
    }
  }
}

function runBeforeSaveChecks(model: FlowModel, report: Report): void {
  if (model.trigger_type !== "RecordBeforeSave") return;
  for (const element of model.elements) {
    if (element.kind === "start" || BEFORE_SAVE_ALLOWED.has(element.kind)) continue;
    reportAt(
      "element-not-allowed-before-save",
      "high",
      `${elementLabel(element)} is not supported in a before-save record-triggered Flow.`,
      element,
      report,
    );
  }
}

function reach(model: FlowModel, starts: string[], stopAt?: string): Set<string> {
  const reached = new Set<string>();
  const queue = [...starts];
  while (queue.length) {
    const id = queue.shift();
    if (!id || reached.has(id) || id === stopAt) continue;
    reached.add(id);
    for (const connector of model.connectors) {
      if (connector.from === id && connector.to && !reached.has(connector.to))
        queue.push(connector.to);
    }
  }
  return reached;
}

function ownerName(node: XmlNode): string | undefined {
  let current = node.parent;
  while (current?.parent) {
    const name = childText(current, "name");
    if (name && current.parent.name === "Flow") return name;
    current = current.parent;
  }
  return undefined;
}

function displayElement(model: FlowModel, id: string): string {
  return model.elements.find((element) => element.id === id)?.name ?? id;
}

function elementLabel(element: FlowElement): string {
  return `${humanKind(element.kind)} "${element.name}"`;
}

function humanKind(kind: string): string {
  const names: Record<string, string> = {
    actionCalls: "Action",
    apexPluginCalls: "Apex action",
    assignments: "Assignment",
    decisions: "Decision",
    loops: "Loop",
    recordCreates: "Create Records",
    recordDeletes: "Delete Records",
    recordLookups: "Get Records",
    recordUpdates: "Update Records",
    screens: "Screen",
    subflows: "Subflow",
    waits: "Wait",
  };
  return names[kind] ?? kind;
}

function reportAt(
  rule: string,
  severity: FlowSeverity,
  message: string,
  location: { line: number; column: number; name?: string },
  report: Report,
): void {
  report(
    rule,
    severity,
    message,
    {
      name: "location",
      text: "",
      start: 0,
      end: 0,
      children: [],
      line: location.line,
      column: location.column,
    },
    location.name,
  );
}

function reportReference(
  rule: string,
  severity: FlowSeverity,
  message: string,
  reference: { line: number; column: number; owner?: string },
  report: Report,
): void {
  reportAt(rule, severity, message, { ...reference, name: reference.owner }, report);
}

type Report = (
  rule: string,
  severity: FlowSeverity,
  message: string,
  node?: XmlNode,
  element?: string,
) => void;

function skipUnrunnableProfileRules(
  profile: FlowQualityProfile,
  ran: string[],
  skipped: Array<{ id: string; reason: string }>,
  reason: string,
): void {
  const ids = new Set([
    ...RULES,
    ...FLOW_QUALITY_RULES.filter((rule) => rule.profiles.includes(profile)).map((rule) => rule.id),
  ]);
  for (const id of ids) {
    if (!ran.includes(id) && !skipped.some((entry) => entry.id === id))
      skipped.push({ id, reason });
  }
}

function finish(
  file: string,
  family: FlowFamily,
  findings: FlowFinding[],
  coverage: FlowAnalysis["coverage"],
): FlowAnalysis {
  const order: Record<FlowSeverity, number> = { high: 0, moderate: 1, low: 2, info: 3 };
  findings.sort(
    (left, right) =>
      left.line - right.line ||
      left.column - right.column ||
      order[left.severity] - order[right.severity],
  );
  const summary = { high: 0, moderate: 0, low: 0, info: 0 };
  for (const finding of findings) summary[finding.severity] += 1;
  return {
    file,
    status: findings.some(
      (finding) => finding.rule_id === "xml-syntax" || finding.rule_id === "flow-root",
    )
      ? "failed"
      : findings.length
        ? "findings"
        : "clean",
    family,
    findings,
    summary,
    coverage,
  };
}
