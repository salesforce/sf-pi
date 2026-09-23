/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded Mermaid source projection for Pi-native Flow graph rendering. */

import type { FlowModel, FlowTopologyDigest } from "./types.ts";

const DURABLE_WRITE_KINDS = new Set(["recordCreates", "recordUpdates", "recordDeletes"]);

export function buildTopologyEvidence(
  model: FlowModel,
  displayMaxNodes = 100,
): {
  display: FlowTopologyDigest & { source: string };
  artifact: FlowTopologyDigest & { source: string };
} {
  const display = buildMermaidTopology(model, displayMaxNodes);
  return {
    display,
    artifact: display.truncated ? buildMermaidTopology(model, model.elements.length) : display,
  };
}

export function buildMermaidTopology(
  model: FlowModel,
  maxNodes = 100,
): FlowTopologyDigest & { source: string } {
  const selected = model.elements.slice(0, Math.max(1, maxNodes));
  const selectedIds = new Set(selected.map((element) => element.id));
  const nodeIds = new Map(selected.map((element, index) => [element.id, `n${index}`]));
  const lines = ["flowchart TD"];
  for (const element of selected) {
    const id = nodeIds.get(element.id);
    if (!id) continue;
    const label = mermaidLabel(
      element.kind === "start" ? startLabel(model) : elementLabel(element),
      72,
    );
    lines.push(`    ${id}${shape(element.kind, label)}`);
  }
  let missingIndex = 0;
  const missing = new Map<string, string>();
  const edges = model.connectors.filter((connector) => selectedIds.has(connector.from));
  for (const connector of edges) {
    if (!connector.to) continue;
    let target = nodeIds.get(connector.to);
    if (!target) {
      if (model.elements.some((element) => element.id === connector.to)) continue;
      target = missing.get(connector.to);
      if (!target) {
        target = `missing${missingIndex++}`;
        missing.set(connector.to, target);
        lines.push(`    ${target}["Missing: ${mermaidLabel(connector.to)}"]`);
      }
    }
    const from = nodeIds.get(connector.from);
    if (!from) continue;
    const label = compactEdgeLabel(
      connector.fault ? "Fault" : (connector.label ?? connectorLabel(connector.kind)),
      connector.kind,
    );
    const targetElement = model.elements.find((element) => element.id === connector.to);
    const durableWrite = targetElement ? DURABLE_WRITE_KINDS.has(targetElement.kind) : false;
    lines.push(
      connector.fault
        ? `    ${from} -.->|Fault| ${target}`
        : durableWrite
          ? label
            ? `    ${from} ==>|${label}| ${target}`
            : `    ${from} ==> ${target}`
          : label
            ? `    ${from} -->|${label}| ${target}`
            : `    ${from} --> ${target}`,
    );
  }
  const source = lines.join("\n");
  return {
    source,
    mermaid: source,
    nodes: selected.length + missing.size,
    total_nodes: model.elements.length,
    edges: edges.filter((edge) => edge.to).length,
    truncated: model.elements.length > selected.length,
  };
}

function shape(kind: string, label: string): string {
  if (kind === "start") return `(["${label}"])`;
  if (kind === "decisions") return `{"${label}"}`;
  if (kind === "loops") return `{{"${label}"}}`;
  if (kind === "recordLookups") return `[("${label}")]`;
  if (kind === "screens" || kind === "subflows") return `[["${label}"]]`;
  if (
    kind === "actionCalls" ||
    kind === "apexPluginCalls" ||
    kind === "waits" ||
    kind === "scheduledPaths"
  ) {
    return `(["${label}"])`;
  }
  return `["${label}"]`;
}

