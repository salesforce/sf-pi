/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for lib/preview/session-store.ts.
 *
 * In-process: no Connection, no SDK. Round-trips through tmpdir.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { registerPreviewTool } from "../lib/preview-tool.ts";
import {
  cleanupSessions,
  endSession,
  getSessionDir,
  initSession,
  listStoredSessions,
  loadSession,
  logTrace,
  logTurn,
  readTurnIndex,
  recordTurnPlan,
  type PreviewMetadata,
} from "../lib/preview/session-store.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-preview-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("session lifecycle", () => {
  test("initSession creates the standard layout under .sfdx/agents/...", async () => {
    const dir = await initSession(workDir, {
      sessionId: "S1",
      agentName: "Billing_Bot",
      startTime: "2026-05-10T00:00:00Z",
      mockMode: "Mock",
    });
    expect(dir).toBe(getSessionDir(workDir, "Billing_Bot", "S1"));
    const metaRaw = await readFile(path.join(dir, "metadata.json"), "utf8");
    const meta = JSON.parse(metaRaw) as PreviewMetadata;
    expect(meta).toMatchObject({
      sessionId: "S1",
      agentName: "Billing_Bot",
      startTime: "2026-05-10T00:00:00Z",
      mockMode: "Mock",
      planIds: [],
    });
  });

  test("logTurn appends to transcript.jsonl", async () => {
    const dir = await initSession(workDir, {
      sessionId: "S1",
      agentName: "B",
      startTime: "t0",
      mockMode: "Mock",
    });
    await logTurn(dir, {
      timestamp: "t1",
      agentName: "B",
      sessionId: "S1",
      role: "user",
      text: "hello",
    });
    await logTurn(dir, {
      timestamp: "t2",
      agentName: "B",
      sessionId: "S1",
      role: "agent",
      text: "hi",
      planId: "P1",
    });
    const { transcript } = await loadSession(workDir, "B", "S1");
    expect(transcript).toHaveLength(2);
    expect(transcript[0].role).toBe("user");
    expect(transcript[1].planId).toBe("P1");
  });

  test("logTrace writes the file and updates planIds", async () => {
    const dir = await initSession(workDir, {
      sessionId: "S1",
      agentName: "B",
      startTime: "t0",
      mockMode: "Mock",
    });
    await logTrace(dir, "P1", { steps: [{ type: "UpdateTopicStep", topic: "billing" }] });
    const { metadata } = await loadSession(workDir, "B", "S1");
    expect(metadata.planIds).toContain("P1");
    const traceRaw = await readFile(path.join(dir, "traces", "P1.json"), "utf8");
    expect(JSON.parse(traceRaw)).toMatchObject({ steps: [{ topic: "billing" }] });
  });

  test("recordTurnPlan creates and updates turn-index.json", async () => {
    const dir = await initSession(workDir, {
      sessionId: "S1",
      agentName: "B",
      startTime: "t0",
      mockMode: "Mock",
    });
    await recordTurnPlan(dir, {
      agentName: "B",
      sessionId: "S1",
      planId: "P1",
      userText: "hello",
      agentText: "hi",
      userTimestamp: "t1",
      agentTimestamp: "t2",
      traceFile: "traces/P1.json",
    });
    await recordTurnPlan(dir, {
      agentName: "B",
      sessionId: "S1",
      planId: "P2",
      userText: "next",
      agentText: "ok",
    });
    // Idempotent update by planId instead of duplicating the turn.
    await recordTurnPlan(dir, {
      agentName: "B",
      sessionId: "S1",
      planId: "P1",
      agentText: "hello again",
    });

    const index = await readTurnIndex(dir);
    expect(index?.turns).toHaveLength(2);
    expect(index?.turns[0]).toMatchObject({
      turn: 1,
      planId: "P1",
      userText: "hello",
      agentText: "hello again",
      traceFile: "traces/P1.json",
    });
    expect(index?.turns[1]).toMatchObject({ turn: 2, planId: "P2" });
  });

  test("recordTurnPlan handles missing planId without corrupting the index", async () => {
    const dir = await initSession(workDir, {
      sessionId: "S1",
      agentName: "B",
      startTime: "t0",
      mockMode: "Mock",
    });
    await recordTurnPlan(dir, {
      agentName: "B",
      sessionId: "S1",
      userText: "hello",
      agentText: "hi",
    });
    const index = await readTurnIndex(dir);
    expect(index?.turns).toEqual([{ turn: 1, userText: "hello", agentText: "hi" }]);
  });

  test("listStoredSessions discovers valid and malformed sessions", async () => {
    await initSession(workDir, {
      sessionId: "S1",
      agentName: "B",
      startTime: new Date().toISOString(),
      mockMode: "Mock",
      sessionKind: "api_name",
      targetOrg: "dev",
    });
    const malformed = getSessionDir(workDir, "B", "bad");
    await import("node:fs/promises").then(({ mkdir, writeFile }) =>
      mkdir(malformed, { recursive: true }).then(() =>
        writeFile(path.join(malformed, "metadata.json"), "{not-json", "utf8"),
      ),
    );

    const sessions = await listStoredSessions(workDir);
    expect(sessions.map((s) => s.session_id).sort()).toEqual(["S1", "bad"]);
    expect(sessions.find((s) => s.session_id === "S1")?.metadata).toMatchObject({
      sessionKind: "api_name",
      targetOrg: "dev",
    });
    expect(sessions.find((s) => s.session_id === "bad")?.metadata_error).toBeTruthy();
  });

  test("endSession writes endTime", async () => {
    const dir = await initSession(workDir, {
      sessionId: "S1",
      agentName: "B",
      startTime: "t0",
      mockMode: "Mock",
    });
    const meta = await endSession(dir, "tEnd");
    expect(meta.endTime).toBe("tEnd");
  });
});

