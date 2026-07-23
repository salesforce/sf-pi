/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

function eventBus() {
  return { on: vi.fn(), emit: vi.fn() };
}

describe("SF Pi Manager catalog event attestation", () => {
  it("matches manifest events to handlers registered by the real extension factory", async () => {
    const manifest = JSON.parse(readFileSync("extensions/sf-pi-manager/manifest.json", "utf8")) as {
      events?: string[];
    };
    const registered = new Set<string>();
    const mod = await import("../index.ts");
    const pi = {
      events: eventBus(),
      on: vi.fn((event: string) => registered.add(event)),
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
      .find((line) => line.includes("[SF Pi Manager]"));

    expect([...registered].sort()).toEqual(expectedEvents);
    expect(catalog.find((extension) => extension.id === "sf-pi-manager")?.events?.sort()).toEqual(
      expectedEvents,
    );
    expect(registered).toContain("agent_start");
    expect(registered).toContain("agent_settled");
    expect(registered).not.toContain("agent_end");
    expect(orientationRow).toContain("`agent_start`");
    expect(orientationRow).toContain("`agent_settled`");
  });
});
