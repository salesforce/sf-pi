/* SPDX-License-Identifier: Apache-2.0 */
/** Voice-specific projection over the existing official Agentforce AST summary. */

import type { InspectResult, ModalitySummary } from "./inspect.ts";

export type VoiceSyntax = "legacy" | "nested" | "mixed" | "unknown";
export type VoiceStreamingState = "enabled" | "disabled" | "deferred";

export interface VoiceProfileAdvisory {
  code: string;
  severity: "warning" | "info";
  message: string;
  evidence?: string[];
}

export interface VoiceProfile {
  syntax: VoiceSyntax;
  streaming: VoiceStreamingState;
  default_locale?: string;
  outbound: {
    model_id?: string;
    persona_id?: string;
    filler_sentences?: string[];
    parameters?: Record<string, string | number | boolean>;
  };
  inbound: {
    filler_words_detection?: boolean;
    keywords?: string[];
  };
  actions: {
    total: number;
    with_progress_indicator: number;
  };
  router?: {
    name: string;
    model?: string;
    transition_only: boolean;
  };
  advisories: VoiceProfileAdvisory[];
}

const LEGACY_FIELDS = new Set([
  "voice_id",
  "outbound_speed",
  "outbound_stability",
  "outbound_similarity",
  "outbound_style_exaggeration",
  "outbound_filler_sentences",
  "inbound_filler_words_detection",
  "inbound_keywords.keywords",
  "pronunciation_dict",
  "additional_configs",
]);

export function buildVoiceProfile(inspect: InspectResult): VoiceProfile | undefined {
  const voice = inspect.components?.modalities?.find((modality) => modality.name === "voice");
  if (!voice) return undefined;
  const fields = voice.fields ?? {};
  const syntax = voiceSyntax(voice);
  const streaming = streamingState(inspect.components?.config?.["runtime.streaming"]);
  const modelId = scalarString(fields["outbound.model.id"]);
  const parameters = prefixedScalars(fields, "outbound.model.parameters.");
  const advisories: VoiceProfileAdvisory[] = [];

  if (streaming === "disabled") {
    advisories.push({
      code: "voice-streaming-disabled",
      severity: "warning",
      message:
        "Voice streaming is explicitly disabled, which delays incremental customer-facing output.",
      evidence: ["config.runtime.streaming: False"],
    });
  }
  if (syntax === "legacy") {
    advisories.push({
      code: "voice-legacy-format",
      severity: "info",
      message:
        "This agent uses the supported legacy voice format. Prefer nested inbound/outbound configuration for new voice agents.",
    });
  }
  if (
    modelId === "eleven_v3_conversational" &&
    (parameters.speed !== undefined || parameters.similarity !== undefined)
  ) {
    const ignored = ["speed", "similarity"].filter((name) => parameters[name] !== undefined);
    advisories.push({
      code: "voice-v3-ignored-parameter",
      severity: "warning",
      message:
        "ElevenLabs v3 Conversational does not use speed or similarity overrides; remove ignored parameters or choose a model that supports them.",
      evidence: ignored.map((name) => `outbound.model.parameters.${name}`),
    });
  }

  const router = inspect.components?.start_agents?.[0];
  let routerProfile: VoiceProfile["router"];
  if (router) {
    const utilityRefs = router.utility_refs ?? [];
    const transitionOnly =
      utilityRefs.includes("transition") &&
      utilityRefs.every((name) => name === "transition") &&
      (router.action_refs?.length ?? 0) === 0 &&
      (router.connected_subagent_refs?.length ?? 0) === 0;
    routerProfile = {
      name: router.name,
      ...(router.model ? { model: router.model } : {}),
      transition_only: transitionOnly,
    };
    if (transitionOnly && router.model !== "model://sfdc_ai__DefaultEinsteinHyperClassifier") {
      advisories.push({
        code: "voice-router-hyperclassifier-candidate",
        severity: "info",
        message:
          "The start agent appears to route only through transitions. Evaluate EinsteinHyperClassifier for lower-latency classification before changing the model.",
        evidence: [`start_agent ${router.name}`],
      });
    }
  }

  const actions = (inspect.components?.actions ?? []).filter((action) => !!action.target);
  return {
    syntax,
    streaming,
    ...scalarProperty(inspect.components?.language?.fields?.default_locale, "default_locale"),
    outbound: {
      ...scalarProperty(modelId, "model_id"),
      ...scalarProperty(fields["outbound.persona_id"] ?? fields.voice_id, "persona_id"),
      ...stringArrayProperty(
        fields["outbound.filler_sentences"] ?? fields.outbound_filler_sentences,
        "filler_sentences",
      ),
      ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
    },
    inbound: {
      ...booleanProperty(
        fields["inbound.filler_words_detection"] ?? fields.inbound_filler_words_detection,
        "filler_words_detection",
      ),
      ...stringArrayProperty(
        fields["inbound.keywords"] ?? fields["inbound_keywords.keywords"],
        "keywords",
      ),
    },
    actions: {
      total: actions.length,
      with_progress_indicator: actions.filter(
        (action) => action.include_in_progress_indicator === true,
      ).length,
    },
    ...(routerProfile ? { router: routerProfile } : {}),
    advisories,
  };
}

function voiceSyntax(voice: ModalitySummary): VoiceSyntax {
  const keys = Object.keys(voice.fields ?? {});
  const nested = keys.some(
    (key) =>
      key.startsWith("inbound.") ||
      key.startsWith("outbound.") ||
      key.startsWith("language.") ||
      key.startsWith("language_settings.") ||
      key === "session_language_switching",
  );
  const legacy = keys.some((key) => LEGACY_FIELDS.has(key));
  if (nested && legacy) return "mixed";
  if (nested) return "nested";
  if (legacy) return "legacy";
  return "unknown";
}

function streamingState(value: unknown): VoiceStreamingState {
  return value === true ? "enabled" : value === false ? "disabled" : "deferred";
}

function prefixedScalars(
  fields: Record<string, unknown>,
  prefix: string,
): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith(prefix)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      values[key.slice(prefix.length)] = value;
    }
  }
  return values;
}

function scalarString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function scalarProperty<K extends string>(value: unknown, key: K): Partial<Record<K, string>> {
  return typeof value === "string" && value.length > 0
    ? ({ [key]: value } as Record<K, string>)
    : {};
}

function booleanProperty<K extends string>(value: unknown, key: K): Partial<Record<K, boolean>> {
  return typeof value === "boolean" ? ({ [key]: value } as Record<K, boolean>) : {};
}

function stringArrayProperty<K extends string>(
  value: unknown,
  key: K,
): Partial<Record<K, string[]>> {
  const strings = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  return strings.length > 0 ? ({ [key]: strings } as Record<K, string[]>) : {};
}
