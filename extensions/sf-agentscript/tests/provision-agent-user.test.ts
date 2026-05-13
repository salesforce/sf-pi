/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for runProvision — the idempotent agent-user provisioner.
 *
 * Drives the function with a fake Connection that:
 *   - returns scripted SOQL responses (substring-keyed), and
 *   - records every sobject().create() call so we can assert mutations
 *     happened (or didn't) per dry_run mode.
 *
 * No live Salesforce. The fake Connection covers every documented
 * branch: license short-circuit, dry-run plan, idempotency (skip-if-
 * already-done), Service-vs-Employee, missing default_agent_user.
 */

import { describe, expect, test } from "vitest";
import { runProvision } from "../lib/agent-user/provision.ts";
import type { ComponentSummary } from "../lib/inspect.ts";

interface QueryFixture {
  match: string | RegExp;
  records: unknown[];
}

interface CreateCall {
  sobject: string;
  body: Record<string, unknown>;
}

function fakeConn(opts: {
  fixtures?: QueryFixture[];
  createResults?: Map<string, { success: boolean; id?: string; errors?: { message: string }[] }>;
  creates?: CreateCall[];
}) {
  return {
    query: async <T>(soql: string): Promise<{ records: T[] }> => {
      for (const f of opts.fixtures ?? []) {
        const m = typeof f.match === "string" ? soql.includes(f.match) : f.match.test(soql);
        if (m) return { records: f.records as T[] };
      }
      return { records: [] as T[] };
    },
    sobject: (name: string) => ({
      create: async (body: Record<string, unknown>) => {
        opts.creates?.push({ sobject: name, body });
        const r = opts.createResults?.get(name);
        return (
          r ?? {
            success: true,
            id: `${name.slice(0, 3).toUpperCase()}_FAKEID${(opts.creates?.length ?? 0).toString().padStart(3, "0")}`,
          }
        );
      },
    }),
  } as unknown as Parameters<typeof runProvision>[0];
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

function action(name: string, target: string): ComponentSummary {
  return { name, kind: "actions", target } as unknown as ComponentSummary;
}

describe("runProvision: dry-run is the default and never mutates", () => {
  test("Service Agent: dry-run with everything missing → would_execute steps; no creates", async () => {
    const creates: CreateCall[] = [];
    const conn = fakeConn({
      fixtures: [
        ACTIVE_AGENT_LICENSE,
        // user lookup misses
        { match: "FROM User WHERE Username", records: [] },
        // candidate users (empty)
        { match: "FROM User WHERE Profile.Name", records: [] },
        // Profile id for Einstein Agent User
        {
          match: "FROM Profile WHERE Name='Einstein Agent User'",
          records: [{ Id: "00e000000ABC" }],
        },
      ],
      creates,
    });
    const r = await runProvision(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [action("lookup", "apex://AccountLookup")],
      agent_file: "/tmp/Bot.agent",
      agent_api_name: "Bot",
      // dry_run defaults to true
    });
    expect(r.was_dry_run).toBe(true);
    expect(creates).toHaveLength(0); // no mutations
    const stepIds = r.steps.map((s) => `${s.id}:${s.action}`);
    expect(stepIds).toContain("create_user:would_execute");
    expect(stepIds).toContain("assign_system_ps:would_execute");
    expect(stepIds).toContain("deploy_custom_ps:would_execute");
    expect(stepIds).toContain("assign_custom_ps:would_execute");
  });

  test("explicit dry_run=true also produces no creates", async () => {
    const creates: CreateCall[] = [];
    const conn = fakeConn({
      fixtures: [ACTIVE_AGENT_LICENSE, { match: "FROM User WHERE Username", records: [] }],
      creates,
    });
    const r = await runProvision(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [],
      agent_file: "/tmp/X.agent",
      agent_api_name: "X",
      dry_run: true,
    });
    expect(r.was_dry_run).toBe(true);
    expect(creates).toHaveLength(0);
  });
});

