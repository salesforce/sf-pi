/* SPDX-License-Identifier: Apache-2.0 */
/** Small, portable Omni-Channel authoring blueprints for supported destinations. */

import type { OmniDestination } from "./types.ts";

export interface OmniAuthoringOptions {
  destination: OmniDestination;
  check_availability: boolean;
  no_route: boolean;
}

export function inferOmniDestination(intent: string): OmniDestination {
  const text = intent.toLowerCase();
  if (/skill|qualified|expertise/.test(text)) return "skills";
  if (
    /direct(?:ly)? to (?:an? )?(?:agent|rep)|specific (?:agent|rep)|preferred (?:agent|rep)/.test(
      text,
    )
  ) {
    return "agent";
  }
  return "queue";
}

export function buildOmniChannelMetadataSkeleton(
  apiVersion: string,
  options: OmniAuthoringOptions,
): string {
  const needsNoRoute = options.check_availability || options.no_route;
  const routeStart = "Route_Work";
  const firstTarget = options.check_availability
    ? "Check_Availability"
    : options.no_route
      ? "Should_Route_Work"
      : routeStart;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Flow xmlns="http://soap.sforce.com/2006/04/metadata">',
    ...(options.check_availability ? checkAvailabilityAction(options.destination) : []),
    ...routeWorkAction(options.destination),
    `    <apiVersion>${apiVersion}</apiVersion>`,
    ...(needsNoRoute ? noRouteAssignment() : []),
    ...(options.check_availability
      ? availabilityDecision()
      : options.no_route
        ? explicitRouteDecision(routeStart)
        : []),
    "    <description>TODO: Describe the Omni-Channel routing policy and fallback behavior.</description>",
    "    <label>TODO Omni-Channel Routing</label>",
    "    <processMetadataValues>",
    "        <name>CanvasMode</name>",
    "        <value><stringValue>AUTO_LAYOUT_CANVAS</stringValue></value>",
    "    </processMetadataValues>",
    "    <processType>RoutingFlow</processType>",
    "    <start>",
    "        <locationX>50</locationX>",
    "        <locationY>50</locationY>",
    "        <connector>",
    `            <targetReference>${firstTarget}</targetReference>`,
    "        </connector>",
    "    </start>",
    "    <status>Draft</status>",
    ...destinationVariables(options.destination),
    ...(options.no_route && !options.check_availability ? booleanInput("routeWorkItem") : []),
    ...(needsNoRoute ? textOutput("reasonForNotRouting") : []),
    "</Flow>",
  ].join("\n");
}

function routeWorkAction(destination: OmniDestination): string[] {
  const targetInputs =
    destination === "queue"
      ? [
          ...actionReferenceInput("queueId", "queueId"),
          ...actionBooleanInput("isQueueVariable", true),
        ]
      : destination === "agent"
        ? [
            ...actionReferenceInput("agentId", "agentId"),
            ...actionReferenceInput("queueId", "fallbackQueueId"),
            ...actionBooleanInput("isAgentVariable", true),
            ...actionBooleanInput("isQueueVariable", true),
          ]
        : [
            ...actionReferenceInput("routingConfigId", "routingConfigId"),
            ...actionBooleanInput("isRoutingConfigVariable", true),
            ...actionStringInput("skillOption", "RunSBRRules"),
          ];
  const label =
    destination === "queue"
      ? "Route Work to Queue"
      : destination === "agent"
        ? "Route Work to Agent"
        : "Route Work to Skills";
  return [
    "    <actionCalls>",
    `        <description>${label} using caller-supplied, target-org-grounded inputs.</description>`,
    "        <name>Route_Work</name>",
    `        <label>${label}</label>`,
    "        <locationX>176</locationX>",
    "        <locationY>374</locationY>",
    "        <actionName>routeWork</actionName>",
    "        <actionType>routeWork</actionType>",
    "        <flowTransactionModel>CurrentTransaction</flowTransactionModel>",
    ...actionReferenceInput("recordId", "recordId"),
    ...actionReferenceInput("serviceChannelId", "serviceChannelId"),
    ...actionStringInput("routingType", routingType(destination)),
    ...targetInputs,
    "        <nameSegment>routeWork</nameSegment>",
    "        <offset>0</offset>",
    "        <versionString>2.0.0</versionString>",
    "    </actionCalls>",
  ];
}

function checkAvailabilityAction(destination: OmniDestination): string[] {
  const targetInputs =
    destination === "queue"
      ? [
          ...actionReferenceInput("queueId", "queueId"),
          ...actionBooleanInput("isQueueVariable", true),
        ]
      : destination === "agent"
        ? [
            ...actionReferenceInput("agentId", "agentId"),
            ...actionBooleanInput("isAgentVariable", true),
          ]
        : [
            ...actionStringInput("skillOption", "RunSBRRules"),
            ...actionReferenceInput("recordId", "recordId"),
          ];
  return [
    "    <actionCalls>",
    "        <description>Checks current routing availability before attempting Route Work.</description>",
    "        <name>Check_Availability</name>",
    "        <label>Check Availability</label>",
    "        <locationX>176</locationX>",
    "        <locationY>266</locationY>",
    "        <actionName>checkAvailabilityForRouting</actionName>",
    "        <actionType>checkAvailabilityForRouting</actionType>",
    "        <connector>",
    "            <targetReference>Route_When_Available</targetReference>",
    "        </connector>",
    "        <faultConnector>",
    "            <targetReference>Set_Reason_For_Not_Routing</targetReference>",
    "        </faultConnector>",
    "        <flowTransactionModel>CurrentTransaction</flowTransactionModel>",
    ...actionStringInput("routingType", routingType(destination)),
    ...actionReferenceInput("serviceChannelId", "serviceChannelId"),
    ...actionStringInput("selectedOutputs", "ReturnAll"),
    ...targetInputs,
    "        <nameSegment>checkAvailabilityForRouting</nameSegment>",
    "        <offset>0</offset>",
    "        <storeOutputAutomatically>true</storeOutputAutomatically>",
    "        <versionString>2.0.0</versionString>",
    "    </actionCalls>",
  ];
}

