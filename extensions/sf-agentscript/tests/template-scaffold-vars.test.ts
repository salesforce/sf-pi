/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Item 2 hardening: when `agentscript_create` seeds variables from the
 * job_spec, the scaffold inserts a `# TODO(sf-pi scaffold): wire
 * @variables.<name> ...` comment immediately above each declaration so
 * the LLM (and human) sees the gap. Without that hint the next compile
 * surfaces `unused-variable` warnings with no context that they're
 * intentional scaffold state.
 */

import { describe, expect, test } from "vitest";
import { generateAgentforceDefault } from "../lib/templates/agentforce-default.ts";

describe("agentscript_create scaffolds wire-up TODO comments", () => {
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
    // location. `unused-variable` is expected (sev 2 = warning), but the
    // file must still be ok=true and emit no severity-1 errors.
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
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
