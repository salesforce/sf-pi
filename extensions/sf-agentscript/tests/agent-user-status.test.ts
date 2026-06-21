/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for checkAgentUserStatus — the cheap "is this Service Agent's
 * user wiring ready?" check used as a publish preflight and as the
 * `agent_user_status` verb on agentscript_lifecycle.
 *
 * Drives the function with a fake Connection that returns scripted SOQL
 * responses keyed by query substring. Each test exercises one branch of
 * the status FSM (n/a, no user in config, license missing, user missing,
 * user inactive, system PS missing, ready).
 */

import { describe, expect, test, vi } from "vitest";
import { checkAgentUserStatus } from "../lib/agent-user/status.ts";

interface QueryFixture {
  /** Substring that must appear in the SOQL for this fixture to match. */
  match: string | RegExp;
  /** Records returned. */
  records: unknown[];
}

/**
 * Minimal fake @salesforce/core Connection. Only `query()` is implemented;
 * the agent-user read primitives don't touch anything else.
 */
function fakeConn(fixtures: QueryFixture[]) {
  return {
    query: async <T>(soql: string): Promise<{ records: T[] }> => {
      for (const f of fixtures) {
        const m = typeof f.match === "string" ? soql.includes(f.match) : f.match.test(soql);
        if (m) return { records: f.records as T[] };
      }
      throw new Error(`No fixture matched SOQL: ${soql}`);
    },
  } as unknown as Parameters<typeof checkAgentUserStatus>[0];
}

