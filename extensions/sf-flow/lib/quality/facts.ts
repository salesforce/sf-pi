/* SPDX-License-Identifier: Apache-2.0 */
/** Shared parse-once facts for preventive Flow quality evaluators. */

import type { FlowElement, FlowModel } from "../types.ts";
import { childText, descendants, type XmlNode } from "../xml.ts";

export interface FlowQualityFacts {
  source: string;
  root: XmlNode;
  model: FlowModel;
  all_nodes: XmlNode[];
  element_nodes: Map<string, XmlNode>;
  process_metadata: Map<string, string>;
  loop_bodies: Map<string, Set<string>>;
}

export function buildFlowQualityFacts(
  source: string,
  root: XmlNode,
  model: FlowModel,
): FlowQualityFacts {
  const allNodes = [root, ...descendants(root)];
  const elementNodes = new Map<string, XmlNode>();
  for (const node of root.children) {
    const name = childText(node, "name");
    if (name) elementNodes.set(name, node);
  }
  const processMetadata = new Map<string, string>();
  for (const entry of root.children.filter((node) => node.name === "processMetadataValues")) {
    const name = childText(entry, "name");
    const value = descendants(entry)
      .find((node) => node.name === "stringValue")
      ?.text.trim();
    if (name && value) processMetadata.set(name, value);
  }
  const loopBodies = new Map<string, Set<string>>();
  for (const loop of model.elements.filter((element) => element.kind === "loops")) {
    const starts = model.connectors
      .filter(
        (connector) =>
          connector.from === loop.id &&
          connector.kind === "nextValueConnector" &&
          typeof connector.to === "string",
      )
      .map((connector) => connector.to as string);
    loopBodies.set(loop.id, reachable(model, starts, loop.id));
  }
  return {
    source,
    root,
    model,
    all_nodes: allNodes,
    element_nodes: elementNodes,
    process_metadata: processMetadata,
    loop_bodies: loopBodies,
  };
}

export function elementNode(facts: FlowQualityFacts, element: FlowElement): XmlNode | undefined {
  return facts.element_nodes.get(element.name);
}

export function literalNodes(facts: FlowQualityFacts): XmlNode[] {
  const literalNames = new Set(["stringValue", "text", "expression", "formulaExpression", "body"]);
  return facts.all_nodes.filter(
    (node) => literalNames.has(node.name) && node.text.trim().length > 0,
  );
}

export function firstDownstreamElement(
  facts: FlowQualityFacts,
  elementName: string,
): FlowElement | undefined {
  const target = facts.model.connectors.find(
    (connector) => connector.from === elementName && !connector.fault && connector.to,
  )?.to;
  return target ? facts.model.elements.find((candidate) => candidate.id === target) : undefined;
}

export function isSameRecordUpdate(facts: FlowQualityFacts, element: FlowElement): boolean {
  const node = elementNode(facts, element);
  if (!node || element.kind !== "recordUpdates") return false;
  const recordReference = childText(node, "inputReference") ?? childText(node, "recordReference");
  if (recordReference === "$Record" || recordReference?.startsWith("$Record.")) return true;
  const object = childText(node, "object");
  const hasIdFilter = descendants(node).some(
    (candidate) => candidate.name === "field" && candidate.text.trim() === "Id",
  );
  return object === facts.model.object && hasIdFilter;
}

export function reachable(model: FlowModel, starts: string[], stopAt?: string): Set<string> {
  const reached = new Set<string>();
  const queue = [...starts];
  while (queue.length) {
    const current = queue.shift();
    if (!current || current === stopAt || reached.has(current)) continue;
    reached.add(current);
    for (const connector of model.connectors) {
      if (connector.from === current && connector.to && !reached.has(connector.to)) {
        queue.push(connector.to);
      }
    }
  }
  return reached;
}

export function canReach(model: FlowModel, from: string, to: string): boolean {
  return reachable(model, [from]).has(to);
}
