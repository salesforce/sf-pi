/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the shared tool result/error contracts.
 *
 * The contract these tests pin:
 *   - toolOk produces { content:[{type:"text", text}], details } where details
 *     is the structured T.
 *   - toolError always sets ok:false + error; suggestion + recover_via are
 *     emitted only when supplied (no empty fields polluting the LLM payload).
 *   - The rendered text always carries an ❌ prefix on errors so the LLM can
 *     pattern-match the failure branch from prose alone.
 */

import { describe, expect, test } from "vitest";
import {
  isToolError,
  toolError,
  toolOk,
  type ToolError,
  type ToolEnvelope,
} from "../lib/tool-types.ts";

describe("toolOk", () => {
  test("emits content + details with default JSON rendering", () => {
    const env: ToolEnvelope<{ run_id: string; ok: true }> = toolOk({
      run_id: "abc",
      ok: true,
    });
    expect(env.details).toEqual({ run_id: "abc", ok: true });
    expect(env.content).toHaveLength(1);
    expect(env.content[0].type).toBe("text");
    expect(env.content[0].text).toContain('"run_id"');
  });

  test("uses custom summaryText when supplied", () => {
    const env = toolOk({ run_id: "x" }, "Run x complete");
    expect(env.content[0].text).toBe("Run x complete");
  });
});

describe("toolError", () => {
  test("minimal error: just the message and ❌ prefix", () => {
    const env = toolError("boom");
    const details = env.details as ToolError;
    expect(details.ok).toBe(false);
    expect(details.error).toBe("boom");
    expect(details.suggestion).toBeUndefined();
    expect(details.recover_via).toBeUndefined();
    expect(env.content[0].text).toBe("❌ boom");
  });

  test("with suggestion appends a Suggested-fix line", () => {
    const env = toolError("agent not found", "verify the DeveloperName");
    const details = env.details as ToolError;
    expect(details.suggestion).toBe("verify the DeveloperName");
    expect(env.content[0].text).toContain("Suggested fix: verify the DeveloperName");
  });

  test("with recover_via emits a programmatic next-tool hint", () => {
    const env = toolError("missing placeholder resolution", "pass agent_api_name", {
      tool: "agentscript_eval",
      params: { action: "resolve_active", agent_api_name: "Billing_Bot" },
    });
    const details = env.details as ToolError;
    expect(details.recover_via).toEqual({
      tool: "agentscript_eval",
      params: { action: "resolve_active", agent_api_name: "Billing_Bot" },
    });
    expect(env.content[0].text).toContain("Recover via: agentscript_eval");
  });

  test("does not include suggestion/recover_via fields when not provided", () => {
    const env = toolError("nope");
    const json = JSON.stringify(env.details);
    expect(json).not.toContain("suggestion");
    expect(json).not.toContain("recover_via");
  });
});

describe("isToolError", () => {
  test("recognizes the failure branch", () => {
    const err = toolError("x").details;
    expect(isToolError(err)).toBe(true);
  });

  test("rejects success details", () => {
    const ok = toolOk({ run_id: "a" }).details;
    expect(isToolError(ok)).toBe(false);
  });

  test("rejects unrelated objects", () => {
    expect(isToolError(null)).toBe(false);
    expect(isToolError({})).toBe(false);
    expect(isToolError({ ok: true, error: "x" })).toBe(false);
  });
});
