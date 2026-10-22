/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type Api, type Model } from "@earendil-works/pi-ai";
import { handleGatewayCompaction } from "../lib/compaction.ts";
import { writeScopedCompactionModel } from "../lib/compaction-settings.ts";

const SONNET = {
  id: "claude-sonnet-5",
  name: "Claude Sonnet 5",
  provider: "sf-llm-gateway",
  api: "anthropic-messages",
  baseUrl: "https://gateway.invalid",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 128_000,
} as Model<"anthropic-messages">;

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const tempDirs: string[] = [];
let agentDir: string;

beforeEach(() => {
  agentDir = tempDir();
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-compaction-policy-"));
  tempDirs.push(dir);
  return dir;
}

function event(reason: SessionBeforeCompactEvent["reason"] = "manual") {
  return {
    type: "session_before_compact",
    reason,
    willRetry: reason === "overflow",
    customInstructions: undefined,
    signal: new AbortController().signal,
    branchEntries: [],
    preparation: {
      messagesToSummarize: [
        {
          role: "user",
          content: [{ type: "text", text: "old conversation" }],
          timestamp: Date.now(),
        },
      ],
      turnPrefixMessages: [],
      tokensBefore: 1_000,
      firstKeptEntryId: "kept-entry",
      previousSummary: undefined,
      fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
      isSplitTurn: false,
      settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    },
  } as unknown as SessionBeforeCompactEvent;
}

function context(cwd: string) {
  const getAvailable = vi.fn(() => [] as Model<Api>[]);
  const complete = vi.fn();
  const streamSimple = vi.fn((...args: unknown[]) => {
    const stream = createAssistantMessageEventStream();
    const response = complete(...args);
    stream.result = () => response;
    return stream;
  });
  const notify = vi.fn();
  return {
    ctx: {
      cwd,
      hasUI: true,
      isProjectTrusted: () => true,
      modelRegistry: { getAvailable, complete, streamSimple },
      ui: { notify },
    } as unknown as ExtensionContext,
    getAvailable,
    complete,
    streamSimple,
    notify,
  };
}

function checkpoint(text = "checkpoint") {
  return {
    stopReason: "stop",
    content: [{ type: "text", text }],
    usage: {
      input: 100,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 120,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

describe("Gateway compaction policy", () => {
  it("ignores an untrusted project model preference", async () => {
    const cwd = tempDir();
    writeScopedCompactionModel(cwd, "project", "sf-llm-gateway/claude-sonnet-5");
    const { ctx, getAvailable, streamSimple } = context(cwd);
    ctx.isProjectTrusted = () => false;
    await expect(handleGatewayCompaction(event(), ctx)).resolves.toBeUndefined();
    expect(getAvailable).not.toHaveBeenCalled();
    expect(streamSimple).not.toHaveBeenCalled();
  });

  it("cancels before dispatch when the request signal is already aborted", async () => {
    const { ctx, getAvailable, streamSimple, notify } = context(tempDir());
    const input = event();
    input.signal = AbortSignal.abort();
    await expect(
      handleGatewayCompaction(input, ctx, {
        readSettings: () => ({ model: "sf-llm-gateway/claude-sonnet-5", source: "global" }),
      }),
    ).resolves.toEqual({ cancel: true });
    expect(getAvailable).not.toHaveBeenCalled();
    expect(streamSimple).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("checks the generated prompt before dispatching a large checkpoint", async () => {
    const { ctx, getAvailable, streamSimple, notify } = context(tempDir());
    getAvailable.mockReturnValue([{ ...SONNET, contextWindow: 200_000, maxTokens: 1_024 }]);
    const input = event();
    input.preparation.previousSummary = "previous context ".repeat(80_000);
    await expect(
      handleGatewayCompaction(input, ctx, {
        readSettings: () => ({ model: "sf-llm-gateway/claude-sonnet-5", source: "global" }),
      }),
    ).resolves.toBeUndefined();
    expect(streamSimple).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("cannot fit"), "warning");
  });

  it("rejects a summary that attempts to call a tool", async () => {
    const { ctx, getAvailable, complete } = context(tempDir());
    getAvailable.mockReturnValue([SONNET]);
    complete.mockResolvedValue({
      ...checkpoint(),
      content: [
        { type: "text", text: "checkpoint" },
        { type: "toolCall", id: "example-call", name: "example_tool", arguments: {} },
      ],
    });
    await expect(
      handleGatewayCompaction(event(), ctx, {
        readSettings: () => ({ model: "sf-llm-gateway/claude-sonnet-5", source: "global" }),
      }),
    ).resolves.toBeUndefined();
  });

  it("lets Pi merge split-turn summaries and aggregate their usage", async () => {
    const { ctx, getAvailable, complete } = context(tempDir());
    getAvailable.mockReturnValue([SONNET]);
    complete
      .mockResolvedValueOnce(checkpoint("history checkpoint"))
      .mockResolvedValueOnce(checkpoint("turn checkpoint"));
    const input = event();
    input.customInstructions = "Preserve deployment constraints";
    input.preparation.previousSummary = "previous checkpoint";
    input.preparation.isSplitTurn = true;
    input.preparation.turnPrefixMessages = [
      { role: "user", content: "unfinished turn", timestamp: 1 },
    ];
    const result = await handleGatewayCompaction(input, ctx, {
      readSettings: () => ({ model: "sf-llm-gateway/claude-sonnet-5", source: "global" }),
    });
    expect(complete).toHaveBeenCalledTimes(2);
    for (const call of complete.mock.calls) {
      expect(call[0]).toBe(SONNET);
      expect(JSON.stringify(call[1])).toContain("Preserve deployment constraints");
    }
    expect(JSON.stringify(complete.mock.calls[0]?.[1])).toContain("previous checkpoint");
    expect(JSON.stringify(complete.mock.calls[1]?.[1])).toContain("unfinished turn");
    expect(result).toMatchObject({
      compaction: {
        summary: expect.stringMatching(/history checkpoint[\s\S]*turn checkpoint/),
        usage: { totalTokens: 240 },
      },
    });
  });

  it("does not persist a split-turn checkpoint when its second summary is blank", async () => {
    const { ctx, getAvailable, complete, notify } = context(tempDir());
    getAvailable.mockReturnValue([SONNET]);
    complete.mockResolvedValueOnce(checkpoint()).mockResolvedValueOnce(checkpoint(" "));
    const input = event();
    input.preparation.isSplitTurn = true;
    input.preparation.turnPrefixMessages = [
      { role: "user", content: "unfinished turn", timestamp: 1 },
    ];
    await expect(
      handleGatewayCompaction(input, ctx, {
        readSettings: () => ({ model: "sf-llm-gateway/claude-sonnet-5", source: "global" }),
      }),
    ).resolves.toBeUndefined();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledOnce();
  });

  it.each(["length", "toolUse", "deferred", "error"] as const)(
    "does not persist a %s response",
    async (stopReason) => {
      const { ctx, getAvailable, complete, notify } = context(tempDir());
      getAvailable.mockReturnValue([SONNET]);
      complete.mockResolvedValue({
        stopReason,
        content: [{ type: "text", text: "partial summary" }],
      });
      await expect(
        handleGatewayCompaction(event(), ctx, {
          readSettings: () => ({ model: "sf-llm-gateway/claude-sonnet-5", source: "global" }),
        }),
      ).resolves.toBeUndefined();
      expect(notify).toHaveBeenCalledOnce();
    },
  );

  it("does not persist a blank summary even when file operations exist", async () => {
    const { ctx, getAvailable, complete } = context(tempDir());
    getAvailable.mockReturnValue([SONNET]);
    complete.mockResolvedValue({ stopReason: "stop", content: [{ type: "text", text: "  " }] });
    const input = event();
    input.preparation.fileOps.read.add("src/example.ts");
    await expect(
      handleGatewayCompaction(input, ctx, {
        readSettings: () => ({ model: "sf-llm-gateway/claude-sonnet-5", source: "global" }),
      }),
    ).resolves.toBeUndefined();
  });

  it("cancels rather than falling back when the provider aborts", async () => {
    const { ctx, getAvailable, complete, notify } = context(tempDir());
    getAvailable.mockReturnValue([SONNET]);
    complete.mockResolvedValue({ stopReason: "aborted", content: [] });
    await expect(
      handleGatewayCompaction(event(), ctx, {
        readSettings: () => ({ model: "sf-llm-gateway/claude-sonnet-5", source: "global" }),
      }),
    ).resolves.toEqual({ cancel: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it("preserves previous summaries and custom instructions", async () => {
    const { ctx, getAvailable, complete } = context(tempDir());
    getAvailable.mockReturnValue([SONNET]);
    complete.mockResolvedValue({
      stopReason: "stop",
      content: [{ type: "text", text: "checkpoint" }],
    });
    const input = event();
    input.preparation.previousSummary = "Previous checkpoint";
    input.customInstructions = "Preserve deployment constraints";
    await handleGatewayCompaction(input, ctx, {
      readSettings: () => ({ model: "sf-llm-gateway/claude-sonnet-5", source: "global" }),
    });
    const request = JSON.stringify(complete.mock.calls[0]?.[1]);
    expect(request).toContain("Previous checkpoint");
    expect(request).toContain("Preserve deployment constraints");
  });

  it("leaves compaction to Pi when the effective preference is active", async () => {
    const cwd = tempDir();
    const { ctx, getAvailable, complete } = context(cwd);

    await expect(
      handleGatewayCompaction(event(), ctx, {
        readSettings: () => ({ model: "active", source: "default" }),
      }),
    ).resolves.toBeUndefined();
    expect(getAvailable).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("falls back when the configured model is not currently available", async () => {
    const cwd = tempDir();
    const { ctx, complete, notify } = context(cwd);

    await expect(
      handleGatewayCompaction(event(), ctx, {
        readSettings: () => ({
          model: "sf-llm-gateway/claude-sonnet-5",
          source: "global",
        }),
      }),
    ).resolves.toBeUndefined();

    expect(complete).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Falling back to Pi's active-model compaction"),
      "warning",
    );
  });

  it("falls back before calling a configured model whose context is too small", async () => {
    const cwd = tempDir();
    const tiny = { ...SONNET, id: "tiny-summary-model", contextWindow: 128, maxTokens: 64 };
    const { ctx, getAvailable, complete, notify } = context(cwd);
    getAvailable.mockReturnValue([tiny]);

    await expect(
      handleGatewayCompaction(event(), ctx, {
        readSettings: () => ({
          model: "sf-llm-gateway/tiny-summary-model",
          source: "global",
        }),
      }),
    ).resolves.toBeUndefined();

    expect(complete).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("cannot fit"), "warning");
  });

  it("falls back with a public-safe warning when the configured model call fails", async () => {
    const cwd = tempDir();
    const { ctx, getAvailable, complete, notify } = context(cwd);
    getAvailable.mockReturnValue([SONNET]);
    complete.mockRejectedValue(new Error("private endpoint and credential detail"));

    await expect(
      handleGatewayCompaction(event(), ctx, {
        readSettings: () => ({
          model: "sf-llm-gateway/claude-sonnet-5",
          source: "global",
        }),
      }),
    ).resolves.toBeUndefined();

    const warning = String(notify.mock.calls[0]?.[0] ?? "");
    expect(warning).toContain("Falling back to Pi's active-model compaction");
    expect(warning).not.toContain("private endpoint");
  });

  it.each(["manual", "threshold", "overflow"] as const)(
    "creates a checkpoint with the configured Gateway model for %s compaction",
    async (reason) => {
      const cwd = tempDir();
      const { ctx, getAvailable, complete } = context(cwd);
      getAvailable.mockReturnValue([SONNET]);
      complete.mockResolvedValue({
        role: "assistant",
        content: [{ type: "text", text: "## Goal\nPreserve the active task." }],
        api: SONNET.api,
        provider: SONNET.provider,
        model: SONNET.id,
        usage: {
          input: 100,
          output: 20,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 120,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      });

      const compactionEvent = event(reason);
      compactionEvent.preparation.fileOps.read.add("src/read-only.ts");
      compactionEvent.preparation.fileOps.read.add("src/changed.ts");
      compactionEvent.preparation.fileOps.edited.add("src/changed.ts");
      const result = await handleGatewayCompaction(compactionEvent, ctx, {
        readSettings: () => ({
          model: "sf-llm-gateway/claude-sonnet-5",
          source: "global",
          globalModel: "sf-llm-gateway/claude-sonnet-5",
        }),
      });

      expect(getAvailable).toHaveBeenCalledOnce();
      expect(complete).toHaveBeenCalledWith(
        SONNET,
        expect.objectContaining({ messages: expect.any(Array) }),
        expect.objectContaining({
          cacheRetention: "none",
          sessionId: expect.any(String),
          signal: expect.any(AbortSignal),
        }),
      );
      expect(complete.mock.calls[0]?.[2]?.maxTokens).not.toBe(8_192);
      expect(result).toMatchObject({
        compaction: {
          summary: expect.stringMatching(
            /## Goal[\s\S]*<read-files>\nsrc\/read-only\.ts\n<\/read-files>[\s\S]*<modified-files>\nsrc\/changed\.ts\n<\/modified-files>/u,
          ),
          firstKeptEntryId: "kept-entry",
          tokensBefore: 1_000,
          usage: { totalTokens: 120 },
          details: {
            readFiles: ["src/read-only.ts"],
            modifiedFiles: ["src/changed.ts"],
          },
        },
      });
    },
  );
});
