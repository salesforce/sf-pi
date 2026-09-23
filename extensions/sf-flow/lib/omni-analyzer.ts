/* SPDX-License-Identifier: Apache-2.0 */
/** Omni-Channel Flow family contracts shared by analysis and topology projection. */

import type { FlowModel, FlowSeverity } from "./types.ts";
import { child, childText, type XmlNode } from "./xml.ts";

export type OmniReporter = (
  rule: string,
  severity: FlowSeverity,
  message: string,
  node?: XmlNode,
  element?: string,
) => void;

export function runOmniChannelChecks(root: XmlNode, model: FlowModel, report: OmniReporter): void {
  const start = child(root, "start");
  if (model.trigger_type) {
    report(
      "omni-channel-contract",
      "high",
      "Omni-Channel Flow must not declare a triggerType; its service channel launches it.",
      start,
    );
  }

  const recordId = root.children.find(
    (node) => node.name === "variables" && childText(node, "name") === "recordId",
  );
  if (!recordId) {
    report(
      "omni-channel-contract",
      "high",
      'Omni-Channel Flow requires a scalar Text input variable named "recordId".',
      root,
    );
  } else if (
    childText(recordId, "dataType") !== "String" ||
    childText(recordId, "isCollection") !== "false" ||
    childText(recordId, "isInput") !== "true"
  ) {
    report(
      "omni-channel-contract",
      "high",
      'Omni-Channel variable "recordId" must be Text, scalar, and available for input.',
      recordId,
      "recordId",
    );
  }

  const routeWork = root.children.filter(
    (node) =>
      node.name === "actionCalls" &&
      (childText(node, "actionName") === "routeWork" ||
        childText(node, "actionType") === "routeWork"),
  );
  if (!routeWork.length) {
    report(
      "omni-channel-contract",
      "high",
      "Omni-Channel Flow requires at least one Route Work action.",
      root,
    );
    return;
  }

  const reachable = reachableElements(model);
  for (const action of routeWork) {
    const name = childText(action, "name") ?? "Route Work";
    if (!reachable.has(name)) {
      report(
        "omni-channel-contract",
        "high",
        `Route Work action "${name}" is not reachable from Start.`,
        action,
        name,
      );
    }
    if (omniActionInputValue(action, "recordId") !== "recordId") {
      report(
        "omni-channel-contract",
        "high",
        `Route Work action "${name}" must receive the required recordId input variable.`,
        action,
        name,
      );
    }
    if (
      !omniActionInputValue(action, "serviceChannelId") &&
      !omniActionInputValue(action, "serviceChannelDevName")
    ) {
      report(
        "omni-channel-contract",
        "high",
        `Route Work action "${name}" must identify a service channel.`,
        action,
        name,
      );
    }
    const routingType = omniActionInputValue(action, "routingType");
    if (!routingType) {
      report(
        "omni-channel-contract",
        "high",
        `Route Work action "${name}" must declare a routingType.`,
        action,
        name,
      );
    } else if (routingType === "QueueBased" && !omniActionInputValue(action, "queueId")) {
      report(
        "omni-channel-contract",
        "high",
        `Queue-based Route Work action "${name}" must identify a queue.`,
        action,
        name,
      );
    } else if (routingType === "Agent") {
      if (!omniActionInputValue(action, "agentId")) {
        report(
          "omni-channel-contract",
          "high",
          `Direct-agent Route Work action "${name}" must identify an agent.`,
          action,
          name,
        );
      }
      if (!omniActionInputValue(action, "queueId")) {
        report(
          "omni-channel-contract",
          "high",
          `Direct-agent Route Work action "${name}" must identify a fallback queue.`,
          action,
          name,
        );
      }
    } else if (routingType === "SkillsBased") {
      if (!omniActionInputValue(action, "routingConfigId")) {
        report(
          "omni-channel-contract",
          "high",
          `Skills-based Route Work action "${name}" must identify a routing configuration.`,
          action,
          name,
        );
      }
      const skillOption = omniActionInputValue(action, "skillOption");
      if (!skillOption) {
        report(
          "omni-channel-contract",
          "high",
          `Skills-based Route Work action "${name}" must declare a skillOption.`,
          action,
          name,
        );
      } else if (
        ["DefineSkillRequirements", "Both"].includes(skillOption) &&
        !omniActionInputValue(action, "skillRequirementsResourceItem")
      ) {
        report(
          "omni-channel-contract",
          "high",
          `Skills-based Route Work action "${name}" must receive the defined SkillRequirement collection.`,
          action,
          name,
        );
      }
    }
    if (childText(action, "versionString") !== "2.0.0") {
      report(
        "omni-channel-contract",
        "moderate",
        `Route Work action "${name}" should use action version 2.0.0 for portable new metadata.`,
        action,
        name,
      );
    }
  }

  runAvailabilityChecks(root, model, routeWork, report);
  runNoRouteChecks(root, model, routeWork, report);
  runActionVersionChecks(root, report);
}

