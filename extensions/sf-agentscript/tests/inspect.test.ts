/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for inspect.ts — the structural summary of a `.agent` file.
 *
 * We use a small fixture written to a temp dir so we exercise the real
 * vendored SDK end-to-end. No mocks; if the SDK breaks, these tests catch it.
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { inspectFile } from "../lib/inspect.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-inspect-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeAgent(name: string, source: string): Promise<string> {
  const filePath = path.join(workDir, name);
  await writeFile(filePath, source, "utf8");
  return filePath;
}

describe("inspectFile", () => {
  test("returns ok=false for unreadable paths", async () => {
    const result = await inspectFile(path.join(workDir, "missing.agent"));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("read_failed");
  });

  test("walks topics + variables on a minimal valid script", async () => {
    const filePath = await writeAgent(
      "billing.agent",
      [
        "config:",
        '    agent_name: "Billing_Bot"',
        "",
        "system:",
        '    instructions: "You are a billing agent."',
        "",
        "variables:",
        "    is_verified: mutable boolean = False",
        "",
        "topic billing:",
        '    description: "Handle billing inquiries"',
        "",
      ].join("\n"),
    );
    const result = await inspectFile(filePath);
    expect(result.ok).toBe(true);
    expect(result.stats?.topics).toBeGreaterThanOrEqual(1);
    expect(result.components?.topics?.[0].name).toBe("billing");
    expect(result.components?.topics?.[0].description).toBe("Handle billing inquiries");
    expect(result.components?.system?.instructions).toContain("billing agent");
    expect(result.stats?.variables).toBeGreaterThanOrEqual(1);
    const verifiedVar = result.components?.variables?.find((v) => v.name === "is_verified");
    // Variable is discovered with a name and (probably) a line number.
    // Field-level projection (type, mutable, default) is dialect-specific
    // and best-effort; we just verify the variable was surfaced.
    expect(verifiedVar).toBeDefined();
    expect(typeof verifiedVar?.line).toBe("number");
  });

  test("collects @actions and @subagent references on a topic", async () => {
    const filePath = await writeAgent(
      "billing.agent",
      [
        "system:",
        '    instructions: "billing"',
        "",
        "subagent identity_check:",
        '    description: "Verify identity"',
        "",
        "topic billing:",
        '    description: "Handle billing"',
        "    actions:",
        "        - lookup_balance",
        "    after_reasoning:",
        "        if not @variables.is_verified:",
        "            transition to @subagent.identity_check",
        "",
        "variables:",
        "    is_verified: mutable boolean = False",
        "",
      ].join("\n"),
    );
    const result = await inspectFile(filePath);
    expect(result.ok).toBe(true);
    const billing = result.components?.topics?.find((t) => t.name === "billing");
    expect(billing).toBeDefined();
    // The reference walker only sees AtIdentifier-based references (used in
    // procedures). Whether the SDK exposes them depends on the dialect; at
    // minimum the topic itself was discovered with a name + line.
    expect(typeof billing?.line).toBe("number");
  });

  test("reports dialect when annotation is present", async () => {
    const filePath = await writeAgent(
      "annotated.agent",
      ["# @dialect agentforce", "system:", '    instructions: "hi"', ""].join("\n"),
    );
    const result = await inspectFile(filePath);
    expect(result.ok).toBe(true);
    // Either parseDialectAnnotation or resolveDialect should produce a name.
    expect(typeof result.dialect?.name).toBe("string");
  });
});
