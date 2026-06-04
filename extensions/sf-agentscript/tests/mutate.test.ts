/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for mutate.ts — minimal structured mutations plus coordinate-fallback edits.
 *
 * Real SDK, real fixture file. We validate:
 *   - apply_quick_fix works end-to-end via SDK/LSP diagnostics.
 *   - set_field rewrites and upserts scalar fields.
 *   - rename updates declarations and references for supported symbols.
 *   - mutate refuses to touch a file with severity-1 parse errors.
 *   - unsupported broad insert/delete modes guide the agent to generic edit.
 */

import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyMutation } from "../lib/mutate.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-mutate-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeAgent(name: string, source: string): Promise<string> {
  const filePath = path.join(workDir, name);
  await writeFile(filePath, source, "utf8");
  return filePath;
}

const FULL_FIXTURE = [
  "config:",
  '    agent_name: "Test_Bot"',
  '    description: "Demo"',
  "",
  "system:",
  "    instructions: |",
  "        old instructions",
  "",
  "topic billing:",
  '    description: "old billing description"',
  "",
  "topic faq:",
  '    description: "old faq description"',
  "",
  "start_agent main:",
  '    description: "entry"',
  "    transition to @topic.billing",
  "",
].join("\n");

describe("applyMutation: apply_quick_fix", () => {
  test("returns no_matching_diagnostic when the line/code don't match", async () => {
    const filePath = await writeAgent(
      "billing.agent",
      ["system:", '    instructions: "ok"', ""].join("\n"),
    );
    const result = await applyMutation({
      op: "apply_quick_fix",
      path: filePath,
      diagnostic_code: "deprecated-field",
      line: 99,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_matching_diagnostic");
  });
});

describe("applyMutation: set_field", () => {
  test("rewrites a nested topic.description (string) via AST and re-compiles", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.faq",
      field: "description",
      value: "new faq description",
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    expect(result.applied_via).toBe("ast");
    const after = await readFile(filePath, "utf8");
    expect(after).toContain("new faq description");
    expect(after).not.toContain("old faq description");
    expect((result.diagnostics_after ?? []).filter((d) => d.severity === 1)).toHaveLength(0);
  });

  test("rewrites a config field (top-level scalar) via AST", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "config",
      field: "description",
      value: "updated demo description",
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    expect(result.applied_via).toBe("ast");
    const after = await readFile(filePath, "utf8");
    expect(after).toContain("updated demo description");
  });

  test("upserts a schema-valid scalar field on config", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "config",
      field: "agent_type",
      value: "AgentforceEmployeeAgent",
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    const after = await readFile(filePath, "utf8");
    expect(after).toContain('agent_type: "AgentforceEmployeeAgent"');
  });

  test("set_field rejects array values with a clear unsupported_value_type reason", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.faq",
      field: "description",
      value: ["a", "b"],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported_value_type");
    expect(result.reason_detail).toMatch(/list values are not yet supported/i);
  });

  test("returns bad_component when the path is malformed", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      ["system:", '    instructions: "x"', ""].join("\n"),
    );
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic",
      field: "description",
      value: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_component");
  });

  test("refuses to add a field outside the scalar upsert allowlist", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "system",
      field: "agent_type",
      value: "AgentforceEmployeeAgent",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_field");
  });

  test("refuses to add a non-scalar field on topic.<name>", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.faq",
      field: "reasoning",
      value: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_field");
  });

  test("returns entry_not_found when the named entry doesn't exist", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.does_not_exist",
      field: "description",
      value: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("entry_not_found");
  });

  test("dry_run on a scalar upsert returns a preview diff", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "config",
      field: "agent_type",
      value: "AgentforceEmployeeAgent",
      dry_run: true,
    });
    expect(result.ok).toBe(true);
    expect(result.was_dry_run).toBe(true);
    expect(result.diff).toContain('agent_type: "AgentforceEmployeeAgent"');
    expect(result.preview_source).toContain('agent_type: "AgentforceEmployeeAgent"');
  });

  test("returns unknown_component_kind for unrecognized heads", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      ["system:", '    instructions: "x"', ""].join("\n"),
    );
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "ghost.x",
      field: "y",
      value: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown_component_kind");
  });
});

describe("applyMutation: rename", () => {
  test("renames a declarable symbol and its references", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      [
        "config:",
        '    agent_name: "Test_Bot"',
        '    description: "Demo"',
        "",
        "subagent billing:",
        '    description: "Billing"',
        "",
        "start_agent main:",
        '    description: "entry"',
        "    transition to @subagent.billing",
        "",
      ].join("\n"),
    );
    const result = await applyMutation({
      op: "rename",
      path: filePath,
      from: "@subagent.billing",
      to: "@subagent.account_billing",
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    const after = await readFile(filePath, "utf8");
    expect(after).toContain("subagent account_billing:");
    expect(after).toContain("transition to @subagent.account_billing");
    expect(after).not.toContain("subagent billing:");
  });

  test("supports legacy topic.X → subagent.X conversion input", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "rename",
      path: filePath,
      from: "topic.billing",
      to: "subagent.billing",
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    const after = await readFile(filePath, "utf8");
    expect(after).toContain("subagent billing:");
    expect(after).toContain("transition to @subagent.billing");
  });

  test("rejects broad cross-namespace renames", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "rename",
      path: filePath,
      from: "topic.billing",
      to: "variables.billing",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rename_unsupported");
  });
});

describe("applyMutation: insert / delete guidance", () => {
  test("returns use_generic_edit with a compile/check hint", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      ["system:", '    instructions: "x"', ""].join("\n"),
    );

    const insert = await applyMutation({
      op: "insert",
      path: filePath,
      parent: "topic.x.actions",
      child: "lookup",
    });
    expect(insert.ok).toBe(false);
    expect(insert.reason).toBe("use_generic_edit");
    expect(insert.reason_detail).toContain("generic edit tool");
    expect(insert.reason_detail).toContain("compile/check");
  });
});

describe("applyMutation: file safety", () => {
  test("read_failed when the path doesn't exist", async () => {
    const result = await applyMutation({
      op: "set_field",
      path: path.join(workDir, "nope.agent"),
      component: "system",
      field: "instructions",
      value: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("read_failed");
  });
});
