/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for sf-devbar systemPromptOptions adoption.
 *
 * Covers:
 * - before_agent_start handler reads event.systemPromptOptions
 * - Handler passes activeSkills to formatAgentContext
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

  it("does not pass tool-routing facts into formatAgentContext", () => {
    expect(devbarSource).not.toContain("systemPromptOptions.selectedTools");
    expect(devbarSource).not.toContain("activeTools:");
  });

  it("passes activeSkills from systemPromptOptions to formatAgentContext", () => {
    expect(devbarSource).toContain("systemPromptOptions.skills");
    expect(devbarSource).toContain("activeSkills:");
  });

  it("uses the event parameter (not _event) in before_agent_start", () => {
    // Verify the handler destructures event, not _event (which would mean unused)
    expect(devbarSource).toMatch(/pi\.on\("before_agent_start",\s*async\s*\(event,/);
  });

  it("dedupes the env injection so context is written once + on real change", () => {
    // Without shouldInjectOnce dedup, sf-devbar persisted a fresh
    // custom_message entry on every before_agent_start. Env content is
    // byte-stable across turns when nothing changes (formatAgentContext
    // does not include detectedAt), so a content-equality predicate is
    // a safe "is anything materially different?" signal.
    expect(devbarSource).toContain("shouldInjectOnce");
    expect(devbarSource).toContain("registerLatestContextProjection");
    expect(devbarSource).toContain("SF_ORG_CONTEXT_ENTRY_TYPE");
    expect(devbarSource).not.toContain("ctx.sessionManager.getEntries()");
    // Content-equality predicate — the seam that lets `/sf-org refresh`
    // re-inject when env actually changes.
    expect(devbarSource).toMatch(/entry\.content === context/);
  });
});
