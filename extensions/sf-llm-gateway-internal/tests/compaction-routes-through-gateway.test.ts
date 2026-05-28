/* SPDX-License-Identifier: Apache-2.0 */
/**
 * pi 0.75 → gateway compaction handoff regression net.
 *
 * Pi 0.75 (#4484) made `compaction.generateSummary()` accept a `streamFn`
 * argument and call it when present, so the active provider's
 * `streamSimple` handles compaction summary calls instead of pi-ai's
 * built-in transport. That preserves our single-LLM-I/O-choke-point
 * invariant for the gateway:
 *
 *   prompt caching, Opus 4.7 early-stream retry, gpt-5.5 /responses fallback,
 *   reasoning_effort fixups, billing visibility — all of these live in
 *   `unifiedStream` and would silently bypass on compaction without
 *   #4484.
 *
 * We can't observe pi's session manager calling `generateSummary` from a
 * unit test without standing up a full agent, but `generateSummary` is a
 * pure pi export. This test calls it directly with a mock `streamFn` and
 * asserts the mock was called. Combined with the existing
 * unified-provider test that asserts we register `streamSimple:
 * unifiedStream`, the two close the loop:
 *
 *   pi.generateSummary(streamFn)  →  fakeStreamFn (here)
 *   pi.registerProvider({ streamSimple: unifiedStream })
 *     →  pi looks up streamSimple at compaction time and uses it as streamFn
 *
 * If pi ever stops threading streamFn into compaction, this test fails
 * before users notice the gateway being bypassed.
 */
import { describe, expect, it } from "vitest";
import { generateSummary } from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";

/** Minimal Model<openai-completions> for compaction. None of the network or
 *  provider-specific fields are exercised because we never let pi-ai actually
 *  call out — our fake streamFn intercepts before that. */
function fakeModel(): Model<"openai-completions"> {
  return {
    id: "fake-gateway-model",
    name: "Fake Gateway Model",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://gateway.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8_000,
  };
}

function fakeAssistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "openrouter",
    model: "fake-gateway-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/**
 * pi-ai's `Message` is a structural subset of pi's `AgentMessage` (the latter
 * adds a few custom roles like `bashExecution` and `compactionSummary`).
 * `generateSummary` only ever invokes the message-shape branches, so passing
 * a plain `Message[]` is the lowest-friction shape that TS still accepts.
 */
function userMessages(): Message[] {
  return [
    {
      role: "user",
      content: [{ type: "text", text: "Help me with a Salesforce thing." }],
      timestamp: Date.now(),
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "Sure, what do you need?" }],
      api: "openai-completions",
      provider: "openrouter",
      model: "fake-gateway-model",
      usage: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 150,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  ];
}

describe("pi compaction → gateway streamFn handoff (pi 0.75 #4484)", () => {
  it("calls the provider streamFn passed in to generateSummary", async () => {
    let streamFnCalls = 0;
    let lastModelSeen: Model<"openai-completions"> | null = null;
    let lastSystemPromptSeen: string | undefined;

    const fakeStreamFn = (
      m: Model<"openai-completions">,
      ctx: Context,
      _options?: SimpleStreamOptions,
    ) => {
      streamFnCalls++;
      lastModelSeen = m;
      lastSystemPromptSeen = ctx.systemPrompt;

      // Emit a minimal, well-formed event sequence so generateSummary's
      // `.result()` resolves to a non-error AssistantMessage. Without `start`
      // → `done`, pi treats the stream as malformed.
      const stream = createAssistantMessageEventStream();
      setTimeout(() => {
        const message = fakeAssistantMessage("[fake summary]");
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: "stop", message });
        stream.end();
      }, 0);
      return stream;
    };

    const summary = await generateSummary(
      userMessages(),
      fakeModel(),
      8_192,
      undefined, // apiKey
      undefined, // headers
      undefined, // signal
      undefined, // customInstructions
      undefined, // previousSummary
      undefined, // thinkingLevel
      fakeStreamFn,
    );

    // Primary assertion: the provider streamFn ran. If pi ever stops threading
    // `streamFn` through to the underlying complete call, this drops to 0 and
    // we fail before the gateway gets silently bypassed.
    expect(streamFnCalls).toBe(1);

    // Secondary checks that close the loop on what pi handed to streamFn:
    //   - the model object pi forwards is the one we asked it to summarize for
    //   - pi seeds the context with its summarization system prompt (so the
    //     mock matches the production call shape, not just any stream call)
    expect(lastModelSeen).not.toBeNull();
    expect(lastModelSeen?.id).toBe("fake-gateway-model");
    expect(lastSystemPromptSeen).toBeTruthy();

    // And the canned summary makes it back through generateSummary unchanged.
    expect(summary).toBe("[fake summary]");
  });
});
