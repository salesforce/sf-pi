/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for active-branch hidden-context projection. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  projectLatestCustomMessages,
  registerLatestContextProjection,
} from "../session/active-branch-context.ts";
import { shouldInjectOnce } from "../session/inject-once.ts";

const CUSTOM_TYPE = "test-active-context";

function userMessage(text: string) {
  return {
    role: "user" as const,
    content: [{ type: "text" as const, text }],
    timestamp: Date.now(),
  };
}

function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-completions" as const,
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

describe("latest custom-message projection", () => {
  it("removes tracked context while its owner is inactive and restores it when active", () => {
    const messages = [{ role: "custom", customType: CUSTOM_TYPE, content: "workspace" }];

    expect(projectLatestCustomMessages(messages, [CUSTOM_TYPE], () => false)).toEqual([]);
    expect(projectLatestCustomMessages(messages, [CUSTOM_TYPE], () => true)).toEqual(messages);
  });

  it("re-evaluates owner activity on every context event", async () => {
    let active = true;
    let handler: ((event: { messages: unknown[] }) => unknown) | undefined;
    const pi = {
      on(event: string, candidate: (event: { messages: unknown[] }) => unknown) {
        if (event === "context") handler = candidate;
      },
    };
    registerLatestContextProjection(pi as never, [CUSTOM_TYPE], () => active);
    const messages = [{ role: "custom", customType: CUSTOM_TYPE, content: "workspace" }];

    expect(await handler!({ messages })).toBeUndefined();
    active = false;
    expect(await handler!({ messages })).toEqual({ messages: [] });
    active = true;
    expect(await handler!({ messages })).toBeUndefined();
  });

  it("chains multiple registered projections without overwriting earlier results", async () => {
    const handlers: Array<(event: { messages: unknown[] }) => unknown> = [];
    const pi = {
      on(event: string, handler: (event: { messages: unknown[] }) => unknown) {
        if (event === "context") handlers.push(handler);
      },
    };
    registerLatestContextProjection(pi as never, ["first-context"]);
    registerLatestContextProjection(pi as never, ["second-context"]);

    let messages: unknown[] = [
      { role: "custom", customType: "first-context", content: "old-1" },
      { role: "custom", customType: "second-context", content: "old-2" },
      { role: "custom", customType: "first-context", content: "new-1" },
      { role: "custom", customType: "second-context", content: "new-2" },
    ];
    for (const handler of handlers) {
      const result = (await handler({ messages })) as { messages?: unknown[] } | undefined;
      if (result?.messages) messages = result.messages;
    }

    expect(messages).toEqual([
      { role: "custom", customType: "first-context", content: "new-1" },
      { role: "custom", customType: "second-context", content: "new-2" },
    ]);
  });

  it("registers a context hook that projects only when superseded values exist", async () => {
    let handler: ((event: { messages: unknown[] }) => unknown) | undefined;
    const pi = {
      on(event: string, candidate: (event: { messages: unknown[] }) => unknown) {
        if (event === "context") handler = candidate;
      },
    };
    registerLatestContextProjection(pi as never, [CUSTOM_TYPE]);
    expect(handler).toBeDefined();

    const current = [{ role: "custom", customType: CUSTOM_TYPE, content: "A" }];
    expect(await handler!({ messages: current })).toBeUndefined();

    const superseded = [
      { role: "custom", customType: CUSTOM_TYPE, content: "A" },
      { role: "custom", customType: CUSTOM_TYPE, content: "B" },
    ];
    expect(await handler!({ messages: superseded })).toEqual({ messages: [superseded[1]] });
  });

  it("projects real Pi session-context messages", () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage("root"));
    session.appendCustomMessageEntry(CUSTOM_TYPE, "A", false);
    session.appendCustomMessageEntry(CUSTOM_TYPE, "B", false);

    const projected = projectLatestCustomMessages(session.buildSessionContext().messages, [
      CUSTOM_TYPE,
    ]);
    const tracked = projected.filter(
      (message) => message.role === "custom" && message.customType === CUSTOM_TYPE,
    );

    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.content).toBe("B");
    expect(projected.some((message) => message.role === "user")).toBe(true);
  });

  it("keeps only the latest tracked value and preserves unrelated messages", () => {
    const messages = [
      { role: "custom", customType: CUSTOM_TYPE, content: "A" },
      { type: "custom", customType: CUSTOM_TYPE, data: { approved: true } },
      { role: "custom", customType: "approval-audit", content: "allow" },
      { role: "user", content: "continue" },
      { role: "custom", customType: CUSTOM_TYPE, content: "B" },
      { role: "custom", customType: CUSTOM_TYPE, content: "A" },
    ];

    expect(projectLatestCustomMessages(messages, [CUSTOM_TYPE])).toEqual([
      messages[1],
      messages[2],
      messages[3],
      messages[5],
    ]);
  });
});

