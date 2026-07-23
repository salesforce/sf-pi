/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import sfPiManagerExtension from "../index.ts";
import { writeAutoUpdateEnabled } from "../../../lib/common/auto-update/store.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
type Handler = (event: Record<string, unknown>, ctx: ExtensionContext) => Promise<void> | void;

let tmpDir: string;
let previousAgentDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-update-runtime-"));
  previousAgentDir = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
  writeAutoUpdateEnabled(true);
  const packageDir = path.join(tmpDir, "npm", "node_modules", "@ogulcancelik", "pi-herdr");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "@ogulcancelik/pi-herdr", version: "0.3.0" }),
  );
  const settings = JSON.parse(writeSettingsSource()) as Record<string, unknown>;
  writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify(settings));
});

afterEach(() => {
  if (previousAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = previousAgentDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeSettingsSource(): string {
  return JSON.stringify({
    sfPi: { autoUpdate: true },
    packages: ["npm:@ogulcancelik/pi-herdr"],
  });
}

function context(): ExtensionContext {
  return {
    cwd: tmpDir,
    hasUI: true,
    mode: "tui",
    isIdle: () => true,
    signal: new AbortController().signal,
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn(),
      setWorkingVisible: vi.fn(),
    },
  } as unknown as ExtensionContext;
}

describe("Auto Update through the real SF Pi Manager factory", () => {
  it("waits for agent_settled, emits the plan, and then runs compatible targets", async () => {
    const handlers = new Map<string, Handler>();
    const calls: string[] = [];
    const appendEntry = vi.fn();
    const exec = vi.fn(async (command: string, args: string[]) => {
      calls.push([command, ...args].join(" "));
      if (command === "npm") {
        return {
          stdout: JSON.stringify({
            version: "0.4.0",
            peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
          }),
          stderr: "",
          code: 0,
          killed: false,
        };
      }
      return { stdout: "ok", stderr: "", code: 0, killed: false };
    });
    const pi = {
      events: { on: vi.fn(), emit: vi.fn() },
      on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
      registerCommand: vi.fn(),
      registerEntryRenderer: vi.fn(),
      appendEntry,
      exec,
    };
    sfPiManagerExtension(pi as never);
    const ctx = context();

    await handlers.get("session_start")?.({ reason: "startup" }, ctx);
    expect(calls).toEqual([]);

    await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);

    expect(calls).toEqual([
      "npm view @ogulcancelik/pi-herdr@latest version peerDependencies engines --json",
      "pi update --extension npm:@ogulcancelik/pi-herdr --no-approve",
      "sf update stable",
    ]);
    const plannedCall = appendEntry.mock.calls.findIndex(
      ([type, data]) => type === "sf-pi-auto-update" && data.title === "Auto Update planned",
    );
    const completedCall = appendEntry.mock.calls.findIndex(
      ([type, data]) => type === "sf-pi-auto-update" && data.title === "Auto Update complete",
    );
    expect(plannedCall).toBeGreaterThanOrEqual(0);
    expect(completedCall).toBeGreaterThan(plannedCall);
    expect(appendEntry.mock.invocationCallOrder[plannedCall]).toBeLessThan(
      exec.mock.invocationCallOrder[1],
    );

    await handlers.get("session_shutdown")?.({ reason: "quit" }, ctx);
  });
});
