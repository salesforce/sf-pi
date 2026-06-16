/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Item 2 hardening: when `agentscript_authoring create` seeds variables from the
 * job_spec, the scaffold inserts a `# TODO(sf-pi scaffold): wire
 * @variables.<name> ...` comment immediately above each declaration so
 * the LLM (and human) sees the gap. Without that hint the next compile
 * surfaces actionable `unused-variable` cleanup with no context that it's
 * intentional scaffold state.
 */

import { describe, expect, test } from "vitest";
import { generateAgentforceDefault } from "../lib/templates/agentforce-default.ts";
import { generateMinimal } from "../lib/templates/minimal.ts";

describe("agentscript_authoring create scaffolds emit explicit agent_type (Issue 1)", () => {
  // Issue 1: scaffolds that omit `agent_type` ship un-activatable bundles.
  // The server defaults the type to AgentforceServiceAgent (which then
  // requires `default_agent_user`); the local SDK lint that should catch
  // this is gated on `agent_type` being explicitly present, so the gap
  // is silent until the activation API rejects the publish. The scaffold
  // fix: always emit agent_type, pick Employee by default, switch to
  // Service when the caller supplies `agent_user`.
  // See docs/POSTMORTEM_E2E_DEMO.md.

  test("default scaffold (no job_spec) emits AgentforceEmployeeAgent and no default_agent_user", () => {
    const src = generateAgentforceDefault("Default_Bot");
    expect(src).toMatch(/agent_type:\s*"AgentforceEmployeeAgent"/);
    expect(src).not.toContain("default_agent_user");
  });

  test("job_spec.agent_user produces AgentforceServiceAgent + default_agent_user", () => {
    const src = generateAgentforceDefault("Service_Bot", {
      agent_user: "support@example.com",
    });
    expect(src).toMatch(/agent_type:\s*"AgentforceServiceAgent"/);
    expect(src).toMatch(/default_agent_user:\s*"support@example\.com"/);
  });

  test("minimal template applies the same agent_type rule", () => {
    const def = generateMinimal("Tiny_Bot");
    expect(def).toMatch(/agent_type:\s*"AgentforceEmployeeAgent"/);
    expect(def).not.toContain("default_agent_user");

    const svc = generateMinimal("Tiny_Bot", { agent_user: "svc@example.com" });
    expect(svc).toMatch(/agent_type:\s*"AgentforceServiceAgent"/);
    expect(svc).toMatch(/default_agent_user:\s*"svc@example\.com"/);
  });

  test("both forms compile clean and the Service form does not raise config-missing-default-agent-user", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { checkAgentScriptFile } = await import("../lib/diagnostics.ts");
    const dir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-issue1-"));
    try {
      // Default (Employee Agent) — no missing-user lint expected.
      const empPath = path.join(dir, "Emp.agent");
      await writeFile(empPath, generateAgentforceDefault("Emp"), "utf8");
      const emp = await checkAgentScriptFile(empPath);
      expect(emp.ok).toBe(true);
      expect(emp.diagnostics.filter((d) => d.severity === 1)).toEqual([]);
      expect(
        emp.diagnostics.find((d) => d.code === "config-missing-default-agent-user"),
      ).toBeUndefined();

      // Service Agent with a user — also clean.
      const svcPath = path.join(dir, "Svc.agent");
      await writeFile(
        svcPath,
        generateAgentforceDefault("Svc", { agent_user: "svc@example.com" }),
        "utf8",
      );
      const svc = await checkAgentScriptFile(svcPath);
      expect(svc.ok).toBe(true);
      expect(svc.diagnostics.filter((d) => d.severity === 1)).toEqual([]);
      expect(
        svc.diagnostics.find((d) => d.code === "config-missing-default-agent-user"),
      ).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("agentscript_authoring create scaffolds wire-up TODO comments", () => {
  test("each seeded variable has a scaffold TODO comment immediately above it", () => {
    const src = generateAgentforceDefault("Sample_Bot", {
      description: "Demo agent.",
      topics: [{ name: "main_topic" }],
      variables: [
        { name: "guest_id", type: "string", mutable: true, default: "" },
        { name: "is_checked_in", type: "boolean", mutable: true, default: false },
      ],
    });
    const lines = src.split("\n");
    const guestIdLine = lines.findIndex((l) => l.trim().startsWith("guest_id:"));
    const checkedInLine = lines.findIndex((l) => l.trim().startsWith("is_checked_in:"));
    expect(guestIdLine).toBeGreaterThan(0);
    expect(checkedInLine).toBeGreaterThan(0);
    expect(lines[guestIdLine - 1]).toContain("TODO(sf-pi scaffold)");
    expect(lines[guestIdLine - 1]).toContain("@variables.guest_id");
    expect(lines[checkedInLine - 1]).toContain("@variables.is_checked_in");
  });

  test("scaffold without seeded variables emits no TODO comments", () => {
    const src = generateAgentforceDefault("Sample_Bot", {
      description: "Demo.",
      topics: [{ name: "main_topic" }],
    });
    expect(src).not.toContain("TODO(sf-pi scaffold)");
    expect(src).not.toContain("variables:");
  });

  test("scaffolded TODO is a YAML comment and does not break parsing", async () => {
    // Smoke-check via the SDK so we know the comment is in a parser-friendly
    // location. `unused-variable` is expected (sev 3 = actionable info), but
    // the file must still be ok=true and emit no severity-1 errors.
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { checkAgentScriptFile } = await import("../lib/diagnostics.ts");
    const dir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-todo-"));
    try {
      const file = path.join(dir, "X.agent");
      const src = generateAgentforceDefault("Sample_Bot", {
        description: "Demo.",
        topics: [{ name: "main_topic" }],
        variables: [{ name: "guest_id", type: "string", mutable: true, default: "" }],
      });
      await writeFile(file, src, "utf8");
      const r = await checkAgentScriptFile(file);
      expect(r.ok).toBe(true);
      expect(r.diagnostics.filter((d) => d.severity === 1)).toEqual([]);
      const unused = r.diagnostics.find((d) => d.code === "unused-variable");
      expect(unused).toBeTruthy();
      expect(unused?.severity).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
