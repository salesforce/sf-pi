/* SPDX-License-Identifier: Apache-2.0 */
/** Registration smoke test: factory registers its surfaces without network or credentials. */
import { describe, expect, it, vi } from "vitest";

function fakePi() {
  return {
    on: vi.fn(),
    registerProvider: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
  };
}

describe("sf-fin", () => {
  it("registers the auth-only provider, sf_fin tool, /sf-fin command, and lifecycle hooks", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const mod = await import("../index.ts");
    const pi = fakePi();

    mod.default(pi as never);

    expect(pi.registerProvider.mock.calls.map(([provider]) => provider.id)).toEqual(["sf-fin"]);
    expect(pi.registerTool.mock.calls.map(([tool]) => tool.name)).toEqual(["sf_fin"]);
    expect(pi.registerCommand.mock.calls.map(([name]) => name)).toEqual(["sf-fin"]);
    expect(pi.on.mock.calls.map(([event]) => event).sort()).toEqual([
      "session_shutdown",
      "session_start",
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("offers flat subcommand completions", async () => {
    const mod = await import("../index.ts");
    const pi = fakePi();
    mod.default(pi as never);
    const command = pi.registerCommand.mock.calls[0]?.[1];
    expect(
      command.getArgumentCompletions("doc").map((item: { value: string }) => item.value),
    ).toEqual(["doctor"]);
  });

  it("exposes only read-only tool actions in v1", async () => {
    const mod = await import("../index.ts");
    const pi = fakePi();
    mod.default(pi as never);
    const tool = pi.registerTool.mock.calls[0]?.[0];
    expect(tool.parameters.properties.action.enum).toEqual(["status", "doctor"]);
  });
});
