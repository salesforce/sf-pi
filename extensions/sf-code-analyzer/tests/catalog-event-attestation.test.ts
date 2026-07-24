/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

function eventBus() {
  return {
    on: vi.fn(),
    emit: vi.fn(),
  };
}

describe("Code Analyzer catalog event attestation", () => {
  it("matches manifest events to the handlers registered by the real extension factory", async () => {
    const manifest = JSON.parse(
      readFileSync("extensions/sf-code-analyzer/manifest.json", "utf8"),
    ) as { events?: string[] };
    const registered = new Set<string>();
    const mod = await import("../index.ts");
    const pi = {
      events: eventBus(),
      on: vi.fn((event: string) => {
        registered.add(event);
      }),
      registerCommand: vi.fn(),
      registerEntryRenderer: vi.fn(),
    };

    mod.default(pi as never);

    const expectedEvents = [...(manifest.events ?? [])].sort();
    const catalog = JSON.parse(readFileSync("catalog/index.json", "utf8")) as Array<{
      id: string;
      events?: string[];
    }>;
    const orientationRow = readFileSync("docs/agent-orientation.md", "utf8")
      .split("\n")
      .find((line) => line.includes("[SF Code Analyzer]"));

    expect([...registered].sort()).toEqual(expectedEvents);
    expect(
      catalog.find((extension) => extension.id === "sf-code-analyzer")?.events?.sort(),
    ).toEqual(expectedEvents);
    expect(orientationRow).toContain("`tool_result`");
    expect(orientationRow).toContain("`agent_settled`");
  });

  it("keeps delegated-event authorization narrow and independent of manifest test paths", () => {
    const docsHealth = readFileSync("scripts/docs-health.mjs", "utf8");

    expect(docsHealth).toContain('events: new Set(["tool_result", "agent_settled"])');
    expect(docsHealth).not.toContain("manifest.eventAttestation");
  });
});
