/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for sf-devbar systemPromptOptions adoption.
 *
 * Covers:
 * - before_agent_start handler reads event.systemPromptOptions
 * - Handler passes activeTools and activeSkills to formatAgentContext
 * - Source-level contract: no use of _event (unused event param)
 *
 * Runtime behavior is covered by the formatAgentContext unit tests in
 * lib/common/sf-environment/tests/. These tests verify the wiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const devbarSource = readFileSync(
  path.resolve(fileURLToPath(import.meta.url), "../../index.ts"),
  "utf-8",
);

describe("sf-devbar systemPromptOptions wiring", () => {
  it("reads systemPromptOptions from the event in before_agent_start", () => {
    expect(devbarSource).toContain("systemPromptOptions");
    // The handler destructures: const { systemPromptOptions } = event;
    expect(devbarSource).toContain("{ systemPromptOptions }");
  });

  it("passes activeTools from systemPromptOptions to formatAgentContext", () => {
    expect(devbarSource).toContain("systemPromptOptions.selectedTools");
    expect(devbarSource).toContain("activeTools:");
  });

  it("passes activeSkills from systemPromptOptions to formatAgentContext", () => {
    expect(devbarSource).toContain("systemPromptOptions.skills");
    expect(devbarSource).toContain("activeSkills:");
  });

  it("uses the event parameter (not _event) in before_agent_start", () => {
    // Verify the handler destructures event, not _event (which would mean unused)
    expect(devbarSource).toMatch(/pi\.on\("before_agent_start",\s*async\s*\(event,/);
  });
});