describe("active-branch injection", () => {
  it("recognizes a matching injection on the active branch", () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage("root"));
    session.appendCustomMessageEntry(CUSTOM_TYPE, "active", false);

    expect(shouldInjectOnce(session, CUSTOM_TYPE)).toBe(false);
  });

  it("reinjects A after A→B and then treats the new A as current", () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage("root"));
    session.appendCustomMessageEntry(CUSTOM_TYPE, "A", false);
    session.appendCustomMessageEntry(CUSTOM_TYPE, "B", false);
    const isA = (entry: { content: string | unknown[] }) => entry.content === "A";

    expect(shouldInjectOnce(session, CUSTOM_TYPE, isA)).toBe(true);

    session.appendCustomMessageEntry(CUSTOM_TYPE, "A", false);
    expect(shouldInjectOnce(session, CUSTOM_TYPE, isA)).toBe(false);
  });

  it("reinjects after compaction removes the prior message and recognizes a fresh one", () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage("root"));
    session.appendCustomMessageEntry(CUSTOM_TYPE, "before compaction", false);
    const keptId = session.appendMessage(userMessage("kept turn"));
    session.appendCompaction("summary", keptId, 50_000);

    expect(shouldInjectOnce(session, CUSTOM_TYPE)).toBe(true);

    session.appendCustomMessageEntry(CUSTOM_TYPE, "after compaction", false);
    expect(shouldInjectOnce(session, CUSTOM_TYPE)).toBe(false);
  });

  it("reconstructs the active branch across resume, fork, and tree navigation", () => {
    const sessionDir = mkdtempSync(path.join(tmpdir(), "sf-pi-active-context-"));
    try {
      const source = SessionManager.create("/tmp/source-project", sessionDir);
      source.appendMessage(userMessage("root"));
      const branchRootId = source.appendMessage(assistantMessage("root reply"));
      source.appendCustomMessageEntry(CUSTOM_TYPE, "abandoned", false);
      source.branch(branchRootId);
      source.appendMessage(userMessage("active sibling"));
      const sourceFile = source.getSessionFile();
      expect(sourceFile).toBeDefined();

      const resumed = SessionManager.open(sourceFile!, sessionDir);
      expect(shouldInjectOnce(resumed, CUSTOM_TYPE)).toBe(true);

      const forked = SessionManager.forkFrom(sourceFile!, "/tmp/target-project", sessionDir);
      expect(shouldInjectOnce(forked, CUSTOM_TYPE)).toBe(true);

      resumed.branch(branchRootId);
      resumed.appendCustomMessageEntry(CUSTOM_TYPE, "active after navigation", false);
      expect(shouldInjectOnce(resumed, CUSTOM_TYPE)).toBe(false);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("ignores a matching injection on an abandoned sibling branch", () => {
    const session = SessionManager.inMemory();
    const rootId = session.appendMessage(userMessage("root"));
    session.appendCustomMessageEntry(CUSTOM_TYPE, "abandoned", false);

    session.branch(rootId);
    session.appendMessage(userMessage("active sibling"));

    expect(shouldInjectOnce(session, CUSTOM_TYPE)).toBe(true);
  });
});
