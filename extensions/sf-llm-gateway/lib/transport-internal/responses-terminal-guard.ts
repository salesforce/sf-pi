/* SPDX-License-Identifier: Apache-2.0 */
/** Finish Gateway Responses streams from protocol terminal events, even when HTTP EOF is late. */
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type StreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { recordProviderStreamRecovery } from "../provider-telemetry.ts";

const TERMINAL_CLOSE_GRACE_MS = 1_000;

type ResponsesStreamer<TOptions extends StreamOptions> = (
  model: Model<"openai-responses">,
  context: TranscriptContext,
  options?: TOptions,
) => AssistantMessageEventStream;

type TerminalObservation = {
  count: number;
  status: string;
  incompleteReason?: string;
  unfinishedOutputItems: number;
};

export function streamGatewayResponsesWithTerminalGuard<TOptions extends StreamOptions>(
  model: Model<"openai-responses">,
  context: TranscriptContext,
  options: TOptions | undefined,
  streamer: ResponsesStreamer<TOptions>,
): AssistantMessageEventStream {
  if (model.provider !== "sf-llm-gateway") {
    return streamer(model, context, options);
  }

  const stream = createAssistantMessageEventStream();
  const parentSignal = options?.signal;
  const closeController = new AbortController();
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, closeController.signal])
    : closeController.signal;
  const openOutputItems = new Set<number>();
  const completedOutputItems = new Set<number>();
  let terminal: TerminalObservation | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let terminalCloseAbort = false;

  const clearCloseTimer = () => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = undefined;
  };

  const observeProviderEvent: NonNullable<StreamOptions["onProviderStreamEvent"]> = async (
    data,
    eventModel,
  ) => {
    const event = asRecord(data);
    const eventType = typeof event?.type === "string" ? event.type : undefined;
    const outputIndex = typeof event?.output_index === "number" ? event.output_index : undefined;
    if (eventType === "response.output_item.added" && outputIndex !== undefined) {
      openOutputItems.add(outputIndex);
    } else if (eventType === "response.output_item.done" && outputIndex !== undefined) {
      openOutputItems.delete(outputIndex);
      completedOutputItems.add(outputIndex);
    } else if (eventType === "response.completed" || eventType === "response.incomplete") {
      const response = asRecord(event?.response);
      const incompleteDetails = asRecord(response?.incomplete_details);
      const terminalOutputCount = Array.isArray(response?.output) ? response.output.length : 0;
      const missingLifecycleItems = Math.max(0, terminalOutputCount - completedOutputItems.size);
      terminal = {
        count: (terminal?.count ?? 0) + 1,
        status:
          typeof response?.status === "string"
            ? response.status
            : eventType === "response.completed"
              ? "completed"
              : "incomplete",
        incompleteReason:
          typeof incompleteDetails?.reason === "string" ? incompleteDetails.reason : undefined,
        unfinishedOutputItems: Math.max(openOutputItems.size, missingLifecycleItems),
      };
    }

    await options?.onProviderStreamEvent?.(data, eventModel);

    if (terminal && !closeTimer) {
      closeTimer = setTimeout(() => {
        terminalCloseAbort = true;
        closeController.abort();
      }, TERMINAL_CLOSE_GRACE_MS);
      closeTimer.unref?.();
    }
  };

  const upstream = streamer(model, context, {
    ...options,
    signal,
    onProviderStreamEvent: observeProviderEvent,
  } as TOptions);

  void (async () => {
    try {
      for await (const event of upstream) {
        if (event.type === "done") {
          clearCloseTimer();
          stream.push(event);
          stream.end();
          return;
        }
        if (event.type === "error") {
          clearCloseTimer();
          const recovered = recoverTerminalMessage(
            event.error,
            terminal,
            terminalCloseAbort,
            parentSignal,
          );
          if (recovered) {
            recordProviderStreamRecovery(model.id);
            stream.push({ type: "done", reason: recovered.stopReason, message: recovered });
          } else {
            stream.push(event);
          }
          stream.end();
          return;
        }
        stream.push(event);
      }
    } finally {
      clearCloseTimer();
    }
  })();

  return stream;
}

function recoverTerminalMessage(
  message: AssistantMessage,
  terminal: TerminalObservation | undefined,
  terminalCloseAbort: boolean,
  parentSignal: AbortSignal | undefined,
): (AssistantMessage & { stopReason: "stop" | "length" | "toolUse" }) | undefined {
  if (!terminalCloseAbort || parentSignal?.aborted || !terminal) return undefined;
  if (terminal.count !== 1 || terminal.unfinishedOutputItems !== 0) return undefined;
  if (terminal.status !== "completed" && terminal.status !== "incomplete") return undefined;

  const stopReason =
    terminal.status === "incomplete" && terminal.incompleteReason === "max_output_tokens"
      ? "length"
      : message.content.some((block) => block.type === "toolCall")
        ? "toolUse"
        : "stop";
  if (terminal.status === "incomplete" && stopReason !== "length") return undefined;

  const completed = { ...message };
  delete completed.errorMessage;
  return {
    ...completed,
    stopReason,
    rawStopReason:
      terminal.status === "incomplete" && terminal.incompleteReason
        ? `incomplete.${terminal.incompleteReason}`
        : terminal.status,
    diagnostics: [
      ...(completed.diagnostics ?? []),
      {
        type: "sf-llm-gateway.terminal-close-recovered",
        timestamp: Date.now(),
        details: { graceMs: TERMINAL_CLOSE_GRACE_MS },
      },
    ],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}