describe("runProvision: short-circuits", () => {
  test("Employee Agent → no provisioning required", async () => {
    const creates: CreateCall[] = [];
    const conn = fakeConn({
      fixtures: [ACTIVE_AGENT_LICENSE],
      creates,
    });
    const r = await runProvision(conn, {
      agent_type: "AgentforceEmployeeAgent",
      actions: [],
      agent_file: "/tmp/Emp.agent",
      agent_api_name: "Emp",
      dry_run: false,
    });
    expect(r.steps[0]).toMatchObject({ id: "create_user", action: "skipped" });
    expect(r.steps[0].detail).toMatch(/Not a Service Agent/);
    expect(creates).toHaveLength(0);
  });

  test("license missing → aborts before any work", async () => {
    const creates: CreateCall[] = [];
    const conn = fakeConn({
      fixtures: [{ match: "FROM PermissionSetLicense", records: [] }],
      creates,
    });
    const r = await runProvision(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [],
      agent_file: "/tmp/Bot.agent",
      agent_api_name: "Bot",
      dry_run: false,
    });
    expect(r.ok).toBe(false);
    expect(r.steps[0].detail).toMatch(/Agentforce license/);
    expect(creates).toHaveLength(0);
  });

  test("no default_agent_user and no override → aborts cleanly", async () => {
    const creates: CreateCall[] = [];
    const conn = fakeConn({
      fixtures: [ACTIVE_AGENT_LICENSE, { match: "FROM User WHERE Profile.Name", records: [] }],
      creates,
    });
    const r = await runProvision(conn, {
      agent_type: "AgentforceServiceAgent",
      // no default_agent_user
      actions: [],
      agent_file: "/tmp/Bot.agent",
      agent_api_name: "Bot",
      dry_run: false,
    });
    expect(r.ok).toBe(false);
    expect(r.steps[0].detail).toMatch(/no default_agent_user/);
    expect(creates).toHaveLength(0);
  });
});