describe("checkAgentUserStatus", () => {
  test("uses bounded SOQL transport for authenticated Service Agent user probes", async () => {
    const query = vi.fn(async () => {
      throw new Error("raw conn.query should not be used for authenticated agent-user probes");
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const soql = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
      const records = soql.includes("FROM PermissionSetLicense")
        ? [{ DeveloperName: "EinsteinGPTCopilotPsl", Status: "Active" }]
        : soql.includes("FROM User WHERE Username")
          ? [
              {
                Id: "005000000000ABC",
                Username: "agent@example.com",
                IsActive: true,
                Profile: { Name: "Einstein Agent User" },
              },
            ]
          : soql.includes("FROM PermissionSetAssignment WHERE AssigneeId")
            ? [
                {
                  Id: "0Pa000000000001",
                  PermissionSetId: "0PS000000000001",
                  PermissionSet: { Name: "AgentforceServiceAgentUser", Label: "Service" },
                },
              ]
            : [];
      return new Response(JSON.stringify({ records, totalSize: records.length }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const s = await checkAgentUserStatus(
        {
          accessToken: "JWT",
          instanceUrl: "https://example.my.salesforce.com",
          getApiVersion: () => "67.0",
          getConnectionOptions: () => ({
            accessToken: "JWT",
            instanceUrl: "https://example.my.salesforce.com",
          }),
          query,
        } as unknown as Parameters<typeof checkAgentUserStatus>[0],
        {
          agent_type: "AgentforceServiceAgent",
          default_agent_user: "agent@example.com",
        },
      );

      expect(s.ok).toBe(true);
      expect(query).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("Employee Agent → status='n/a', ok=true (short-circuits before any SOQL)", async () => {
    const conn = fakeConn([]); // no fixtures; any query would throw
    const s = await checkAgentUserStatus(conn, {
      agent_type: "AgentforceEmployeeAgent",
    });
    expect(s.ok).toBe(true);
    expect(s.status).toBe("n/a");
    expect(s.agent_type).toBe("Employee");
    expect(s.short_message).toMatch(/Employee Agent/);
  });

  test("Service Agent missing default_agent_user → not_ready, reason='no_default_agent_user'", async () => {
    const conn = fakeConn([]);
    const s = await checkAgentUserStatus(conn, {
      agent_type: "AgentforceServiceAgent",
    });
    expect(s.ok).toBe(false);
    expect(s.status).toBe("not_ready");
    expect(s.reason).toBe("no_default_agent_user");
  });

  test("Service Agent missing license → reason='license_missing'", async () => {
    const conn = fakeConn([
      // No active Agentforce-family PermissionSetLicense rows in the org.
      { match: "FROM PermissionSetLicense", records: [] },
    ]);
    const s = await checkAgentUserStatus(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
    });
    expect(s.ok).toBe(false);
    expect(s.reason).toBe("license_missing");
    expect(s.short_message).toMatch(/Agentforce license/);
  });

  test("Service Agent with license but missing user → reason='user_not_found'", async () => {
    const conn = fakeConn([
      {
        match: "FROM PermissionSetLicense",
        records: [{ DeveloperName: "EinsteinGPTCopilotPsl", Status: "Active" }],
      },
      { match: "FROM User WHERE Username", records: [] },
    ]);
    const s = await checkAgentUserStatus(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "ghost@example.com",
    });
    expect(s.reason).toBe("user_not_found");
    expect(s.short_message).toMatch(/ghost@example\.com/);
    expect(s.short_message).toMatch(/diagnose_agent_user/);
  });

  test("Service Agent with inactive user → reason='user_inactive'", async () => {
    const conn = fakeConn([
      {
        match: "FROM PermissionSetLicense",
        records: [{ DeveloperName: "EinsteinGPTCopilotPsl", Status: "Active" }],
      },
      {
        match: "FROM User WHERE Username",
        records: [
          {
            Id: "005000000000ABC",
            Username: "agent@example.com",
            IsActive: false,
            Profile: { Name: "Einstein Agent User" },
          },
        ],
      },
    ]);
    const s = await checkAgentUserStatus(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
    });
    expect(s.reason).toBe("user_inactive");
    expect(s.user?.IsActive).toBe(false);
  });

  test("Service Agent with active user but no system PS → reason='system_ps_unassigned'", async () => {
    const conn = fakeConn([
      {
        match: "FROM PermissionSetLicense",
        records: [{ DeveloperName: "EinsteinGPTCopilotPsl", Status: "Active" }],
      },
      {
        match: "FROM User WHERE Username",
        records: [
          {
            Id: "005000000000ABC",
            Username: "agent@example.com",
            IsActive: true,
            Profile: { Name: "Einstein Agent User" },
          },
        ],
      },
      {
        match: "FROM PermissionSetAssignment WHERE AssigneeId",
        records: [
          {
            Id: "0Pa000000000001",
            PermissionSetId: "0PS000000000001",
            PermissionSet: { Name: "SomeOtherPS", Label: "Some Other" },
          },
        ],
      },
    ]);
    const s = await checkAgentUserStatus(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
    });
    expect(s.reason).toBe("system_ps_unassigned");
    expect(s.assigned_permission_sets).toEqual(["SomeOtherPS"]);
    expect(s.short_message).toMatch(/AgentforceServiceAgentUser/);
  });

  test("Service Agent fully wired → status='ready', reason='ok'", async () => {
    const conn = fakeConn([
      {
        match: "FROM PermissionSetLicense",
        records: [{ DeveloperName: "EinsteinGPTCopilotPsl", Status: "Active" }],
      },
      {
        match: "FROM User WHERE Username",
        records: [
          {
            Id: "005000000000ABC",
            Username: "agent@example.com",
            IsActive: true,
            Profile: { Name: "Einstein Agent User" },
          },
        ],
      },
      {
        match: "FROM PermissionSetAssignment WHERE AssigneeId",
        records: [
          {
            Id: "0Pa000000000001",
            PermissionSetId: "0PS000000000001",
            PermissionSet: { Name: "AgentforceServiceAgentUser", Label: "Service" },
          },
          {
            Id: "0Pa000000000002",
            PermissionSetId: "0PS000000000002",
            PermissionSet: { Name: "MyAgent_Access", Label: "Custom" },
          },
        ],
      },
    ]);
    const s = await checkAgentUserStatus(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
    });
    expect(s.ok).toBe(true);
    expect(s.status).toBe("ready");
    expect(s.reason).toBe("ok");
    expect(s.assigned_permission_sets).toEqual(["AgentforceServiceAgentUser", "MyAgent_Access"]);
  });

  test("Unknown agent_type → status='n/a' with explanatory message", async () => {
    const conn = fakeConn([]);
    const s = await checkAgentUserStatus(conn, {
      agent_type: "SalesEinsteinCoach",
    });
    expect(s.status).toBe("n/a");
    expect(s.agent_type).toBe("unknown");
    expect(s.short_message).toMatch(/SalesEinsteinCoach/);
  });
});
