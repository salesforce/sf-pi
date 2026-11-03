/* SPDX-License-Identifier: Apache-2.0 */
/** Registration smoke test: factory registers its surfaces without network, exec, or credentials. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRegisteredDoctors,
  resetExtensionDoctorRegistry,
} from "../../../lib/common/doctor/registry.ts";

function fakePi() {
  return {
    on: vi.fn(),
    exec: vi.fn(),
    registerProvider: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
  };
}

afterEach(() => {
  resetExtensionDoctorRegistry();
});

describe("sf-fin", () => {
  it("registers provider, tool, command, lifecycle hooks, and a /sf-pi doctor provider", async () => {
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
    expect(getRegisteredDoctors().map((entry) => entry.extensionId)).toContain("sf-fin");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(pi.exec).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("offers flat subcommand completions including install and debug", async () => {
    const mod = await import("../index.ts");
    const pi = fakePi();
    mod.default(pi as never);
    const command = pi.registerCommand.mock.calls[0]?.[1];
    const values = (prefix: string) =>
      command.getArgumentCompletions(prefix).map((item: { value: string }) => item.value);
    expect(values("ins")).toEqual(["install"]);
    expect(values("deb")).toEqual(["debug"]);
  });

  it("exposes status, doctor, install, and debug tool actions", async () => {
    const mod = await import("../index.ts");
    const pi = fakePi();
    mod.default(pi as never);
    const tool = pi.registerTool.mock.calls[0]?.[0];
    expect(tool.parameters.properties.action.enum).toEqual([
      "status",
      "doctor",
      "install",
      "debug",
    ]);
  });

  it("aggregate doctor makes no exec or network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const mod = await import("../index.ts");
    const pi = fakePi();
    mod.default(pi as never);
    const provider = getRegisteredDoctors().find(
      (entry) => entry.extensionId === "sf-fin",
    )?.provider;
    const report = await provider?.("/tmp");
    expect(report?.checks.map((check) => check.id)).toContain("fin.cli");
    expect(pi.exec).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
