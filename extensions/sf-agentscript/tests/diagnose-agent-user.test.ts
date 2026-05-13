/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for runDiagnose — the read-only checklist behind the
 * `diagnose_agent_user` verb. Drives the function with a fake Connection
 * keyed by SOQL substring; covers every documented branch (license, user,
 * system PS, per-Apex-class access) for both Service and Employee agent
 * types.
 */

import { describe, expect, test } from "vitest";
import { runDiagnose } from "../lib/agent-user/diagnose.ts";
import type { ComponentSummary } from "../lib/inspect.ts";

interface QueryFixture {
  match: string | RegExp;
  records: unknown[];
}

function fakeConn(fixtures: QueryFixture[]) {
  return {
    query: async <T>(soql: string): Promise<{ records: T[] }> => {
      for (const f of fixtures) {
        const m = typeof f.match === "string" ? soql.includes(f.match) : f.match.test(soql);
        if (m) return { records: f.records as T[] };
      }
      throw new Error(`No fixture matched SOQL: ${soql}`);
    },
  } as unknown as Parameters<typeof runDiagnose>[0];
}

const ACTIVE_AGENT_LICENSE: QueryFixture = {
  match: "FROM PermissionSetLicense",
  records: [{ DeveloperName: "EinsteinGPTCopilotPsl", Status: "Active" }],
};

const ACTIVE_USER_RECORD = {
  Id: "005000000000ABC",
  Username: "agent@example.com",
  IsActive: true,
  Profile: { Name: "Einstein Agent User" },
};

const SYSTEM_PS_ASSIGNMENT = {
  Id: "0Pa000000000001",
  PermissionSetId: "0PS000000000001",
  PermissionSet: { Name: "AgentforceServiceAgentUser", Label: "Service" },
};

function action(name: string, target: string): ComponentSummary {
  return { name, kind: "actions", target } as unknown as ComponentSummary;
}

describe("runDiagnose: Employee Agent", () => {
  test("Employee Agent → license-only check; everything else n/a", async () => {
    const conn = fakeConn([ACTIVE_AGENT_LICENSE]);
    const r = await runDiagnose(conn, {
      agent_type: "AgentforceEmployeeAgent",
      actions: [],
      agent_file: "/tmp/Emp.agent",
    });
    expect(r.ok).toBe(true);
    expect(r.agent_type).toBe("Employee");
    const byId = new Map(r.checks.map((c) => [c.id, c]));
    expect(byId.get("license")?.status).toBe("ok");
    expect(byId.get("agent_user_exists")?.status).toBe("n/a");
    expect(byId.get("agent_user_active")?.status).toBe("n/a");
    expect(byId.get("system_permset_assigned")?.status).toBe("n/a");
  });

  test("Employee Agent without license → not_ready, but downstream still n/a", async () => {
    const conn = fakeConn([{ match: "FROM PermissionSetLicense", records: [] }]);
    const r = await runDiagnose(conn, {
      agent_type: "AgentforceEmployeeAgent",
      actions: [],
      agent_file: "/tmp/Emp.agent",
    });
    expect(r.ok).toBe(false);
    expect(r.checks[0].id).toBe("license");
    expect(r.checks[0].status).toBe("missing");
  });
});

describe("runDiagnose: Service Agent — license short-circuit", () => {
  test("license missing → every downstream check is 'skipped' (no further SOQL)", async () => {
    const conn = fakeConn([{ match: "FROM PermissionSetLicense", records: [] }]);
    const r = await runDiagnose(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [action("lookup", "apex://AccountLookup")],
      agent_file: "/tmp/Svc.agent",
    });
    expect(r.ok).toBe(false);
    expect(r.checks[0].id).toBe("license");
    expect(r.checks[0].status).toBe("missing");
    for (const c of r.checks.slice(1)) {
      expect(c.status).toBe("skipped");
    }
  });
});

