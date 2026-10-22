/* SPDX-License-Identifier: Apache-2.0 */
/** Dedicated-model policy; Pi owns summary construction and checkpoint formatting. */
import { contentText } from "@earendil-works/pi-ai";
import {
  compact,
  estimateTokens,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import {
  ACTIVE_COMPACTION_MODEL,
  readEffectiveCompactionSettings,
  type EffectiveCompactionSettings,
} from "./compaction-settings.ts";
import { PROVIDER_NAME } from "./config.ts";

const CONTEXT_SAFETY_TOKENS = 4_096;

type GatewayCompactionPreference = Pick<EffectiveCompactionSettings, "model" | "source"> &
  Partial<Pick<EffectiveCompactionSettings, "enabled" | "enabledSource">>;

export interface GatewayCompactionDependencies {
  readSettings?: (cwd: string) => GatewayCompactionPreference;
}

export async function handleGatewayCompaction(
  event: SessionBeforeCompactEvent,
  ctx: ExtensionContext,
  dependencies: GatewayCompactionDependencies = {},
) {
  const preference = dependencies.readSettings
    ? dependencies.readSettings(ctx.cwd)
    : readEffectiveCompactionSettings(ctx.cwd, undefined, ctx.isProjectTrusted());
  if (preference.model === ACTIVE_COMPACTION_MODEL) return undefined;
  if (event.signal.aborted) return { cancel: true };

  const modelId = preference.model.slice(`${PROVIDER_NAME}/`.length);
  const model = ctx.modelRegistry
    .getAvailable()
    .find((candidate) => candidate.provider === PROVIDER_NAME && candidate.id === modelId);
  if (!model) {
    warnFallback(ctx, `Configured compaction model ${preference.model} is unavailable.`);
    return undefined;
  }

  let cancelled = false;
  let failure = `Configured compaction model ${preference.model} failed. Run /sf-llm-gateway doctor.`;
  try {
    const result = await compact(
      event.preparation,
      model,
      undefined,
      undefined,
      event.customInstructions,
      event.signal,
      undefined,
      async (summaryModel, context, options) => {
        // Check Pi's actual prompt before dispatch, rather than maintaining a second prompt.
        const inputTokens = context.messages.reduce(
          (sum, message) => sum + estimateTokens(message),
          0,
        );
        const outputTokens = options?.maxTokens ?? Math.max(0, summaryModel.maxTokens);
        if (
          summaryModel.contextWindow > 0 &&
          inputTokens + outputTokens + CONTEXT_SAFETY_TOKENS > summaryModel.contextWindow
        ) {
          failure = `Configured compaction model ${preference.model} cannot fit this checkpoint request.`;
          throw new Error("Summary exceeds model context");
        }

        const stream = ctx.modelRegistry.streamSimple(summaryModel, context, options);
        const response = await stream.result();
        if (event.signal.aborted || response.stopReason === "aborted") {
          cancelled = true;
          throw new Error("Summary cancelled");
        }
        // Pi rejects length/error/tool-call responses, but does not reject every non-stop
        // or blank response. Validate each part before Pi adds file lists or merges a split turn.
        if (response.stopReason !== "stop" || !contentText(response.content).trim()) {
          throw new Error("Summary did not finish with text");
        }
        return stream;
      },
    );
    if (event.signal.aborted) return { cancel: true };
    return { compaction: result };
  } catch {
    if (cancelled || event.signal.aborted) return { cancel: true };
    warnFallback(ctx, failure);
    return undefined;
  }
}

function warnFallback(ctx: ExtensionContext, reason: string): void {
  if (!ctx.hasUI) return;
  ctx.ui.notify(`${reason} Falling back to Pi's active-model compaction.`, "warning");
}