function startLabel(model: FlowModel): string {
  if (model.family === "record-triggered") {
    return [
      "START",
      model.object,
      triggerTiming(model.trigger_type),
      recordEvent(model.record_trigger_type),
      model.start_criteria?.length ? `when ${model.start_criteria.join(" and ")}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (model.family === "schedule-triggered")
    return `START · ${model.object ?? "schedule"} · scheduled`;
  if (model.family === "platform-event-triggered") {
    return `START · ${model.object ?? "platform event"} · event`;
  }
  if (model.family === "screen") return "START · screen";
  if (model.family === "omni-channel") return "START · Omni-Channel routing";
  return "START · caller";
}

function elementLabel(element: FlowModel["elements"][number]): string {
  const title = element.label ?? element.name;
  const action = routingActionPresentation(element);
  const verb =
    action?.verb ??
    (element.kind === "scheduledPaths" && element.detail !== "after commit"
      ? "SCHEDULED"
      : elementVerb(element.kind));
  const displayTitle = element.kind === "decisions" && !/[?]$/.test(title) ? `${title}?` : title;
  return [verb, displayTitle, action?.detail ?? element.detail].filter(Boolean).join(" · ");
}

function routingActionPresentation(
  element: FlowModel["elements"][number],
): { verb: string; detail?: string } | undefined {
  if (element.kind !== "actionCalls" || !element.detail) return undefined;
  const [action, detail] = element.detail.split(" · ", 2);
  if (action === "routeWork") return { verb: "ROUTE", detail };
  if (action === "addSkillRequirements") return { verb: "ADD SKILLS" };
  if (/checkAvailability/i.test(action)) return { verb: "CHECK AVAILABILITY" };
  if (/addScreenPop/i.test(action)) return { verb: "SCREEN POP" };
  return undefined;
}

function elementVerb(kind: string): string {
  if (kind === "recordLookups") return "GET";
  if (kind === "recordCreates") return "CREATE";
  if (kind === "recordUpdates") return "UPDATE";
  if (kind === "recordDeletes") return "DELETE";
  if (kind === "assignments") return "SET";
  if (kind === "decisions") return "DECISION";
  if (kind === "loops") return "FOR EACH";
  if (kind === "screens") return "SCREEN";
  if (kind === "actionCalls" || kind === "apexPluginCalls") return "ACTION";
  if (kind === "subflows") return "SUBFLOW";
  if (kind === "waits") return "WAIT";
  if (kind === "transforms") return "TRANSFORM";
  if (kind === "collectionProcessors") return "COLLECTION";
  if (kind === "scheduledPaths") return "ASYNC";
  return kind.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
}

function triggerTiming(triggerType: string | undefined): string | undefined {
  if (triggerType === "RecordBeforeSave") return "before save";
  if (triggerType === "RecordAfterSave") return "after save";
  if (triggerType === "RecordBeforeDelete") return "before delete";
  return triggerType;
}

function recordEvent(event: string | undefined): string | undefined {
  if (event === "CreateAndUpdate") return "create/update";
  return event?.toLowerCase();
}

function connectorLabel(kind: string): string {
  if (kind === "nextValueConnector") return "For each";
  if (kind === "noMoreValuesConnector") return "After last";
  if (kind === "defaultConnector") return "Otherwise";
  return "";
}

function compactEdgeLabel(value: string, kind: string): string {
  const cleaned = mermaidLabel(value, 80);
  if (cleaned.length <= 18) return cleaned;
  if (kind === "defaultConnector") return "Otherwise";
  const withoutSuffix = cleaned.replace(/\s+(Exists|Found|Outcome|Path)$/i, "");
  if (withoutSuffix.length <= 18) return withoutSuffix;
  const words = withoutSuffix.split(/\s+/);
  let result = "";
  for (const word of words) {
    const candidate = result ? `${result} ${word}` : word;
    if (candidate.length > 17) break;
    result = candidate;
  }
  return result ? `${result}…` : `${withoutSuffix.slice(0, 17)}…`;
}

function mermaidLabel(value: string, maxLength = 48): string {
  return value
    .replace(/["“”]/g, "'")
    .replace(/[|\n\r]/g, " ")
    .slice(0, maxLength);
}
