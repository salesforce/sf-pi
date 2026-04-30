/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for sf-slack systemPromptOptions adoption.
 *
 * Covers:
 * - before_agent_start checks for active Slack tools before injecting context
 * - Source-level contract: reads systemPromptOptions.selectedTools
 * - Behavior: skips injection when no Slack tools are active
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const slackSource = readFileSync(
  path.resolve(fileURLToPath(import.meta.url), "../../index.ts"),
  "utf-8",
);

describe("sf-slack systemPromptOptions wiring", () => {
  it("reads systemPromptOptions from the event in before_agent_start", () => {
    // The handler destructures: const { systemPromptOptions } = event;
    expect(slackSource).toContain("{ systemPromptOptions }");
    expect(slackSource).toContain("systemPromptOptions.selectedTools");
  });

  it("uses the event parameter (not _event) in before_agent_start", () => {
    expect(slackSource).toMatch(/pi\.on\("before_agent_start",\s*async\s*\(event,/);
  });

  it("checks for slack tools before injecting context", () => {
    expect(slackSource).toContain("hasSlackTool");
    expect(slackSource).toContain('t.startsWith("slack")');
  });

  it("returns early when no Slack tools are active", () => {
    // Verify the guard clause: if (!hasSlackTool) return;
    expect(slackSource).toContain("if (!hasSlackTool) return;");
  });

  it("still injects context when Slack tools are active", () => {
    // The injection path should still exist after the guard
    expect(slackSource).toContain("sf-slack-context");
    expect(slackSource).toContain("[Slack Workspace]");
  });
});
