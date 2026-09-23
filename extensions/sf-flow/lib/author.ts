/* SPDX-License-Identifier: Apache-2.0 */
/** Type-aware, non-mutating Flow authoring plans for supported Flow families. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildFlowDigest, row, section, toolResultFromDigest } from "./digest.ts";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { groundAuthoringContext, type AuthorGroundingAdapter } from "./grounding.ts";
import { generationConstraintsForFamily } from "./quality/catalog.ts";
import {
  buildOmniChannelMetadataSkeleton,
  inferOmniDestination,
  type OmniAuthoringOptions,
} from "./omni-author.ts";
import {
  groundOmniAuthoringContext,
  type OmniAuthorGroundingResult,
  type OmniGroundingAdapter,
} from "./omni-grounding.ts";
import type { FlowFamily, SfFlowParams, ToolResult, TriggerTiming } from "./types.ts";

export interface InferredFlowFamily {
  family?: Exclude<FlowFamily, "specialized" | "unknown">;
  ambiguous: boolean;
  choices?: string[];
}

export function inferFlowFamily(intent: string): InferredFlowFamily {
  const text = intent.toLowerCase();
  if (/omni[- ]channel|\broute work\b|\brouting flow\b|\bservice channel\b/.test(text)) {
    return { family: "omni-channel", ambiguous: false };
  }
  if (/platform event|event message|__e\b/.test(text)) {
    return { family: "platform-event-triggered", ambiguous: false };
  }
  if (/every\s+(day|night|week|hour)|daily|weekly|schedule[- ]triggered|at midnight/.test(text)) {
    return { family: "schedule-triggered", ambiguous: false };
  }
  if (/screen|ask (the )?user|collect .* from .*user|guided/.test(text)) {
    return { family: "screen", ambiguous: false };
  }
  if (/before (it is )?saved|before-save|triggering record/.test(text)) {
    return { family: "record-triggered", ambiguous: false };
  }
  if (
    /record (changes|is created|is updated|is deleted)|when an? \w+ changes|after-save|before-delete/.test(
      text,
    )
  ) {
    return {
      family: "record-triggered",
      ambiguous: !/after-save|before-delete|before save|before-save/.test(text),
      choices: ["before-save", "after-save"],
    };
  }
  if (/reusable|called by another|subflow|autolaunched|input.*output/.test(text)) {
    return { family: "autolaunched", ambiguous: false };
  }
  return {
    ambiguous: true,
    choices: [
      "screen",
      "autolaunched",
      "record-triggered",
      "schedule-triggered",
      "platform-event-triggered",
      "omni-channel",
    ],
  };
}

export async function buildAuthoringPlan(
  params: SfFlowParams,
  cwd: string,
  session?: SalesforceSession,
  groundingDependencies: {
    adapter?: AuthorGroundingAdapter;
    omniAdapter?: OmniGroundingAdapter;
  } = {},
): Promise<ToolResult> {
  const intent = params.intent?.trim();
  if (!intent) throw new Error("intent is required for author.plan");
  const inferred = inferFlowFamily(intent);
  const family = params.flow_type ?? inferred.family;
  if (!family) {
    const digest = buildFlowDigest({
      action: "author.plan",
      kind: "flow_authoring_plan",
      status: "warning",
      icon: "🧭",
      title: "Flow Authoring Plan · family needed",
      sections: [
        section("❓", "Clarify", [
          row("🧩", "Flow family", inferred.choices?.join(", ") ?? "not inferred"),
          row("📝", "Intent", intent),
        ]),
      ],
      next_step: "Choose the Flow family before writing metadata.",
    });
    return toolResultFromDigest(digest, { inference: inferred });
  }

  const timing = resolveTiming(family, params.trigger_timing, intent);
  if (family === "record-triggered" && !timing) {
    const digest = buildFlowDigest({
      action: "author.plan",
      kind: "flow_authoring_plan",
      status: "warning",
      icon: "🧭",
      title: "Flow Authoring Plan · trigger timing needed",
      meta: [family],
      sections: [
        section("❓", "Clarify", [
          row("⏱️", "Choose", "before-save, after-save, or before-delete"),
          row("📝", "Intent", intent),
        ]),
      ],
      next_step: "Choose transaction timing; same-record updates usually use before-save.",
    });
    return toolResultFromDigest(digest, { inference: { ...inferred, family, ambiguous: true } });
  }

  const recordEvent =
    family === "record-triggered"
      ? resolveRecordEvent(params.record_event, intent, timing)
      : undefined;
  if (family === "record-triggered" && !recordEvent) {
    const digest = buildFlowDigest({
      action: "author.plan",
      kind: "flow_authoring_plan",
      status: "warning",
      icon: "🧭",
      title: "Flow Authoring Plan · record event needed",
      meta: [family, ...(timing ? [timing] : [])],
      sections: [
        section("❓", "Clarify", [
          row("⚡", "Choose", "create, update, create-and-update, or delete"),
          row("📝", "Intent", intent),
        ]),
      ],
      next_step: "Choose the record operation before writing the Start metadata.",
    });
    return toolResultFromDigest(digest, { inference: { ...inferred, family, ambiguous: true } });
  }

  const apiVersion = await projectApiVersion(cwd);
  const omniOptions: OmniAuthoringOptions | undefined =
    family === "omni-channel"
      ? {
          destination: params.omni_destination ?? inferOmniDestination(intent),
          check_availability: params.omni_check_availability === true,
          no_route: params.omni_no_route === true,
        }
      : undefined;
  const generationConstraints = generationConstraintsForFamily(family);
  const grounding =
    session && family !== "omni-channel"
      ? await groundAuthoringContext(session, params, groundingDependencies)
      : undefined;
  const omniGrounding =
    session && family === "omni-channel"
      ? await groundOmniAuthoringContext(session, params, {
          adapter: groundingDependencies.omniAdapter,
        })
      : undefined;
  const blueprint = blueprintFor(
    family,
    timing,
    recordEvent,
    params.object,
    params.event,
    omniOptions,
  );
  const skeleton =
    family === "omni-channel"
      ? buildOmniChannelMetadataSkeleton(apiVersion, omniOptions as OmniAuthoringOptions)
      : metadataSkeleton(family, timing, recordEvent, params.object, params.event, apiVersion);
  const digest = buildFlowDigest({
    action: "author.plan",
    kind: "flow_authoring_plan",
    status: "pass",
    icon: "🧭",
    title: "Flow Authoring Plan · ready",
    meta: [family, ...(timing ? [timing] : [])],
    rail: [
      { kind: "Local", target: "supported-family blueprint", detail: `API ${apiVersion}` },
      ...(grounding ? grounding.coverage.calls.map((call) => ({ kind: "API", target: call })) : []),
      ...(omniGrounding
        ? omniGrounding.coverage.calls.map((call) => ({ kind: "API", target: call }))
        : []),
    ],
    sections: [
      section("🎯", "Selection", [
        row("🧩", "Family", family),
        row("⏱️", "Trigger", blueprint.trigger_type ?? "launched by caller"),
        row("📦", "Object/Event", params.event || params.object || "define before authoring"),
        ...(omniOptions
          ? [
              row("🎯", "Destination", omniOptions.destination),
              row("📊", "Availability check", omniOptions.check_availability ? "yes" : "no"),
              row(
                "↩️",
                "Intentional no-route",
                omniOptions.no_route || omniOptions.check_availability ? "yes" : "no",
              ),
            ]
          : []),
        row("💡", "Why", selectionReason(family, timing)),
      ]),
      ...(grounding
        ? [
            section("🌐", "Grounded Org", [
              row(
                "🌐",
                "Grounded Org",
                `${grounding.target_org} · API ${grounding.api_version ?? "unknown"}`,
              ),
              row(
                "📦",
                "Object fields",
                grounding.object?.fields.length ?? grounding.event?.fields.length ?? 0,
              ),
              row("⚡", "Actions", grounding.actions.length),
              row("🌊", "Subflows", grounding.subflows.length),
              row("⚠️", "Gaps", grounding.coverage.gaps.length),
            ]),
            ...(grounding.actions.length
              ? [
                  section(
                    "⚡",
                    "Action Contracts",
                    grounding.actions
                      .slice(0, 5)
                      .map((action) =>
                        row(
                          "⚡",
                          action.name,
                          `${action.type ?? "action"} · in: ${action.inputs.map((input) => `${input.name}${input.required ? "*" : ""}`).join(", ") || "none"} · out: ${action.outputs.map((output) => output.name).join(", ") || "none"}`,
                        ),
                      ),
                  ),
                ]
              : []),
          ]
        : []),
      ...(omniGrounding
        ? [
            section("🌐", "Grounded Omni-Channel", [
              row(
                "🌐",
                "Grounded Org",
                `${omniGrounding.target_org} · API ${omniGrounding.api_version ?? "unknown"}`,
              ),
              row("📡", "Service channels", omniGrounding.service_channels.length),
              row("📥", "Queues", omniGrounding.queues.length),
              row("🧭", "Routing configurations", omniGrounding.routing_configurations.length),
              row("🎯", "Skills", omniGrounding.skills.length),
              row("👤", "Agents", omniGrounding.agents.length),
              row("⚠️", "Gaps", omniGrounding.coverage.gaps.length),
            ]),
            ...omniChoiceSections(omniGrounding),
          ]
        : []),
      section("🛡️", "Generation Guardrails", [
        row("🧭", "Applicable", generationConstraints.length),
        row(
          "👁️",
          "Displayed",
          `${generationConstraints.length} of ${generationConstraints.length}`,
        ),
        row("💡", "Meaning", "preventive authoring constraints, not detected violations"),
        row("📚", "Excluded", "review and audit profiles; use quality.rules to inspect them"),
      ]),
      ...(["high", "moderate", "low", "info"] as const)
        .map((severity) => {
          const applicable = generationConstraints.filter(
            (constraint) => constraint.severity === severity,
          );
          return section(
            severity === "high"
              ? "🔴"
              : severity === "moderate"
                ? "🟠"
                : severity === "low"
                  ? "🔵"
                  : "⚪",
            `${severity[0]?.toUpperCase()}${severity.slice(1)} Guardrails`,
            applicable.map((constraint) => row("•", constraint.rule_id, constraint.instruction)),
          );
        })
        .filter((guardrailSection) => guardrailSection.rows.length > 0),
      section(
        "🧱",
        "Authoring Contract",
        blueprint.contract.map((value) => row("•", "Rule", value)),
      ),
      section(
        "🧪",
        "Proof Plan",
        blueprint.tests.map((value) => row("✓", "Scenario", value)),
      ),
    ],
    next_step: "Create or edit the Flow with normal file tools, then run diagnose.file.",
  });
  return toolResultFromDigest(digest, {
    blueprint,
    skeleton,
    inference: inferred,
    generation_constraints: generationConstraints,
    grounding: grounding ?? omniGrounding,
  });
}

function omniChoiceSections(grounding: OmniAuthorGroundingResult) {
  return [
    section(
      "📡",
      "Service Channel Choices",
      grounding.service_channels.map((choice) =>
        row("📡", choice.label, [choice.developer_name, choice.detail].filter(Boolean).join(" · ")),
      ),
    ),
    section(
      "📥",
      "Queue Choices",
      grounding.queues.map((choice) => row("📥", choice.label, choice.developer_name)),
    ),
    section(
      "🧭",
      "Routing Configuration Choices",
      grounding.routing_configurations.map((choice) =>
        row("🧭", choice.label, [choice.developer_name, choice.detail].filter(Boolean).join(" · ")),
      ),
    ),
    section(
      "🎯",
      "Skill Choices",
      grounding.skills.map((choice) => row("🎯", choice.label, choice.developer_name)),
    ),
    section(
      "👤",
      "Agent Choices",
      grounding.agents.map((choice) => row("👤", choice.label, choice.developer_name)),
    ),
  ].filter((value) => value.rows.length > 0);
}

function resolveTiming(
  family: FlowFamily,
  explicit: TriggerTiming | undefined,
  intent: string,
): TriggerTiming | undefined {
  if (family !== "record-triggered") return undefined;
  if (explicit) return explicit;
  const text = intent.toLowerCase();
  if (/before-delete|before delete/.test(text)) return "before-delete";
  if (/after-save|after save|related record|send |create (a |an )?(task|record|email)/.test(text))
    return "after-save";
  if (/before-save|before save|before .*saved|triggering record/.test(text)) return "before-save";
  return undefined;
}

function blueprintFor(
  family: Exclude<FlowFamily, "specialized" | "unknown">,
  timing: TriggerTiming | undefined,
  recordEvent: SfFlowParams["record_event"] | undefined,
  objectName?: string,
  eventName?: string,
  omniOptions?: OmniAuthoringOptions,
) {
  const common = ["Use descriptive labels, API names, and descriptions."];
  const byFamily: Record<
    typeof family,
    { process_type: string; trigger_type?: string; contract: string[]; tests: string[] }
  > = {
    screen: {
      process_type: "Flow",
      contract: [
        ...common,
        "Validate user input before navigation.",
        "Avoid record creation before the first screen.",
        "Disable backward navigation after irreversible actions.",
      ],
      tests: ["valid user path", "validation failure", "back-navigation safety", "fault path"],
    },
    autolaunched: {
      process_type: "AutoLaunchedFlow",
      contract: [
        ...common,
        "Define explicit input and output variables for caller-facing behavior.",
      ],
      tests: ["required inputs", "idempotent retry", "output contract", "fault path"],
    },
    "record-triggered": {
      process_type: "AutoLaunchedFlow",
      trigger_type: triggerType(timing),
      contract: [
        ...common,
        ...(timing === "before-save"
          ? [
              "Use only Assignment, Decision, Get Records, and Loop; update the triggering record through $Record.",
            ]
          : ["Use precise entry criteria and guard against recursive record updates."]),
        `Confirm the trigger object${objectName ? ` (${objectName})` : ""} and create/update/delete event.`,
      ],
      tests: [
        "record enters criteria",
        "record does not enter criteria",
        "bulk update",
        "recursion guard",
      ],
    },
    "schedule-triggered": {
      process_type: "AutoLaunchedFlow",
      trigger_type: "Scheduled",
      contract: [...common, "Use selective start criteria and make each scheduled run idempotent."],
      tests: [
        "record matches schedule criteria",
        "record excluded",
        "repeat execution",
        "bulk batch",
      ],
    },
    "platform-event-triggered": {
      process_type: "AutoLaunchedFlow",
      trigger_type: "PlatformEvent",
      contract: [
        ...common,
        `Confirm the platform event${eventName ? ` (${eventName})` : ""} and prevent self-publishing loops.`,
        "Do not plan a Subflow element for a platform event-triggered Flow.",
      ],
      tests: ["matching event", "filtered event", "duplicate delivery", "self-publish guard"],
    },
    "omni-channel": {
      process_type: "RoutingFlow",
      contract: [
        ...common,
        "Define recordId as a scalar Text input and pass it to every Route Work action.",
        "Ground the service channel and destination in the target org before replacing placeholders.",
        "Use Omni-Channel action version 2.0.0 for portable new metadata.",
        "End each successful routing branch with Route Work and define fallback or no-route behavior.",
        ...(omniOptions?.destination === "agent"
          ? ["Provide a fallback queue for direct-agent routing."]
          : []),
        ...(omniOptions?.destination === "skills"
          ? ["Ground the queue routing configuration and target-org skills-based routing rules."]
          : []),
        ...(omniOptions?.check_availability
          ? [
              "Route only after a matching Check Availability result; send action faults to the no-route path.",
            ]
          : []),
      ],
      tests: [
        "work item reaches the intended destination",
        "destination unavailable",
        "fallback routing",
        "intentional no-route path",
      ],
    },
  };
  return {
    family,
    ...byFamily[family],
    ...(family === "omni-channel" && omniOptions ? omniOptions : {}),
    ...(recordEvent ? { record_trigger_type: recordTriggerType(recordEvent) } : {}),
  };
}

function metadataSkeleton(
  family: Exclude<FlowFamily, "specialized" | "unknown" | "omni-channel">,
  timing: TriggerTiming | undefined,
  recordEvent: SfFlowParams["record_event"] | undefined,
  objectName: string | undefined,
  eventName: string | undefined,
  apiVersion: string,
): string {
  const processType = family === "screen" ? "Flow" : "AutoLaunchedFlow";
  const trigger =
    family === "record-triggered"
      ? triggerType(timing)
      : family === "schedule-triggered"
        ? "Scheduled"
        : family === "platform-event-triggered"
          ? "PlatformEvent"
          : undefined;
  const familyElements =
    family === "screen"
      ? [
          "    <screens>",
          "        <name>TODO_Screen</name>",
          "        <label>TODO Screen</label>",
          "        <locationX>176</locationX>",
          "        <locationY>158</locationY>",
          "        <allowBack>true</allowBack>",
          "        <allowFinish>true</allowFinish>",
          "        <allowPause>false</allowPause>",
          "        <showFooter>true</showFooter>",
          "        <showHeader>true</showHeader>",
          "    </screens>",
        ]
      : [];
  const targetObject = eventName ?? objectName;
  const startFields = [
    family === "screen"
      ? "        <connector>\n            <targetReference>TODO_Screen</targetReference>\n        </connector>"
      : undefined,
    targetObject ? `        <object>${escapeXml(targetObject)}</object>` : undefined,
    family === "record-triggered" && recordEvent
      ? `        <recordTriggerType>${recordTriggerType(recordEvent)}</recordTriggerType>`
      : undefined,
    family === "schedule-triggered"
      ? [
          "        <schedule>",
          "            <frequency>TODO</frequency>",
          "            <startDate>TODO</startDate>",
          "            <startTime>TODO</startTime>",
          "        </schedule>",
        ].join("\n")
      : undefined,
    trigger ? `        <triggerType>${trigger}</triggerType>` : undefined,
  ].filter(Boolean);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Flow xmlns="http://soap.sforce.com/2006/04/metadata">',
    `    <apiVersion>${apiVersion}</apiVersion>`,
    ...familyElements,
    "    <description>TODO</description>",
    "    <label>TODO</label>",
    "    <processMetadataValues>",
    "        <name>CanvasMode</name>",
    "        <value><stringValue>AUTO_LAYOUT_CANVAS</stringValue></value>",
    "    </processMetadataValues>",
    `    <processType>${processType}</processType>`,
    "    <start>",
    "        <locationX>50</locationX>",
    "        <locationY>50</locationY>",
    ...startFields,
    "    </start>",
    "    <status>Draft</status>",
    "</Flow>",
  ].join("\n");
}

function resolveRecordEvent(
  explicit: SfFlowParams["record_event"],
  intent: string,
  timing: TriggerTiming | undefined,
): SfFlowParams["record_event"] | undefined {
  if (explicit) return explicit;
  if (timing === "before-delete" || /\b(deleted|delete|deletion)\b/i.test(intent)) return "delete";
  if (/\b(created? and updated?|create[- ]and[- ]update)\b/i.test(intent))
    return "create-and-update";
  if (/\b(created?|creation|new record)\b/i.test(intent)) return "create";
  if (/\b(updated?|changes?|changed)\b/i.test(intent)) return "update";
  return undefined;
}

function recordTriggerType(event: NonNullable<SfFlowParams["record_event"]>): string {
  if (event === "create") return "Create";
  if (event === "update") return "Update";
  if (event === "create-and-update") return "CreateAndUpdate";
  return "Delete";
}

function triggerType(timing: TriggerTiming | undefined): string {
  if (timing === "before-save") return "RecordBeforeSave";
  if (timing === "before-delete") return "RecordBeforeDelete";
  return "RecordAfterSave";
}

function selectionReason(family: FlowFamily, timing?: TriggerTiming): string {
  if (family === "record-triggered" && timing === "before-save")
    return "same-record update before commit";
  if (family === "record-triggered") return `${timing} record automation`;
  if (family === "screen") return "interactive user journey";
  if (family === "autolaunched") return "reusable caller-invoked automation";
  if (family === "schedule-triggered") return "global recurring schedule";
  if (family === "omni-channel") return "service-channel work routing";
  return "event message subscriber";
}

async function projectApiVersion(cwd: string): Promise<string> {
  try {
    const project = JSON.parse(await readFile(path.join(cwd, "sfdx-project.json"), "utf8")) as {
      sourceApiVersion?: unknown;
    };
    if (
      typeof project.sourceApiVersion === "string" &&
      /^\d+(?:\.\d+)?$/.test(project.sourceApiVersion)
    ) {
      return project.sourceApiVersion;
    }
  } catch {
    // A local plan can still provide the documented V1 baseline.
  }
  return "68.0";
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
