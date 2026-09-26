/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Source-level contract tests for the before_agent_start handler.
 *
 * We assert on the source text rather than executing the handler because
 * sharing the pi-coding-agent ExtensionAPI surface with real Pi internals
 * would require a far larger test scaffold. These checks keep the "inject
 * once per session" guarantee from silently regressing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const brainSource = readFileSync(
  path.resolve(fileURLToPath(import.meta.url), "../../index.ts"),
  "utf-8",
);

describe("sf-brain before_agent_start handler", () => {
  it("registers a before_agent_start handler", () => {
    expect(brainSource).toMatch(/pi\.on\("before_agent_start",\s*async\s*\(/);
  });

  it("delegates the inject/skip decision to the constitution predicate", () => {
    // The handler delegates Pi's read-only session manager so the shared helper
    // owns active-branch and compaction semantics.
    expect(brainSource).toContain("shouldInjectConstitution");
    expect(brainSource).toContain("ctx.sessionManager");
    expect(brainSource).not.toContain("ctx.sessionManager.getEntries()");
    expect(brainSource).toContain("registerLatestContextProjection");
    expect(brainSource).toMatch(/if \(!shouldInjectConstitution\([\s\S]*?\)\) return;/);
  });

  it("returns persistent hidden custom messages for kernel and extension context", () => {
    expect(brainSource).toContain("customType: CONSTITUTION_ENTRY_TYPE");
    expect(brainSource).toContain("customType: SF_PI_ROUTING_ENTRY_TYPE");
    expect(brainSource.match(/display: false/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("passes the session's display capabilities into the constitution", () => {
    expect(brainSource).toContain("resolveDisplayCapabilities(ctx.cwd)");
  });

  it("reuses the shared sf-environment cache before running detection", () => {
    expect(brainSource).toContain("getCachedSfEnvironment");
    expect(brainSource).toContain("getSharedSfEnvironment");
  });

  it("injects the compact SF Pi Routing Summary without tool or skill catalogs", () => {
    expect(brainSource).toContain("formatSfPiRoutingSummary");
    expect(brainSource).toContain("shouldInjectSfPiRoutingSummary");
    expect(brainSource).not.toContain("event.systemPromptOptions.selectedTools");
    expect(brainSource).not.toContain("event.systemPromptOptions.skills?.map");
    expect(brainSource).not.toContain("isHerdrWorkflowModeActive");
  });
});
