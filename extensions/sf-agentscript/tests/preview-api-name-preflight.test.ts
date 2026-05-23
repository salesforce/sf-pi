/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Preflight diagnostics for `startPreviewByApiName`. The preflight runs
 * one SOQL on BotDefinition + child BotVersions FILTERED to Status='Active'
 * (so a healthy agent with newer Inactive versions sitting on top of a
 * serving Active version still passes preflight). When no Active version
 * exists, a second SOQL fetches the latest of any status to produce a
 * useful "latest is v12 Inactive — activate it" error message.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { startPreviewByApiName } from "../lib/preview/client.ts";

/**
 * Mock for the post-2026-05 preflight which can run up to two SOQLs:
 *
 *   1. SELECT ... (SELECT ... FROM BotVersions WHERE Status='Active' ...)
 *      FROM BotDefinition WHERE DeveloperName='X'
 *   2. (only when #1 returns no Active version)
 *      SELECT VersionNumber, Status FROM BotVersion
 *      WHERE BotDefinitionId='...' ORDER BY VersionNumber DESC LIMIT 1
 *
 * Pass `firstRecords` (BotDefinition rows) and optionally `fallbackRecords`
 * (the latest-of-any rows for the second hop).
 */
function fakeConn(opts: {
  firstRecords: unknown[];
  fallbackRecords?: unknown[];
  onSessionStart?: () => unknown;
}) {
  let queryCalls = 0;
  return {
    instanceUrl: "https://example.my.salesforce.com",
    query: vi.fn(async (soql: string) => {
      queryCalls++;
      if (soql.includes("FROM BotDefinition")) {
        return { records: opts.firstRecords, totalSize: opts.firstRecords.length };
      }
      if (soql.includes("FROM BotVersion") && opts.fallbackRecords !== undefined) {
        return { records: opts.fallbackRecords, totalSize: opts.fallbackRecords.length };
      }
      throw new Error(`unexpected SOQL: ${soql}`);
    }),
    request: vi.fn(async () =>
      opts.onSessionStart
        ? opts.onSessionStart()
        : { sessionId: "should-not-be-called", messages: [] },
    ),
    queryCalls: () => queryCalls,
  };
}

describe("startPreviewByApiName preflight", () => {
  test("missing agent → not-found error, no second SOQL", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "preflight-"));
    try {
      const conn = fakeConn({ firstRecords: [] });
      await expect(
        startPreviewByApiName({
          conn: conn as never,
          cwd,
          agentApiName: "Nope",
        }),
      ).rejects.toThrow(/not found in the org/);
      expect(conn.request).not.toHaveBeenCalled();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("agent exists but no BotVersions at all → publish hint", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "preflight-"));
    try {
      const conn = fakeConn({
        firstRecords: [
          {
            Id: "0Xx000000000001",
            AgentType: "AgentforceEmployeeAgent",
            BotUserId: null,
            // First query (filtered to Status='Active') → empty.
            BotVersions: { records: [] },
          },
        ],
        // Fallback (any status) also empty → agent has zero versions.
        fallbackRecords: [],
      });
      await expect(
        startPreviewByApiName({
          conn: conn as never,
          cwd,
          agentApiName: "Empty",
        }),
      ).rejects.toThrow(/no BotVersions.*Publish first/i);
      expect(conn.request).not.toHaveBeenCalled();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("no Active version, latest is Inactive → activate hint with version + agent name", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "preflight-"));
    try {
      const conn = fakeConn({
        firstRecords: [
          {
            Id: "0Xx000000000002",
            AgentType: "AgentforceEmployeeAgent",
            BotUserId: null,
            BotVersions: { records: [] }, // no Active
          },
        ],
        fallbackRecords: [{ VersionNumber: 3, Status: "Inactive" }],
      });
      await expect(
        startPreviewByApiName({
          conn: conn as never,
          cwd,
          agentApiName: "Stale_Bot",
        }),
      ).rejects.toThrow(/no Active BotVersion.*v3.*Inactive.*activate.*Stale_Bot.*version=3/is);
      expect(conn.request).not.toHaveBeenCalled();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("Active version exists → preflight passes, /sessions is called", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "preflight-"));
    try {
      const conn = fakeConn({
        firstRecords: [
          {
            Id: "0Xx000000000003",
            AgentType: "AgentforceEmployeeAgent",
            BotUserId: null,
            BotVersions: {
              records: [
                {
                  Id: "0X9000000000002",
                  DeveloperName: "v1",
                  Status: "Active",
                  VersionNumber: 1,
                },
              ],
            },
          },
        ],
        onSessionStart: () => ({ sessionId: "sid-1", messages: [{ message: "hi" }] }),
      });
      const result = await startPreviewByApiName({
        conn: conn as never,
        cwd,
        agentApiName: "Active_Bot",
      });
      expect(result.sessionId).toBe("sid-1");
      // Only one SOQL needed on the success path (no fallback).
      expect(conn.queryCalls()).toBe(1);
      expect(conn.request).toHaveBeenCalledTimes(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("REGRESSION: Active version sitting BELOW newer Inactive versions → preflight passes", async () => {
    // Real-world scenario: org has v12 Inactive / v11 Inactive / v10 Active.
    // Production traffic correctly routes to v10. Our preflight used to
    // refuse this case because it ordered by VersionNumber DESC and
    // checked the very top row. The fix filters BotVersions on
    // Status='Active' inside the subquery, so v10 surfaces.
    const cwd = await mkdtemp(path.join(tmpdir(), "preflight-"));
    try {
      const conn = fakeConn({
        firstRecords: [
          {
            Id: "0Xxbb0000000yaTCAQ",
            AgentType: "EinsteinServiceAgent",
            BotUserId: "005bb00000XXXXXAAA",
            // The filtered subquery returns ONLY the Active version.
            BotVersions: {
              records: [
                {
                  Id: "0X9bb0000001P4PCAU",
                  DeveloperName: "v10",
                  Status: "Active",
                  VersionNumber: 10,
                },
              ],
            },
          },
        ],
        onSessionStart: () => ({ sessionId: "example-sid", messages: [{ message: "Hi!" }] }),
      });
      const result = await startPreviewByApiName({
        conn: conn as never,
        cwd,
        agentApiName: "Example_Service_Assistant",
      });
      expect(result.sessionId).toBe("example-sid");
      // Confirm we did NOT call the fallback "any status" SOQL on success.
      expect(conn.queryCalls()).toBe(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