function runAvailabilityChecks(
  root: XmlNode,
  model: FlowModel,
  routeWork: XmlNode[],
  report: OmniReporter,
): void {
  const checks = root.children.filter(
    (node) =>
      node.name === "actionCalls" &&
      childText(node, "actionName") === "checkAvailabilityForRouting",
  );
  for (const check of checks) {
    const name = childText(check, "name") ?? "Check Availability";
    const routingType = omniActionInputValue(check, "routingType");
    if (!routingType || !omniActionInputValue(check, "serviceChannelId")) {
      report(
        "omni-channel-contract",
        "high",
        `Check Availability action "${name}" must identify its routing type and service channel.`,
        check,
        name,
      );
    }
    const targetInput =
      routingType === "Agent"
        ? "agentId"
        : routingType === "QueueBased"
          ? "queueId"
          : routingType === "SkillsBased"
            ? "skillRequirementsResourceItem"
            : undefined;
    if (targetInput && !omniActionInputValue(check, targetInput)) {
      report(
        "omni-channel-contract",
        "high",
        `Check Availability action "${name}" must identify the ${targetInput} routing target.`,
        check,
        name,
      );
    }
    const downstream = reachableFrom(model, name);
    for (const route of routeWork) {
      const routeName = childText(route, "name") ?? "Route Work";
      if (!downstream.has(routeName)) continue;
      const routeType = omniActionInputValue(route, "routingType");
      if (routingType && routeType && routingType !== routeType) {
        report(
          "omni-channel-contract",
          "high",
          `Check Availability action "${name}" and downstream Route Work action "${routeName}" use different routing types.`,
          check,
          name,
        );
      }
      if (targetInput) {
        const checkedTarget = omniActionInputValue(check, targetInput);
        const routedTarget = omniActionInputValue(route, targetInput);
        if (checkedTarget && routedTarget && checkedTarget !== routedTarget) {
          report(
            "omni-channel-contract",
            "high",
            `Check Availability action "${name}" and downstream Route Work action "${routeName}" use different ${targetInput} values.`,
            check,
            name,
          );
        }
      }
    }
  }
}

function runNoRouteChecks(
  root: XmlNode,
  model: FlowModel,
  routeWork: XmlNode[],
  report: OmniReporter,
): void {
  const reachable = reachableFrom(model, "__start__");
  const routeNames = new Set(routeWork.map((node) => childText(node, "name")).filter(Boolean));
  const terminals = model.elements.filter((element) => {
    if (element.kind === "start" || !reachable.has(element.id)) return false;
    return !model.connectors.some(
      (connector) => connector.from === element.id && !connector.fault && connector.to,
    );
  });
  const nonRoute = terminals.filter((element) => !routeNames.has(element.name));
  if (!nonRoute.length) return;

  const reason = root.children.find(
    (node) => node.name === "variables" && childText(node, "name") === "reasonForNotRouting",
  );
  const availabilityAware = root.children.some(
    (node) =>
      node.name === "actionCalls" &&
      childText(node, "actionName") === "checkAvailabilityForRouting",
  );
  if (!reason && !availabilityAware) return;
  const reasonIsOutput =
    reason &&
    childText(reason, "dataType") === "String" &&
    childText(reason, "isOutput") === "true";
  const assigned = root.children.some(
    (node) =>
      node.name === "assignments" &&
      node.children.some(
        (item) =>
          item.name === "assignmentItems" &&
          childText(item, "assignToReference") === "reasonForNotRouting",
      ),
  );
  if (!reasonIsOutput || !assigned) {
    report(
      "omni-channel-contract",
      "high",
      "Every intentional no-route terminal path must assign the Text output reasonForNotRouting.",
      reason ?? root,
      nonRoute[0]?.name,
    );
  }
}

function runActionVersionChecks(root: XmlNode, report: OmniReporter): void {
  for (const action of root.children.filter((node) => node.name === "actionCalls")) {
    const actionName = childText(action, "actionName");
    if (!new Set(["addSkillRequirements", "checkAvailabilityForRouting"]).has(actionName ?? "")) {
      continue;
    }
    if (childText(action, "versionString") === "2.0.0") continue;
    const name = childText(action, "name") ?? actionName ?? "Omni action";
    report(
      "omni-channel-contract",
      "moderate",
      `Omni-Channel action "${name}" should use action version 2.0.0 for portable new metadata.`,
      action,
      name,
    );
  }
}

export function omniActionInputValue(action: XmlNode, name: string): string | undefined {
  const parameter = action.children.find(
    (node) => node.name === "inputParameters" && childText(node, "name") === name,
  );
  const value = parameter ? child(parameter, "value") : undefined;
  if (!value) return undefined;
  for (const kind of ["elementReference", "stringValue", "setupReference"]) {
    const resolved = childText(value, kind);
    if (resolved) return resolved;
  }
  return undefined;
}

export function omniRoutingLabel(routingType: string | undefined): string | undefined {
  if (routingType === "QueueBased") return "queue";
  if (routingType === "SkillsBased") return "skills";
  if (routingType === "Agent") return "agent";
  if (routingType === "Bot") return "bot";
  if (routingType === "Copilot") return "Agentforce";
  return routingType;
}

function reachableElements(model: FlowModel): Set<string> {
  return reachableFrom(model, "__start__");
}

function reachableFrom(model: FlowModel, start: string): Set<string> {
  const reached = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    if (!id || reached.has(id)) continue;
    reached.add(id);
    for (const connector of model.connectors) {
      if (connector.from === id && connector.to && !reached.has(connector.to)) {
        queue.push(connector.to);
      }
    }
  }
  return reached;
}
