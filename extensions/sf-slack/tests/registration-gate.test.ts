/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Source-level tests for Option B — conditional Slack tool registration.
 *
 * We don't spin up a real pi runtime here; we verify the index.ts source
 * encodes the intended contract so nobody reintroduces the "register on
 * load" pattern during refactors. The runtime behavior is exercised by
 * end-to-end tests in the parent repo.
 *
 * Contract verified:
 *   1. There is no unconditional `register*Tool(pi)` at module scope.
 *   2. All nine Slack tools are registered behind the gate helper.
 *   3. The gate helper is invoked from session_start AND /sf-slack refresh.
 *   4. session_start awaits probeAndGateTools() (not fire-and-forget).
 *   5. The workspace context injection no longer includes cache-size or
 *      gated-tool lines (they drift turn-to-turn and break prompt cache).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const indexSource = readFileSync(
  path.resolve(fileURLToPath(import.meta.url), "../../index.ts"),
  "utf-8",
);

describe("sf-slack conditional tool registration (Option B)", () => {
  it("does not register Slack tools unconditionally at module scope", () => {
    // The bottom-of-file register*Tool(pi) block must be gone. Every call
    // must live inside a function body.
    const afterCommand = indexSource.split("pi.registerCommand(COMMAND_NAME")[1] ?? "";
    expect(afterCommand).not.toMatch(/^\s*registerSlackTool\(pi\);/m);
    expect(afterCommand).not.toMatch(/^\s*registerTimeRangeTool\(pi\);/m);
    expect(afterCommand).not.toMatch(/^\s*registerCanvasTool\(pi\);/m);
  });

  it("defines an ensureSlackToolsRegistered gate", () => {
    expect(indexSource).toContain("function ensureSlackToolsRegistered");
    expect(indexSource).toContain("if (slackToolsRegistered) return;");
  });

  it("gate registers all nine Slack tools", () => {
    const gate = indexSource.match(
      /function ensureSlackToolsRegistered\(\)[^{]*\{([\s\S]*?)\n\s{2}\}/,
    );
    expect(gate).not.toBeNull();
    const body = gate![1];
    const expected = [
      "registerSlackTool(pi)",
      "registerTimeRangeTool(pi)",
      "registerResolveTool(pi)",
      "registerResearchTool(pi)",
      "registerChannelTool(pi)",
      "registerUserTool(pi)",
      "registerFileTool(pi)",
      "registerCanvasTool(pi)",
      "registerSendTool(pi)",
    ];
    for (const call of expected) {
      expect(body).toContain(call);
    }
  });

  it("calls the gate from session_start AFTER token resolution", () => {
    const sessionStart = indexSource.match(
      /pi\.on\("session_start"[\s\S]*?(?=pi\.on\("session_shutdown")/,
    );
    expect(sessionStart).not.toBeNull();
    const body = sessionStart![0];
    // Gate is called, and only after the no-token early return.
    expect(body).toContain("ensureSlackToolsRegistered();");
    const gateIdx = body.indexOf("ensureSlackToolsRegistered();");
    const earlyReturnIdx = body.indexOf('updateStatus(ctx, "disconnected"');
    expect(gateIdx).toBeGreaterThan(earlyReturnIdx);
  });

  it("calls the gate from /sf-slack refresh after a successful token", () => {
    const refresh = indexSource.match(
      /if \(sub === "refresh"\)[\s\S]*?(?=if \(sub === "settings")/,
    );
    expect(refresh).not.toBeNull();
    expect(refresh![0]).toContain("ensureSlackToolsRegistered();");
  });

  it("awaits probeAndGateTools in session_start (not fire-and-forget)", () => {
    // The old code wrapped identity+probe in (async () => { ... })();
    // Option B must await directly so turn-1 ships the final tool set.
    expect(indexSource).not.toMatch(/\(async \(\) => \{[\s\S]*?probeAndGateTools/);
    expect(indexSource).toMatch(
      /session_start[\s\S]*?try \{[\s\S]*?await Promise\.all\(\[[\s\S]*?probeAndGateTools/,
    );
  });
});

describe("sf-slack workspace context injection (token-efficient shape)", () => {
  it("injects only identity anchors (User + Team), not cache metrics", () => {
    const inject = indexSource.match(/pi\.on\("before_agent_start"[\s\S]*?(?=pi\.registerCommand)/);
    expect(inject).not.toBeNull();
    const body = inject![0];
    expect(body).toContain("[Slack Workspace]");
    expect(body).toContain("User: @${identity.userName}");
    expect(body).toContain("Team: ${identity.teamId}");
    // Cache and gated-tool lines must NOT appear in the injected payload
    // because they drift turn-to-turn and invalidate prompt cache.
    expect(body).not.toContain("User cache:");
    expect(body).not.toContain("Channel cache:");
    expect(body).not.toMatch(/Note: .*gated/);
  });
});
