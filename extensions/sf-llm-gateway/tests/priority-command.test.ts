/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handlePriorityCommand } from "../lib/priority-command.ts";
import { readEffectivePrioritySettings } from "../lib/priority-settings.ts";

let cwd: string;
let agentDir: string;
const original = process.env.PI_CODING_AGENT_DIR;
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "sf-pi-priority-command-"));
  agentDir = mkdtempSync(path.join(tmpdir(), "sf-pi-priority-command-agent-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
});
afterEach(() => {
  if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = original;
  rmSync(cwd, { recursive: true, force: true });
  rmSync(agentDir, { recursive: true, force: true });
});
function context(trusted = true) {
  return {
    cwd,
    hasUI: false,
    mode: "json",
    isProjectTrusted: () => trusted,
  } as ExtensionCommandContext;
}
function api() {
  return { appendEntry: vi.fn() } as unknown as ExtensionAPI;
}

describe("priority command", () => {
  it("saves off, reports effective overrides, and resets without provider work", async () => {
    const pi = api();
    await handlePriorityCommand(pi, context(), ["off", "global"]);
    expect(readEffectivePrioritySettings(cwd)).toEqual({ enabled: false, source: "global" });
    await handlePriorityCommand(pi, context(), ["on", "project"]);
    await handlePriorityCommand(pi, context(), ["off", "global"]);
    expect(pi.appendEntry).toHaveBeenLastCalledWith(
      "sf-llm-gateway",
      expect.objectContaining({ body: expect.stringContaining("ON (project)") }),
    );
    await handlePriorityCommand(pi, context(), ["reset", "project"]);
    expect(readEffectivePrioritySettings(cwd, undefined, true)).toEqual({
      enabled: false,
      source: "global",
    });
    await handlePriorityCommand(pi, context(), ["status"]);
    expect(pi.appendEntry).toHaveBeenLastCalledWith(
      "sf-llm-gateway",
      expect.objectContaining({ body: expect.stringContaining("OFF (global)") }),
    );
  });
  it.each([["off", "invalid"], ["off", "global", "extra"], ["unknown"], ["status", "project"]])(
    "rejects invalid arguments %j",
    async (...args) => {
      const pi = api();
      await handlePriorityCommand(pi, context(), args);
      expect(readEffectivePrioritySettings(cwd)).toEqual({ enabled: true, source: "default" });
      expect(pi.appendEntry).toHaveBeenCalledWith(
        "sf-llm-gateway",
        expect.objectContaining({ severity: "warning" }),
      );
    },
  );
  it("refuses untrusted project writes", async () => {
    const pi = api();
    await handlePriorityCommand(pi, context(false), ["off", "project"]);
    expect(readEffectivePrioritySettings(cwd, undefined, true)).toEqual({
      enabled: true,
      source: "default",
    });
    expect(pi.appendEntry).toHaveBeenCalledWith(
      "sf-llm-gateway",
      expect.objectContaining({ body: expect.stringContaining("Trust this project") }),
    );
  });
});
