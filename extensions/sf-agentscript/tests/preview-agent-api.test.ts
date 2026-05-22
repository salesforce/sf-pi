/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for Agent API preview decisions that do not require live org access. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  computePublishedBypassUser,
  endPreview,
  startPreviewByApiName,
} from "../lib/preview/client.ts";
import { initSession } from "../lib/preview/session-store.ts";

describe("computePublishedBypassUser", () => {
  test("Employee Agents use the named user context, not bot-user bypass", () => {
    expect(
      computePublishedBypassUser({ AgentType: "AgentforceEmployeeAgent", BotUserId: null }),
    ).toBe(false);
    expect(
      computePublishedBypassUser({ AgentType: "AgentforceEmployeeAgent", BotUserId: "005xx" }),
    ).toBe(false);
  });

  test("Service-style agents bypass only when a bot user is present", () => {
    expect(
      computePublishedBypassUser({ AgentType: "AgentforceServiceAgent", BotUserId: "005xx" }),
    ).toBe(true);
    expect(
      computePublishedBypassUser({ AgentType: "AgentforceServiceAgent", BotUserId: null }),
    ).toBe(false);
  });

  test("unknown agent metadata is conservative", () => {
    expect(computePublishedBypassUser(undefined)).toBe(false);
    expect(computePublishedBypassUser({})).toBe(false);
  });
});

describe("endPreview", () => {
  test("remotely ends published-agent sessions and finalizes local metadata", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "sf-agentscript-preview-"));
    const requests: Array<{ method?: string; url?: string; headers?: Record<string, string> }> = [];
    const conn = {
      request: vi.fn(
        async (req: { method?: string; url?: string; headers?: Record<string, string> }) => {
          requests.push(req);
          return {};
        },
      ),
    };
    try {
      await initSession(cwd, {
        sessionId: "sid-1",
        agentName: "My_Agent",
        startTime: new Date().toISOString(),
        mockMode: "Live Test",
        sessionKind: "api_name",
        endpoint: "test.",
      });
      const result = await endPreview({
        conn: conn as never,
        cwd,
        agentName: "My_Agent",
        sessionId: "sid-1",
      });
      expect(result.remoteEnded).toBe(true);
      expect(result.metadata.endTime).toBeTruthy();
      expect(requests[0]).toMatchObject({
        method: "DELETE",
        url: "https://test.api.salesforce.com/einstein/ai-agent/v1/sessions/sid-1",
      });
      expect(requests[0].headers?.["x-session-end-reason"]).toBe("UserRequest");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("reports remote end failures without throwing", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "sf-agentscript-preview-"));
    const conn = {
      request: vi.fn(async () => {
        throw { statusCode: 500, message: "boom" };
      }),
    };
    try {
      await initSession(cwd, {
        sessionId: "sid-1",
        agentName: "My_Agent",
        startTime: new Date().toISOString(),
        mockMode: "Live Test",
        sessionKind: "api_name",
      });
      const result = await endPreview({
        conn: conn as never,
        cwd,
        agentName: "My_Agent",
        sessionId: "sid-1",
      });
      expect(result.remoteEnded).toBe(false);
      expect(result.remoteEndError).toMatch(/HTTP 500/);
      expect(result.metadata.endTime).toBeTruthy();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("startPreviewByApiName", () => {
  test("retries once with bypassUser=false when bypassUser=true fails with invalid user id", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "sf-agentscript-preview-"));
    const bodies: Array<{ bypassUser?: boolean }> = [];
    const conn = {
      instanceUrl: "https://example.my.salesforce.com",
      query: vi.fn(async () => ({
        records: [
          {
            Id: "0Xx000000000001",
            AgentType: "AgentforceServiceAgent",
            BotUserId: "005xx",
            BotVersions: {
              records: [
                {
                  Id: "0X9000000000001",
                  DeveloperName: "v1",
                  Status: "Active",
                  VersionNumber: 1,
                },
              ],
            },
          },
        ],
      })),
      request: vi.fn(async (req: { url: string; body?: string }) => {
        if (req.url.includes("/agents/0Xx000000000001/sessions")) {
          bodies.push(JSON.parse(req.body ?? "{}") as { bypassUser?: boolean });
          if (bodies.length === 1) {
            throw {
              statusCode: 400,
              message: "Bad Request: Invalid user ID provided on start session:",
              data: { message: "Bad Request: Invalid user ID provided on start session:" },
            };
          }
          return { sessionId: "sid-1", messages: [{ message: "hello" }] };
        }
        throw new Error(`unexpected request ${req.url}`);
      }),
    };

    try {
      const result = await startPreviewByApiName({
        conn: conn as never,
        cwd,
        agentApiName: "My_Agent",
      });
      expect(result.sessionId).toBe("sid-1");
      expect(bodies.map((b) => b.bypassUser)).toEqual([true, false]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
