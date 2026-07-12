/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Gateway model resolution helpers.
 *
 * This module is the narrow seam where SF Pi delegates generic provider/model
 * parsing to Pi's native resolver while retaining gateway-specific fallback
 * rules for static bootstrap + dynamic discovery timing. Keep scoped-model
 * enable/disable behavior in `pi-settings.ts`; that is SF Pi product logic,
 * not generic model parsing.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import { resolveCliModel, type ModelRegistry } from "@earendil-works/pi-coding-agent";
import { findMatchingModelId, resolvePreferredModelId } from "./models.ts";

type GatewayThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface GatewayDefaultModelResolution {
  provider: string;
  modelId: string;
  thinkingLevel: GatewayThinkingLevel;
  source: "pi" | "fallback";
  model?: Model<Api>;
  warning?: string;
}

export interface ResolveGatewayDefaultModelOptions {
  modelRegistry: ModelRegistry;
  providerName: string;
  availableModelIds: string[];
  preferredModelIds: Array<string | undefined>;
  fallbackModelId: string;
  defaultThinkingLevel: GatewayThinkingLevel;
}

export function resolveGatewayDefaultModelWithPi(
  options: ResolveGatewayDefaultModelOptions,
): GatewayDefaultModelResolution {
  const {
    modelRegistry,
    providerName,
    availableModelIds,
    preferredModelIds,
    fallbackModelId,
    defaultThinkingLevel,
  } = options;

  for (const preferredId of preferredModelIds) {
    const candidateId = findMatchingModelId(preferredId, availableModelIds);
    if (!candidateId) continue;

    const resolved = resolveCliModel({
      cliProvider: providerName,
      cliModel: candidateId,
      cliThinking: defaultThinkingLevel,
      modelRegistry,
    });

    if (
      resolved.model &&
      resolved.model.provider === providerName &&
      isRegisteredGatewayModel(modelRegistry, providerName, resolved.model.id)
    ) {
      return {
        provider: providerName,
        modelId: resolved.model.id,
        model: resolved.model,
        thinkingLevel: resolved.thinkingLevel ?? defaultThinkingLevel,
        source: "pi",
        warning: resolved.warning,
      };
    }
  }

  const fallbackModelIdFromAvailable =
    resolvePreferredModelId(availableModelIds, preferredModelIds) ?? fallbackModelId;
  return {
    provider: providerName,
    modelId: fallbackModelIdFromAvailable,
    model: modelRegistry.find(providerName, fallbackModelIdFromAvailable),
    thinkingLevel: defaultThinkingLevel,
    source: "fallback",
  };
}

function isRegisteredGatewayModel(
  modelRegistry: ModelRegistry,
  providerName: string,
  modelId: string,
): boolean {
  return modelRegistry
    .getAll()
    .some((model) => model.provider === providerName && model.id === modelId);
}