describe("runDiagnose: Service Agent — user resolution", () => {
  test("missing default_agent_user surfaces candidate users", async () => {
    const conn = fakeConn([
      ACTIVE_AGENT_LICENSE,
      {
        match: "FROM User WHERE Profile.Name='Einstein Agent User'",
        records: [
          {
            Id: "005000000000A1A",
            Username: "agent1@example.com",
            IsActive: true,
            Profile: { Name: "Einstein Agent User" },
          },
          {
            Id: "005000000000A1B",
            Username: "agent2@example.com",
            IsActive: true,
            Profile: { Name: "Einstein Agent User" },
          },
        ],
      },
    ]);
    const r = await runDiagnose(conn, {
      agent_type: "AgentforceServiceAgent",
      actions: [],
      agent_file: "/tmp/Svc.agent",
    });
    expect(r.ok).toBe(false);
    expect(r.candidate_einstein_agent_users?.length).toBe(2);
    const userCheck = r.checks.find((c) => c.id === "agent_user_exists");
    expect(userCheck?.status).toBe("missing");
    expect(userCheck?.detail).toMatch(/agent1@example\.com/);
  });

  test("named user not found → status missing + candidates surfaced", async () => {
    const conn = fakeConn([
      ACTIVE_AGENT_LICENSE,
      { match: "FROM User WHERE Username='ghost@example.com'", records: [] },
      {
        match: "FROM User WHERE Profile.Name='Einstein Agent User'",
        records: [
          {
            Id: "005000000000A1A",
            Username: "real@example.com",
            IsActive: true,
            Profile: { Name: "Einstein Agent User" },
          },
        ],
      },
    ]);
    const r = await runDiagnose(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "ghost@example.com",
      actions: [],
      agent_file: "/tmp/Svc.agent",
    });
    expect(r.ok).toBe(false);
    const userCheck = r.checks.find((c) => c.id === "agent_user_exists");
    expect(userCheck?.status).toBe("missing");
    expect(userCheck?.detail).toMatch(/ghost@example\.com/);
    expect(userCheck?.detail).toMatch(/real@example\.com/);
  });

  test("inactive user → agent_user_active=missing", async () => {
    const conn = fakeConn([
      ACTIVE_AGENT_LICENSE,
      {
        match: "FROM User WHERE Username",
        records: [{ ...ACTIVE_USER_RECORD, IsActive: false }],
      },
    ]);
    const r = await runDiagnose(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [],
      agent_file: "/tmp/Svc.agent",
    });
    const c = r.checks.find((x) => x.id === "agent_user_active");
    expect(c?.status).toBe("missing");
    // System PS check should be skipped when user inactive.
    expect(r.checks.find((x) => x.id === "system_permset_assigned")?.status).toBe("skipped");
  });
});

describe("runDiagnose: Service Agent — system PS", () => {
  test("user active but no AgentforceServiceAgentUser → system_permset_assigned missing", async () => {
    const conn = fakeConn([
      ACTIVE_AGENT_LICENSE,
      { match: "FROM User WHERE Username", records: [ACTIVE_USER_RECORD] },
      {
        match: "FROM PermissionSetAssignment WHERE AssigneeId",
        records: [
          {
            Id: "0Pa000000000XYZ",
            PermissionSetId: "0PS000000000XYZ",
            PermissionSet: { Name: "RandomOtherPS", Label: "Other" },
          },
        ],
      },
    ]);
    const r = await runDiagnose(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [],
      agent_file: "/tmp/Svc.agent",
    });
    const c = r.checks.find((x) => x.id === "system_permset_assigned");
    expect(c?.status).toBe("missing");
    expect(c?.detail).toMatch(/RandomOtherPS/);
  });
});

