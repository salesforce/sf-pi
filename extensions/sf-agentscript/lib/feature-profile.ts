/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Lightweight feature classifier for Agent Script source / inspect output.
 *
 * This keeps channel/preview/publish-risk reasoning in one place instead of
 * scattering regexes through lifecycle, inspect, and eval code paths.
 */

import type { InspectResult, VariableSummary } from "./inspect.ts";

export interface AgentFeatureProfile {
  linked_variables: Array<{
    name: string;
    type?: string;
    source?: string;
    source_namespace?: string;
    source_field?: string;
    suggested_preview_value?: string | number | boolean;
  }>;
  mutable_variables: Array<{ name: string; type?: string; default?: unknown }>;
  context_variables_template: Array<{
    name: string;
    type: string;
    value: string | number | boolean;
    label?: string;
    description?: string;
  }>;
  modalities: string[];
  response_formats: Array<{
    connection: string;
    name: string;
    source?: string;
    target?: string;
  }>;
  connection_names: string[];
  utility_refs: string[];
  publish_risks: FeatureRisk[];
}

export interface FeatureRisk {
  code:
    | "voice_linked_variable_publish_may_require_channel_entitlement"
    | "voice_modality_publish_may_require_channel_entitlement"
    | "connection_surface_publish_may_require_channel_entitlement"
    | "response_format_publish_may_require_surface_entitlement";
  severity: "warn";
  message: string;
  evidence: string[];
}

export function buildFeatureProfile(inspect: InspectResult): AgentFeatureProfile {
  const components = inspect.components;
  const variables = components?.variables ?? [];
  const linked = variables.filter((v) => v.linked || v.modifier === "linked" || v.source);
  const mutable = variables.filter((v) => v.mutable || v.modifier === "mutable");
  const modalities = (components?.modalities ?? []).map((m) => m.name).sort();
  const connections = components?.connections ?? [];
  const responseFormats = connections.flatMap((conn) =>
    (conn.response_formats ?? []).map((format) => ({
      connection: conn.name,
      name: format.name,
      ...(format.source ? { source: format.source } : {}),
      ...(format.target ? { target: format.target } : {}),
    })),
  );
  const utilityRefs = unique(
    [
      ...(components?.start_agents ?? []),
      ...(components?.topics ?? []),
      ...(components?.subagents ?? []),
      ...(components?.actions ?? []),
      ...(components?.connections ?? []),
    ].flatMap((component) => component.utility_refs ?? []),
  );

  return {
    linked_variables: linked.map((v) => ({
      name: v.name,
      ...(v.type ? { type: v.type } : {}),
      ...(v.source ? { source: v.source } : {}),
      ...(v.source_namespace ? { source_namespace: v.source_namespace } : {}),
      ...(v.source_field ? { source_field: v.source_field } : {}),
      suggested_preview_value: suggestedValue(v),
    })),
    mutable_variables: mutable.map((v) => ({
      name: v.name,
      ...(v.type ? { type: v.type } : {}),
      ...(v.default !== undefined ? { default: v.default } : {}),
    })),
    context_variables_template: [...linked, ...mutable].map((v) => ({
      name: v.name,
      type: wireTypeFor(v.type),
      value: suggestedValue(v),
      ...(v.source ? { label: v.source } : {}),
      ...(v.source
        ? { description: `Preview seed for linked variable ${v.name} (${v.source})` }
        : {}),
    })),
    modalities,
    response_formats: responseFormats,
    connection_names: connections.map((connection) => connection.name).sort(),
    utility_refs: utilityRefs,
    publish_risks: buildPublishRisks({
      linked,
      modalities,
      responseFormats,
      connections,
    }),
  };
}

export function hasChannelGatedRisk(profile: AgentFeatureProfile): boolean {
  return profile.publish_risks.some((risk) =>
    [
      "voice_linked_variable_publish_may_require_channel_entitlement",
      "voice_modality_publish_may_require_channel_entitlement",
      "connection_surface_publish_may_require_channel_entitlement",
      "response_format_publish_may_require_surface_entitlement",
    ].includes(risk.code),
  );
}

function buildPublishRisks(input: {
  linked: VariableSummary[];
  modalities: string[];
  responseFormats: Array<{ connection: string; name: string; source?: string; target?: string }>;
  connections: Array<{ name: string }>;
}): FeatureRisk[] {
  const risks: FeatureRisk[] = [];
  const voiceLinked = input.linked.filter((v) => v.source_namespace === "VoiceCall");
  if (voiceLinked.length > 0) {
    risks.push({
      code: "voice_linked_variable_publish_may_require_channel_entitlement",
      severity: "warn",
      message:
        "VoiceCall-linked variables compile and can be preview-seeded, but publish may require voice/channel entitlement in the target org.",
      evidence: voiceLinked.map((v) => `${v.name}: ${v.source ?? "@VoiceCall.*"}`),
    });
  }
  if (input.modalities.includes("voice")) {
    risks.push({
      code: "voice_modality_publish_may_require_channel_entitlement",
      severity: "warn",
      message:
        "modality voice is compile-valid, but publish can fail when the target org lacks voice-channel support for Agentforce.",
      evidence: ["modality voice"],
    });
  }
  if (input.connections.length > 0) {
    risks.push({
      code: "connection_surface_publish_may_require_channel_entitlement",
      severity: "warn",
      message:
        "connection blocks can depend on channel/surface entitlements; compile/inspect may pass while preview/publish fails in orgs without that surface.",
      evidence: input.connections.map((c) => `connection ${c.name}`),
    });
  }
  if (input.responseFormats.length > 0) {
    risks.push({
      code: "response_format_publish_may_require_surface_entitlement",
      severity: "warn",
      message:
        "response_formats can depend on a surface entitlement or target implementation. Validate in an entitled org before relying on publish.",
      evidence: input.responseFormats.map((f) => `${f.connection}.${f.name}`),
    });
  }
  return risks;
}

function wireTypeFor(type: string | undefined): string {
  switch ((type ?? "").toLowerCase()) {
    case "boolean":
      return "Boolean";
    case "number":
    case "integer":
    case "long":
      return "Number";
    case "id":
      return "Id";
    default:
      return "Text";
  }
}

function suggestedValue(v: VariableSummary): string | number | boolean {
  if (v.default !== undefined && typeof v.default !== "object")
    return v.default as string | number | boolean;
  if (v.source_namespace === "VoiceCall") return "0LQ000000000001AAA";
  const lower = v.name.toLowerCase();
  if (lower.includes("phone")) return "+15551234567";
  if (lower.includes("verified") || lower.startsWith("is")) return true;
  if ((v.type ?? "").toLowerCase() === "boolean") return true;
  if (["number", "integer", "long"].includes((v.type ?? "").toLowerCase())) return 1;
  return `Example ${humanize(v.name)}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || value;
}
