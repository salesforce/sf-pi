/* SPDX-License-Identifier: Apache-2.0 */
/** Cache-only status projection for dedicated Gateway compaction. */
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  setCompactionStatus,
  type CompactionStatusSnapshot,
} from "../../../lib/common/compaction-status/store.ts";
import {
  ACTIVE_COMPACTION_MODEL,
  buildGatewayCompactionModelOptions,
  readEffectiveCompactionSettings,
} from "./compaction-settings.ts";
import { PROVIDER_NAME } from "./config.ts";

export function resolveGatewayCompactionStatus(
  cwd: string,
  models: readonly Pick<Model<Api>, "provider" | "id" | "name" | "contextWindow" | "maxTokens">[],
  projectTrusted: boolean,
): CompactionStatusSnapshot {
  const settings = readEffectiveCompactionSettings(cwd, undefined, projectTrusted);
  if (!settings.enabled) {
    return { kind: "disabled", source: settings.enabledSource };
  }
  if (settings.model === ACTIVE_COMPACTION_MODEL) {
    return { kind: "default", source: settings.source };
  }

  const option = buildGatewayCompactionModelOptions(models).find(
    (candidate) => candidate.value === settings.model,
  );
  const modelId = settings.model.slice(`${PROVIDER_NAME}/`.length);
  const model = models.find(
    (candidate) => candidate.provider === PROVIDER_NAME && candidate.id === modelId,
  );
  if (!option || !model) {
    return { kind: "unavailable", model: settings.model, source: settings.source };
  }

  return {
    kind: "dedicated",
    model: settings.model,
    modelLabel: option.label,
    contextWindow: model.contextWindow,
    source: settings.source,
  };
}

export function publishGatewayCompactionStatus(
  cwd: string,
  models: readonly Pick<Model<Api>, "provider" | "id" | "name" | "contextWindow" | "maxTokens">[],
  projectTrusted: boolean,
): CompactionStatusSnapshot {
  const status = resolveGatewayCompactionStatus(cwd, models, projectTrusted);
  setCompactionStatus(status);
  return status;
}
