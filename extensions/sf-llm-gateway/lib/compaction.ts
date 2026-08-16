/* SPDX-License-Identifier: Apache-2.0 */
/** Dedicated-model compaction policy for SF LLM Gateway. */
import { contentText, uuidv7, type Api, type Model } from "@earendil-works/pi-ai";
import {
  convertToLlm,
  serializeConversation,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import {
  ACTIVE_COMPACTION_MODEL,
  readEffectiveCompactionSettings,
  type EffectiveCompactionSettings,
} from "./compaction-settings.ts";
import { PROVIDER_NAME } from "./config.ts";

const MAX_SUMMARY_TOKENS = 8_192;
const CONTEXT_SAFETY_TOKENS = 4_096;
const SUMMARY_SYSTEM_PROMPT =
  "You are a context summarization assistant. Return only a structured checkpoint that another agent can use to continue the work.";
const SUMMARY_FORMAT = `Use this exact structure:

## Goal
[Current objective]

## Constraints & Preferences
- [Requirements and constraints]

## Progress
### Done
- [x] [Completed work]

### In Progress
- [ ] [Current work]

### Blocked
- [Current blockers]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [Ordered next action]

## Critical Context
- [Exact paths, function names, errors, data, or references needed to continue]

Keep every section concise. Preserve exact technical identifiers and error messages.`;

export interface GatewayCompactionDependencies {
  readSettings?: (cwd: string) => EffectiveCompactionSettings;
}

export async function handleGatewayCompaction(
  event: SessionBeforeCompactEvent,
  ctx: ExtensionContext,
  dependencies: GatewayCompactionDependencies = {},
) {
  const preference = (dependencies.readSettings ?? readEffectiveCompactionSettings)(ctx.cwd);
  if (preference.model === ACTIVE_COMPACTION_MODEL) return undefined;

  const modelId = preference.model.slice(`${PROVIDER_NAME}/`.length);
  const model = ctx.modelRegistry
    .getAvailable()
    .find((candidate) => candidate.provider === PROVIDER_NAME && candidate.id === modelId);
  if (!model) {
    warnFallback(ctx, `Configured compaction model ${preference.model} is unavailable.`);
    return undefined;
  }

  const prompt = buildSummaryPrompt(event);
  const maxTokens = Math.min(MAX_SUMMARY_TOKENS, positiveMaxTokens(model));
  if (!fitsContext(model, prompt, maxTokens)) {
    warnFallback(
      ctx,
      `Configured compaction model ${preference.model} cannot fit this checkpoint request.`,
    );
    return undefined;
  }

  try {
    const response = await ctx.modelRegistry.complete(
      model,
      {
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        maxTokens,
        signal: event.signal,
        cacheRetention: "none",
        sessionId: uuidv7(),
      },
    );

    if (event.signal.aborted || response.stopReason === "aborted") return { cancel: true };
    if (response.stopReason !== "stop") {
      warnFallback(ctx, `Configured compaction model ${preference.model} did not finish normally.`);
      return undefined;
    }

    const summaryText = contentText(response.content).trim();
    if (!summaryText) {
      warnFallback(
        ctx,
        `Configured compaction model ${preference.model} returned an empty summary.`,
      );
      return undefined;
    }

    const { readFiles, modifiedFiles } = computeFileLists(event.preparation.fileOps);
    const summary = `${summaryText}${formatFileOperations(readFiles, modifiedFiles)}`;
    return {
      compaction: {
        summary,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        usage: response.usage,
        details: { readFiles, modifiedFiles },
      },
    };
  } catch {
    if (event.signal.aborted) return { cancel: true };
    warnFallback(
      ctx,
      `Configured compaction model ${preference.model} failed. Run /sf-llm-gateway doctor.`,
    );
    return undefined;
  }
}

function buildSummaryPrompt(event: SessionBeforeCompactEvent): string {
  const messages = [
    ...event.preparation.messagesToSummarize,
    ...event.preparation.turnPrefixMessages,
  ];
  const conversation = serializeConversation(convertToLlm(messages));
  const previousSummary = event.preparation.previousSummary
    ? `\n\n<previous-summary>\n${event.preparation.previousSummary}\n</previous-summary>`
    : "";
  const customInstructions = event.customInstructions
    ? `\n\nAdditional focus:\n${event.customInstructions}`
    : "";
  return `<conversation>\n${conversation}\n</conversation>${previousSummary}\n\n${SUMMARY_FORMAT}${customInstructions}`;
}

function positiveMaxTokens(model: Model<Api>): number {
  return model.maxTokens > 0 ? model.maxTokens : MAX_SUMMARY_TOKENS;
}

function fitsContext(model: Model<Api>, prompt: string, maxTokens: number): boolean {
  if (model.contextWindow <= 0) return true;
  const estimatedInputTokens = Math.ceil((SUMMARY_SYSTEM_PROMPT.length + prompt.length) / 4);
  return estimatedInputTokens + maxTokens + CONTEXT_SAFETY_TOKENS <= model.contextWindow;
}

function computeFileLists(fileOps: SessionBeforeCompactEvent["preparation"]["fileOps"]): {
  readFiles: string[];
  modifiedFiles: string[];
} {
  const modified = new Set([...fileOps.edited, ...fileOps.written]);
  return {
    readFiles: [...fileOps.read].filter((file) => !modified.has(file)).sort(),
    modifiedFiles: [...modified].sort(),
  };
}

function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
  const sections: string[] = [];
  if (readFiles.length > 0) sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
  if (modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
  }
  return sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";
}

function warnFallback(ctx: ExtensionContext, reason: string): void {
  if (!ctx.hasUI) return;
  ctx.ui.notify(`${reason} Falling back to Pi's active-model compaction.`, "warning");
}