function availabilityDecision(): string[] {
  return [
    "    <decisions>",
    "        <name>Route_When_Available</name>",
    "        <label>Route When Available</label>",
    "        <locationX>176</locationX>",
    "        <locationY>320</locationY>",
    "        <defaultConnector>",
    "            <targetReference>Set_Reason_For_Not_Routing</targetReference>",
    "        </defaultConnector>",
    "        <defaultConnectorLabel>No Online Agents</defaultConnectorLabel>",
    "        <rules>",
    "            <name>Online_Agent_Available</name>",
    "            <conditionLogic>and</conditionLogic>",
    "            <conditions>",
    "                <leftValueReference>Check_Availability.onlineAgentsCount</leftValueReference>",
    "                <operator>GreaterThan</operator>",
    "                <rightValue><numberValue>0</numberValue></rightValue>",
    "            </conditions>",
    "            <connector>",
    "                <targetReference>Route_Work</targetReference>",
    "            </connector>",
    "            <label>Online Agent Available</label>",
    "        </rules>",
    "    </decisions>",
  ];
}

function explicitRouteDecision(routeTarget: string): string[] {
  return [
    "    <decisions>",
    "        <name>Should_Route_Work</name>",
    "        <label>Should Route Work</label>",
    "        <locationX>176</locationX>",
    "        <locationY>104</locationY>",
    "        <defaultConnector>",
    "            <targetReference>Set_Reason_For_Not_Routing</targetReference>",
    "        </defaultConnector>",
    "        <defaultConnectorLabel>Do Not Route</defaultConnectorLabel>",
    "        <rules>",
    "            <name>Route_Work_Item</name>",
    "            <conditionLogic>and</conditionLogic>",
    "            <conditions>",
    "                <leftValueReference>routeWorkItem</leftValueReference>",
    "                <operator>EqualTo</operator>",
    "                <rightValue><booleanValue>true</booleanValue></rightValue>",
    "            </conditions>",
    "            <connector>",
    `                <targetReference>${routeTarget}</targetReference>`,
    "            </connector>",
    "            <label>Route Work Item</label>",
    "        </rules>",
    "    </decisions>",
  ];
}

function noRouteAssignment(): string[] {
  return [
    "    <assignments>",
    "        <name>Set_Reason_For_Not_Routing</name>",
    "        <label>Set Reason For Not Routing</label>",
    "        <locationX>314</locationX>",
    "        <locationY>374</locationY>",
    "        <assignmentItems>",
    "            <assignToReference>reasonForNotRouting</assignToReference>",
    "            <operator>Assign</operator>",
    "            <value><stringValue>No routing capacity is currently available.</stringValue></value>",
    "        </assignmentItems>",
    "    </assignments>",
  ];
}

function destinationVariables(destination: OmniDestination): string[] {
  const variables = [
    ...textInput("recordId"),
    ...textInput("serviceChannelId"),
    ...(destination === "queue" ? textInput("queueId") : []),
    ...(destination === "agent" ? textInput("agentId") : []),
    ...(destination === "agent" ? textInput("fallbackQueueId") : []),
    ...(destination === "skills" ? textInput("routingConfigId") : []),
  ];
  return variables;
}

function textInput(name: string): string[] {
  return [
    "    <variables>",
    `        <name>${name}</name>`,
    "        <dataType>String</dataType>",
    "        <isCollection>false</isCollection>",
    "        <isInput>true</isInput>",
    "        <isOutput>false</isOutput>",
    "    </variables>",
  ];
}

function booleanInput(name: string): string[] {
  return [
    "    <variables>",
    `        <name>${name}</name>`,
    "        <dataType>Boolean</dataType>",
    "        <isCollection>false</isCollection>",
    "        <isInput>true</isInput>",
    "        <isOutput>false</isOutput>",
    "    </variables>",
  ];
}

function textOutput(name: string): string[] {
  return [
    "    <variables>",
    `        <name>${name}</name>`,
    "        <dataType>String</dataType>",
    "        <isCollection>false</isCollection>",
    "        <isInput>false</isInput>",
    "        <isOutput>true</isOutput>",
    "    </variables>",
  ];
}

function actionReferenceInput(name: string, reference: string): string[] {
  return [
    "        <inputParameters>",
    `            <name>${name}</name>`,
    `            <value><elementReference>${reference}</elementReference></value>`,
    "        </inputParameters>",
  ];
}

function actionStringInput(name: string, value: string): string[] {
  return [
    "        <inputParameters>",
    `            <name>${name}</name>`,
    `            <value><stringValue>${value}</stringValue></value>`,
    "        </inputParameters>",
  ];
}

function actionBooleanInput(name: string, value: boolean): string[] {
  return [
    "        <inputParameters>",
    `            <name>${name}</name>`,
    `            <value><booleanValue>${value}</booleanValue></value>`,
    "        </inputParameters>",
  ];
}

function routingType(destination: OmniDestination): string {
  if (destination === "agent") return "Agent";
  if (destination === "skills") return "SkillsBased";
  return "QueueBased";
}
