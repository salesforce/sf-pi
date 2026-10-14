/* SPDX-License-Identifier: Apache-2.0 */
/** Gateway compatibility for image-bearing OpenAI Responses tool outputs. */
import type { Api, Model, StreamOptions } from "@earendil-works/pi-ai";

interface ResponsesPart {
  type: string;
  [key: string]: unknown;
}

interface ResponsesItem {
  type?: string;
  output?: unknown;
  [key: string]: unknown;
}

interface PendingImageGroup {
  label: string;
  images: ResponsesPart[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPart(value: unknown): value is ResponsesPart {
  return isRecord(value) && typeof value.type === "string";
}

function isImagePart(part: ResponsesPart): boolean {
  return part.type === "input_image";
}

function isTextPart(part: ResponsesPart): part is ResponsesPart & { text: string } {
  return part.type === "input_text" && typeof part.text === "string";
}

function isToolResultRunItem(item: ResponsesItem): boolean {
  return (
    item.type === "function_call_output" ||
    item.type === "tool_search_call" ||
    item.type === "tool_search_output"
  );
}

function hoistToolResultImages(input: unknown[]): ResponsesItem[] | undefined {
  const imageOutputs = input.filter(
    (item): item is ResponsesItem & { output: ResponsesPart[] } =>
      isRecord(item) &&
      item.type === "function_call_output" &&
      Array.isArray(item.output) &&
      item.output.some((part) => isPart(part) && isImagePart(part)),
  );
  if (imageOutputs.length === 0) return undefined;

  // Pi currently emits only input_text and input_image here. If another payload hook adds an
  // unknown part, leave the complete payload untouched instead of silently discarding content.
  if (
    imageOutputs.some((item) =>
      item.output.some((part) => !isPart(part) || (!isImagePart(part) && !isTextPart(part))),
    )
  ) {
    return undefined;
  }

  const out: ResponsesItem[] = [];
  let pending: PendingImageGroup[] = [];
  let nextGroup = 1;
  let changed = false;

  const flush = () => {
    if (pending.length === 0) return;
    out.push({
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "Images returned by the tool calls above:" },
        ...pending.flatMap((group) => [
          { type: "input_text", text: `${group.label}:` },
          ...group.images,
        ]),
      ],
    });
    pending = [];
  };

  for (const value of input) {
    const item = isRecord(value) ? (value as ResponsesItem) : undefined;
    if (!item) {
      flush();
      out.push(value as ResponsesItem);
      continue;
    }
    if (!isToolResultRunItem(item)) flush();

    if (
      item.type !== "function_call_output" ||
      !Array.isArray(item.output) ||
      !item.output.some((part) => isPart(part) && isImagePart(part))
    ) {
      out.push(item);
      continue;
    }

    const parts = item.output as ResponsesPart[];
    const text = parts
      .filter(isTextPart)
      .map((part) => part.text)
      .join("\n");
    const images = parts.filter(isImagePart);
    const label = `Tool image group ${nextGroup++}`;
    const marker = `[${label}: ${images.length} image(s) attached in the next user message.]`;
    out.push({ ...item, output: text ? `${text}\n${marker}` : marker });
    pending.push({ label, images });
    changed = true;
  }

  flush();
  return changed ? out : undefined;
}

function normalizeGatewayResponsesPayload(payload: unknown): unknown | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.input)) return undefined;
  const input = hoistToolResultImages(payload.input);
  return input ? { ...payload, input } : undefined;
}

export function withGatewayResponsesToolImageCompatibility<T extends StreamOptions>(
  model: Model<Api>,
  options?: T,
): T | undefined {
  if (model.provider !== "sf-llm-gateway" || model.api !== "openai-responses") return options;

  return {
    ...options,
    async onPayload(payload: unknown, requestModel: Model<Api>) {
      const replacement = await options?.onPayload?.(payload, requestModel);
      const next = replacement === undefined ? payload : replacement;
      if (requestModel.provider !== "sf-llm-gateway" || requestModel.api !== "openai-responses") {
        return replacement;
      }
      return normalizeGatewayResponsesPayload(next) ?? replacement;
    },
  } as T;
}