describe("agentscript_preview end_all", () => {
  interface PreviewToolResult {
    details: Record<string, unknown> & {
      candidates?: Array<{ session_id: string }>;
      local_finalized?: Array<{ session_id: string }>;
    };
  }

  interface PreviewToolDefinition {
    execute: (
      id: string,
      params: Record<string, unknown>,
      signal: unknown,
      onUpdate: unknown,
      ctx: { cwd: string },
    ) => Promise<PreviewToolResult>;
  }

  async function runPreviewTool(params: Record<string, unknown>): Promise<PreviewToolResult> {
    let tool: PreviewToolDefinition | undefined;
    registerPreviewTool({
      registerTool: (definition: unknown) => (tool = definition as PreviewToolDefinition),
    } as never);
    if (!tool) throw new Error("tool not registered");
    return await tool.execute("call", params, undefined, undefined, { cwd: workDir });
  }

  test("dry_run is the default and reports matching sessions without ending them", async () => {
    await initSession(workDir, {
      sessionId: "S1",
      agentName: "B",
      startTime: new Date().toISOString(),
      mockMode: "Mock",
      sessionKind: "agent_file",
    });
    const result = await runPreviewTool({ action: "end_all", agent_name: "B" });
    expect(result.details).toMatchObject({ ok: true, dry_run: true, matched: 1 });
    expect(result.details.candidates[0]).toMatchObject({
      agent: "B",
      session_id: "S1",
      session_kind: "agent_file",
    });
    const { metadata } = await loadSession(workDir, "B", "S1");
    expect(metadata.endTime).toBeUndefined();
  });

  test("dry_run=false finalizes local authoring-bundle sessions and skips ended ones by default", async () => {
    await initSession(workDir, {
      sessionId: "S1",
      agentName: "B",
      startTime: new Date().toISOString(),
      mockMode: "Mock",
      sessionKind: "agent_file",
    });
    await initSession(workDir, {
      sessionId: "S2",
      agentName: "B",
      startTime: new Date().toISOString(),
      mockMode: "Mock",
      sessionKind: "agent_file",
    });
    await endSession(getSessionDir(workDir, "B", "S2"), new Date().toISOString());

    const result = await runPreviewTool({ action: "end_all", agent_name: "B", dry_run: false });
    expect(result.details).toMatchObject({ ok: true, dry_run: false, matched: 1 });
    expect(result.details.local_finalized).toHaveLength(1);
    expect(result.details.local_finalized[0]).toMatchObject({ session_id: "S1" });
    expect((await loadSession(workDir, "B", "S1")).metadata.endTime).toBeTruthy();
  });

  test("filters by session_kind, target_org, and age", async () => {
    const oldStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await initSession(workDir, {
      sessionId: "old-api",
      agentName: "B",
      startTime: oldStart,
      mockMode: "Live Test",
      sessionKind: "api_name",
      targetOrg: "dev",
    });
    await initSession(workDir, {
      sessionId: "fresh-api",
      agentName: "B",
      startTime: new Date().toISOString(),
      mockMode: "Live Test",
      sessionKind: "api_name",
      targetOrg: "dev",
    });
    await initSession(workDir, {
      sessionId: "old-local",
      agentName: "B",
      startTime: oldStart,
      mockMode: "Mock",
      sessionKind: "agent_file",
      targetOrg: "dev",
    });

    const result = await runPreviewTool({
      action: "end_all",
      agent_name: "B",
      session_kind: "api_name",
      target_org: "dev",
      older_than_days: 5,
    });
    expect(result.details.candidates.map((c: { session_id: string }) => c.session_id)).toEqual([
      "old-api",
    ]);
  });
});

describe("cleanupSessions", () => {
  test("removes sessions older than the cutoff and keeps recent ones", async () => {
    // Old session: startTime 100 days ago.
    const oldStart = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    await initSession(workDir, {
      sessionId: "old",
      agentName: "B",
      startTime: oldStart,
      mockMode: "Mock",
    });
    // Recent session: startTime now.
    await initSession(workDir, {
      sessionId: "fresh",
      agentName: "B",
      startTime: new Date().toISOString(),
      mockMode: "Mock",
    });

    const result = await cleanupSessions(workDir, 30);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].session_id).toBe("old");
    expect(result.kept_count).toBe(1);

    // The fresh one is still there, the old one is gone.
    const { metadata: keptMeta } = await loadSession(workDir, "B", "fresh");
    expect(keptMeta.sessionId).toBe("fresh");
    await expect(loadSession(workDir, "B", "old")).rejects.toThrow();
  });

  test("dry_run reports what would be removed without deleting", async () => {
    const oldStart = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    await initSession(workDir, {
      sessionId: "old",
      agentName: "B",
      startTime: oldStart,
      mockMode: "Mock",
    });
    const result = await cleanupSessions(workDir, 30, true);
    expect(result.removed).toHaveLength(1);
    // Still on disk.
    const { metadata } = await loadSession(workDir, "B", "old");
    expect(metadata.sessionId).toBe("old");
  });

  test("returns empty when no sessions exist", async () => {
    const result = await cleanupSessions(workDir, 30);
    expect(result.removed).toEqual([]);
    expect(result.kept_count).toBe(0);
  });
});