describe("runProvision: live execution (dry_run=false)", () => {
  test("user exists, system PS missing, no apex classes → assigns system PS, skips custom PS", async () => {
    const creates: CreateCall[] = [];
    const conn = fakeConn({
      fixtures: [
        ACTIVE_AGENT_LICENSE,
        { match: "FROM User WHERE Username", records: [ACTIVE_USER_RECORD] },
        // PS assignments — currently empty (no system PS)
        { match: "FROM PermissionSetAssignment WHERE AssigneeId", records: [] },
        // Idempotency check before insert: no existing assignment
        {
          match: /FROM PermissionSetAssignment.*AssigneeId.*PermissionSetId/i,
          records: [],
        },
        // Resolve PS DeveloperName → Id for AgentforceServiceAgentUser
        {
          match: "FROM PermissionSet WHERE Name='AgentforceServiceAgentUser'",
          records: [{ Id: "0PS_SYSTEM_PS_ID", Label: "Service" }],
        },
      ],
      creates,
    });
    const r = await runProvision(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [], // no apex
      agent_file: "/tmp/Bot.agent",
      agent_api_name: "Bot",
      dry_run: false,
    });
    expect(r.was_dry_run).toBe(false);
    expect(r.ok).toBe(true);
    const stepIds = r.steps.map((s) => `${s.id}:${s.action}`);
    expect(stepIds).toContain("create_user:skipped"); // user already exists
    expect(stepIds).toContain("assign_system_ps:executed");
    expect(stepIds).toContain("deploy_custom_ps:skipped");
    expect(stepIds).toContain("assign_custom_ps:skipped");
    // Exactly one PSA insert against PermissionSetAssignment.
    const psaCreates = creates.filter((c) => c.sobject === "PermissionSetAssignment");
    expect(psaCreates).toHaveLength(1);
    expect(psaCreates[0].body.AssigneeId).toBe(ACTIVE_USER_RECORD.Id);
  });

  test("idempotency: re-running when system PS already assigned → action='skipped'", async () => {
    const creates: CreateCall[] = [];
    const conn = fakeConn({
      fixtures: [
        ACTIVE_AGENT_LICENSE,
        { match: "FROM User WHERE Username", records: [ACTIVE_USER_RECORD] },
        // System PS already assigned in diagnose snapshot
        {
          match: "FROM PermissionSetAssignment WHERE AssigneeId",
          records: [
            {
              Id: "0Pa_existing",
              PermissionSetId: "0PS_SYSTEM",
              PermissionSet: { Name: "AgentforceServiceAgentUser" },
            },
          ],
        },
      ],
      creates,
    });
    const r = await runProvision(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [], // no apex
      agent_file: "/tmp/Bot.agent",
      agent_api_name: "Bot",
      dry_run: false,
    });
    expect(r.ok).toBe(true);
    const sysStep = r.steps.find((s) => s.id === "assign_system_ps");
    expect(sysStep?.action).toBe("skipped");
    expect(creates).toHaveLength(0);
  });

  test("custom PS XML preview is always populated when bundle has apex:// targets", async () => {
    const conn = fakeConn({
      fixtures: [
        ACTIVE_AGENT_LICENSE,
        { match: "FROM User WHERE Username", records: [ACTIVE_USER_RECORD] },
        { match: "FROM PermissionSetAssignment WHERE AssigneeId", records: [] },
      ],
    });
    const r = await runProvision(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [
        action("lookup", "apex://AccountLookup"),
        action("update", "apex://AccountUpdater"),
      ],
      agent_file: "/tmp/Bot.agent",
      agent_api_name: "Bot",
      dry_run: true, // dry-run so we never actually deploy in the fake conn
    });
    expect(r.preview_custom_ps_xml).toBeDefined();
    expect(r.preview_custom_ps_xml).toContain("<apexClass>AccountLookup</apexClass>");
    expect(r.preview_custom_ps_xml).toContain("<apexClass>AccountUpdater</apexClass>");
    expect(r.preview_custom_ps_xml).toContain("<label>Bot Access</label>");
  });

  test("apex_targets_override replaces what we extract from .actions", async () => {
    const conn = fakeConn({
      fixtures: [
        ACTIVE_AGENT_LICENSE,
        { match: "FROM User WHERE Username", records: [ACTIVE_USER_RECORD] },
        { match: "FROM PermissionSetAssignment WHERE AssigneeId", records: [] },
      ],
    });
    const r = await runProvision(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [action("a", "apex://One")],
      apex_targets_override: ["Override1", "Override2"],
      agent_file: "/tmp/Bot.agent",
      agent_api_name: "Bot",
      dry_run: true,
    });
    expect(r.preview_custom_ps_xml).toContain("<apexClass>Override1</apexClass>");
    expect(r.preview_custom_ps_xml).toContain("<apexClass>Override2</apexClass>");
    expect(r.preview_custom_ps_xml).not.toContain("<apexClass>One</apexClass>");
  });

  test("user_inactive → fails fast before any other step runs", async () => {
    const creates: CreateCall[] = [];
    const conn = fakeConn({
      fixtures: [
        ACTIVE_AGENT_LICENSE,
        {
          match: "FROM User WHERE Username",
          records: [{ ...ACTIVE_USER_RECORD, IsActive: false }],
        },
      ],
      creates,
    });
    const r = await runProvision(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "agent@example.com",
      actions: [],
      agent_file: "/tmp/Bot.agent",
      agent_api_name: "Bot",
      dry_run: false,
    });
    expect(r.ok).toBe(false);
    const userStep = r.steps.find((s) => s.id === "create_user");
    expect(userStep?.action).toBe("failed");
    expect(userStep?.error).toBe("user_inactive");
    expect(creates).toHaveLength(0);
  });
});

describe("runProvision: username_override", () => {
  test("provisions an override user instead of the .agent's default_agent_user", async () => {
    const creates: CreateCall[] = [];
    const conn = fakeConn({
      fixtures: [
        ACTIVE_AGENT_LICENSE,
        // The override username resolves to an existing active user
        {
          match: "FROM User WHERE Username='override@example.com'",
          records: [
            {
              Id: "005_OVERRIDE",
              Username: "override@example.com",
              IsActive: true,
              Profile: { Name: "Einstein Agent User" },
            },
          ],
        },
        // .agent's default_agent_user resolves elsewhere — we shouldn't touch it
        { match: "FROM PermissionSetAssignment WHERE AssigneeId", records: [] },
      ],
      creates,
    });
    const r = await runProvision(conn, {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: "differentuser@example.com",
      username_override: "override@example.com",
      actions: [],
      agent_file: "/tmp/Bot.agent",
      agent_api_name: "Bot",
      dry_run: true,
    });
    const createUserStep = r.steps.find((s) => s.id === "create_user");
    expect(createUserStep?.detail).toMatch(/override@example\.com/);
  });
});