describe("runDiagnose: Service Agent — per-Apex-class access", () => {
  test("apex action targets without coverage → status='missing' + per-class breakdown", async () => {
    const conn = fakeConn([
      ACTIVE_AGENT_LICENSE,
      { match: "FROM User WHERE Username", records: [ACTIVE_USER_RECORD] },
      {
        match: "FROM PermissionSetAssignment WHERE AssigneeId",
        records: [SYSTEM_PS_ASSIGNMENT],
      },
      // SetupEntityAccess returns one row for AccountLookup; CaseCreator is NOT covered.
      {
        match: "FROM SetupEntityAccess",
        records: [{ ParentId: "0PS000000000001", SetupEntityId: "01p000000000A01" }],
      },
      {
        match: "FROM ApexClass",
        records: [{ Id: "01p000000000A01", Name: "AccountLookup" }],
      },
    ]);
    const r = await runDiagnose(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [action("lookup", "apex://AccountLookup"), action("create", "apex://CaseCreator")],
      agent_file: "/tmp/Svc.agent",
    });
    const c = r.checks.find((x) => x.id === "apex_class_access");
    expect(c?.status).toBe("missing");
    expect(c?.detail).toMatch(/CaseCreator/);
    expect(r.apex_actions).toEqual([
      {
        name: "lookup",
        apex_class: "AccountLookup",
        status: "ok",
        granted_via: "AgentforceServiceAgentUser",
      },
      { name: "create", apex_class: "CaseCreator", status: "missing" },
    ]);
  });

  test("no apex:// targets → check is 'n/a'", async () => {
    const conn = fakeConn([
      ACTIVE_AGENT_LICENSE,
      { match: "FROM User WHERE Username", records: [ACTIVE_USER_RECORD] },
      {
        match: "FROM PermissionSetAssignment WHERE AssigneeId",
        records: [SYSTEM_PS_ASSIGNMENT],
      },
    ]);
    const r = await runDiagnose(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [action("ext", "https://api.example.com")], // not apex://
      agent_file: "/tmp/Svc.agent",
    });
    const c = r.checks.find((x) => x.id === "apex_class_access");
    expect(c?.status).toBe("n/a");
  });
});

describe("runDiagnose: Service Agent — fully ready", () => {
  test("license + user + system PS + every apex class accessible → ok=true", async () => {
    const conn = fakeConn([
      ACTIVE_AGENT_LICENSE,
      { match: "FROM User WHERE Username", records: [ACTIVE_USER_RECORD] },
      {
        match: "FROM PermissionSetAssignment WHERE AssigneeId",
        records: [SYSTEM_PS_ASSIGNMENT],
      },
      {
        match: "FROM SetupEntityAccess",
        records: [{ ParentId: "0PS000000000001", SetupEntityId: "01p000000000A01" }],
      },
      {
        match: "FROM ApexClass",
        records: [{ Id: "01p000000000A01", Name: "AccountLookup" }],
      },
    ]);
    const r = await runDiagnose(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [action("lookup", "apex://AccountLookup")],
      agent_file: "/tmp/Svc.agent",
    });
    expect(r.ok).toBe(true);
    expect(r.recover_via).toBeUndefined();
    expect(r.checks.every((c) => c.status === "ok" || c.status === "n/a")).toBe(true);
  });
});

describe("runDiagnose: recover_via shape", () => {
  test("missing system PS → recover_via points at provision_agent_user dry_run=true", async () => {
    // Fixable by provision — a one-row PSA insert.
    const conn = fakeConn([
      ACTIVE_AGENT_LICENSE,
      { match: "FROM User WHERE Username", records: [ACTIVE_USER_RECORD] },
      {
        match: "FROM PermissionSetAssignment WHERE AssigneeId",
        records: [
          {
            Id: "0Pa000000000XYZ",
            PermissionSetId: "0PS000000000XYZ",
            PermissionSet: { Name: "RandomOtherPS", Label: "Other" },
          },
        ],
      },
    ]);
    const r = await runDiagnose(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [],
      agent_file: "/tmp/Demo.agent",
    });
    expect(r.recover_via).toEqual({
      tool: "agentscript_lifecycle",
      params: {
        action: "provision_agent_user",
        agent_file: "/tmp/Demo.agent",
        dry_run: true,
      },
    });
  });

  test("license missing → recover_via is undefined (admin-only fix; provision can't help)", async () => {
    const conn = fakeConn([{ match: "FROM PermissionSetLicense", records: [] }]);
    const r = await runDiagnose(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [],
      agent_file: "/tmp/Demo.agent",
    });
    expect(r.ok).toBe(false);
    expect(r.recover_via).toBeUndefined();
  });
});
