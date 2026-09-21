/* SPDX-License-Identifier: Apache-2.0 */
/** Exact-Pi proof for the actionable settlement contract used by quality gates. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  createProvider,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "sf-pi-actionable-boundary-test";
const MODEL: Model<"openai-completions"> = {
  id: "boundary-model",
  provider: PROVIDER_ID,
  api: "openai-completions",
  name: "Boundary model",
  baseUrl: "https://boundary.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 1_024,
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function successStream(text: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const partial = assistantMessage([]);
  const done = assistantMessage([{ type: "text", text }]);
  queueMicrotask(() => {
    stream.push({ type: "start", partial });
    stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: done });
    stream.push({ type: "done", reason: "stop", message: done });
    stream.end();
  });
  return stream;
}

function assistantMessage(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: MODEL.api,
    provider: MODEL.provider,
    model: MODEL.id,
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

async function createBoundarySession(factory: (pi: ExtensionAPI) => void) {
  const cwd = mkdtempSync(path.join(tmpdir(), "sf-pi-actionable-boundary-"));
  tempDirs.push(cwd);
  const streams = [successStream("first response"), successStream("repair response")];
  let calls = 0;
  const nextStream = () => {
    const stream = streams[calls++];
    if (!stream) throw new Error(`Unexpected provider request ${calls}.`);
    return stream;
  };
  const provider = createProvider({
    id: PROVIDER_ID,
    name: "SF Pi actionable boundary test",
    auth: {
      apiKey: {
        name: "Test key",
        async resolve() {
          return { auth: { apiKey: "test-key" }, source: "test" };
        },
      },
    },
    models: [MODEL],
    api: {
      "openai-completions": {
        stream: nextStream,
        streamSimple: nextStream,
      },
    },
  });
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(cwd, "auth.json"),
    modelsPath: null,
    allowModelNetwork: false,
  });
  modelRuntime.registerNativeProvider(provider);
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    extensionFactories: [factory],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    model: MODEL,
    noTools: "all",
    modelRuntime,
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
  });
  return { session, calls: () => calls };
}

describe("Pi 0.87 actionable settlement", () => {
  it("chains prior drafts, persists one repair entry, and continues exactly once", async () => {
    const order: string[] = [];
    let priorAdded = false;
    let repairAdded = false;
    const { session, calls } = await createBoundarySession((pi) => {
      pi.on("agent_before_settle", (event) => {
        order.push(`prior:${event.entries.length}`);
        if (priorAdded) return;
        priorAdded = true;
        return {
          entries: [
            ...event.entries,
            { type: "custom", customType: "prior-boundary", data: { ready: true } },
          ],
        };
      });
      pi.on("agent_before_settle", (event) => {
        order.push(`repair:${event.entries.length}`);
        if (repairAdded) return;
        repairAdded = true;
        return {
          entries: [
            ...event.entries,
            {
              type: "custom_message",
              customType: "quality-repair",
              content: "Apply the bounded repair.",
              display: false,
            },
          ],
          continue: true,
        };
      });
      pi.on("agent_settled", () => {
        order.push("settled");
      });
    });

    try {
      await session.prompt("begin");
      expect(calls()).toBe(2);
      expect(order).toEqual(["prior:0", "repair:1", "prior:0", "repair:0", "settled"]);
      expect(session.sessionManager.getEntries()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "custom", customType: "prior-boundary" }),
          expect.objectContaining({
            type: "custom_message",
            customType: "quality-repair",
            content: "Apply the bounded repair.",
          }),
        ]),
      );
    } finally {
      session.dispose();
    }
  });
});
