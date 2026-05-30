/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for sf-slack scope probing (header-driven).
 *
 * The probe itself makes a live `auth.test` call, so we test the two pure
 * helpers (`computeGatedTools`, `computeMissingGrantedScopes`) here.
 * Integration with live Slack is covered by the smoke test.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  computeGatedTools,
  computeGrantedRequestedScopeCount,
  computeMissingGrantedScopes,
  deactivateSlackTools,
  gateToolsFromGrantedScopes,
  probeAndGateTools,
} from "../lib/scope-probe.ts";
import { _resetGrantedScopes, slackApi } from "../lib/api.ts";
// global fetch is stubbed via vi.stubGlobal.

class FakePi {
  private active: string[];
  constructor(
    private readonly all: string[],
    active = all,
  ) {
    this.active = [...active];
  }
  getAllTools() {
    return this.all.map((name) => ({ name }));
  }
  getActiveTools() {
    return [...this.active];
  }
  setActiveTools(next: string[]) {
    this.active = [...next];
  }
}

function mockAuthTestScopes(scopesHeader: string): void {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "x-oauth-scopes": scopesHeader },
      }),
  );
}

describe("scope-probe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetGrantedScopes();
  });
  it("module exports probeAndGateTools function", async () => {
    const mod = await import("../lib/scope-probe.ts");
    expect(typeof mod.probeAndGateTools).toBe("function");
  });

  describe("computeGatedTools", () => {
    const allTools = [
      "slack",
      "slack_channel",
      "slack_user",
      "slack_file",
      "slack_canvas",
      "slack_research",
      "slack_resolve",
      "slack_time_range",
      "slack_send",
    ];

    it("gates nothing when the granted-scope cache is empty (unknown)", () => {
      // Null = we have not yet captured X-OAuth-Scopes. Conservative: don't gate.
      expect(computeGatedTools(null, allTools)).toEqual([]);
    });

    it("matches the reported granular-scope token layout", () => {
      // Exact scope set reported by a user in a workspace that approves the
      // granular search:read.* family but not the coarse *:read scopes:
      //   identity, channels:history, groups:history, im:history, mpim:history,
      //   canvases:read, users:read, users:read.email, chat:write, canvases:write,
      //   search:read.public, search:read.private, search:read.mpim,
      //   search:read.im, search:read.files, search:read.users
      // Expected gates:
      //   - slack_channel — no channels:read / groups:read / im:read / mpim:read
      //   - slack_file   — no files:read (search:read.files does NOT satisfy it)
      // slack_canvas stays enabled because canvases:read is present.
      const granted = new Set([
        "identity",
        "channels:history",
        "groups:history",
        "im:history",
        "mpim:history",
        "canvases:read",
        "users:read",
        "users:read.email",
        "chat:write",
        "canvases:write",
        "search:read.public",
        "search:read.private",
        "search:read.mpim",
        "search:read.im",
        "search:read.files",
        "search:read.users",
      ]);
      const gated = computeGatedTools(granted, allTools);
      expect(gated.sort()).toEqual(["slack_channel", "slack_file"]);
    });

    it("accepts the coarse legacy search:read scope for slack and slack_research", () => {
      const granted = new Set([
        "search:read",
        "channels:read",
        "groups:read",
        "users:read",
        "files:read",
        "canvases:read",
      ]);
      expect(computeGatedTools(granted, allTools)).toEqual(["slack_send"]);
    });

    it("gates slack_file when files:read is missing", () => {
      const granted = new Set([
        "search:read.public",
        "channels:history",
        "channels:read",
        "users:read",
      ]);
      expect(computeGatedTools(granted, allTools)).toContain("slack_file");
    });

    it("gates slack_user when users:read is missing", () => {
      const granted = new Set(["search:read.public", "channels:read", "files:read"]);
      expect(computeGatedTools(granted, allTools)).toContain("slack_user");
    });

    it("does not gate slack_canvas when canvases:read alone is granted", () => {
      // files:read is the other satisfying scope, but canvases:read is enough
      // on its own for the sections-lookup read path.
      const granted = new Set([
        "search:read.public",
        "channels:read",
        "groups:read",
        "users:read",
        "canvases:read",
      ]);
      expect(computeGatedTools(granted, allTools)).not.toContain("slack_canvas");
    });

    it("keeps the core slack tool active with DM/MPIM history-only grants", () => {
      expect(computeGatedTools(new Set(["im:history"]), ["slack"])).toEqual([]);
      expect(computeGatedTools(new Set(["mpim:history"]), ["slack"])).toEqual([]);
    });

    it("does not gate a tool that is not registered in the first place", () => {
      const granted = new Set(["identity"]);
      // slack_file would be gated, but here it isn't even registered.
      expect(computeGatedTools(granted, ["slack", "slack_resolve"])).toEqual(["slack"]);
    });
  });

  describe("active tool application", () => {
    it("gates tools from scopes already captured by auth.test without a second probe", async () => {
      let calls = 0;
      vi.stubGlobal("fetch", async () => {
        calls += 1;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "x-oauth-scopes": "search:read.public" },
        });
      });
      const pi = new FakePi(["bash", "slack", "slack_file", "slack_send"]);

      await slackApi("auth.test", "xoxp-test", {});
      const result = gateToolsFromGrantedScopes(
        pi as never,
        ["search:read.public", "files:read", "chat:write"],
        "user",
      );

      expect(calls).toBe(1);
      expect(result.gatedTools.sort()).toEqual(["slack_file", "slack_send"]);
      expect(pi.getActiveTools()).toEqual(["bash", "slack"]);
    });

    it("hides and restores Slack-owned tools as scopes change", async () => {
      const pi = new FakePi(["bash", "slack", "slack_file", "slack_send"]);

      mockAuthTestScopes("search:read.public");
      let result = await probeAndGateTools(
        pi as never,
        "xoxp-test",
        undefined,
        ["search:read.public", "files:read", "chat:write"],
        "user",
      );
      expect(result.gatedTools.sort()).toEqual(["slack_file", "slack_send"]);
      expect(pi.getActiveTools()).toEqual(["bash", "slack"]);

      mockAuthTestScopes("search:read.public, files:read, chat:write");
      result = await probeAndGateTools(
        pi as never,
        "xoxp-test",
        undefined,
        ["search:read.public", "files:read", "chat:write"],
        "user",
      );
      expect(result.gatedTools).toEqual([]);
      expect(pi.getActiveTools()).toEqual(["bash", "slack", "slack_file", "slack_send"]);
    });

    it("does not restore Slack tools that Pi did not select", async () => {
      const pi = new FakePi(
        ["bash", "slack", "slack_file", "slack_send"],
        ["bash", "slack", "slack_file"],
      );

      mockAuthTestScopes("search:read.public");
      let result = await probeAndGateTools(
        pi as never,
        "xoxp-test",
        undefined,
        ["search:read.public", "files:read", "chat:write"],
        "user",
      );
      expect(result.gatedTools.sort()).toEqual(["slack_file", "slack_send"]);
      expect(pi.getActiveTools()).toEqual(["bash", "slack"]);

      mockAuthTestScopes("search:read.public, files:read, chat:write");
      result = await probeAndGateTools(
        pi as never,
        "xoxp-test",
        undefined,
        ["search:read.public", "files:read", "chat:write"],
        "user",
      );
      expect(result.gatedTools).toEqual([]);
      expect(pi.getActiveTools()).toEqual(["bash", "slack", "slack_file"]);
    });

    it("deactivates all Slack tools while preserving non-Slack tools", () => {
      const pi = new FakePi(["bash", "slack", "slack_file"], ["bash", "slack", "slack_file"]);
      deactivateSlackTools(pi as never);
      expect(pi.getActiveTools()).toEqual(["bash"]);
    });
  });

  describe("computeMissingGrantedScopes", () => {
    it("returns the scopes asked for that Slack didn't grant", () => {
      const granted = new Set(["search:read.public", "channels:history", "users:read"]);
      const requested = [
        "search:read.public",
        "channels:read", // missing
        "users:read",
        "files:read", // missing
      ];
      expect(computeMissingGrantedScopes(granted, requested)).toEqual([
        "channels:read",
        "files:read",
      ]);
    });

    it("returns an empty list when every requested scope was granted", () => {
      const granted = new Set(["a", "b", "c"]);
      expect(computeMissingGrantedScopes(granted, ["a", "b"])).toEqual([]);
    });

    it("returns an empty list when granted scopes are unknown", () => {
      // Don't hallucinate drift when we don't have the header yet.
      expect(computeMissingGrantedScopes(null, ["a", "b"])).toEqual([]);
    });

    it("tolerates empty requested list", () => {
      expect(computeMissingGrantedScopes(new Set(["a"]), [])).toEqual([]);
    });
  });

  describe("computeGrantedRequestedScopeCount", () => {
    it("counts only requested scopes, not implicit Slack-returned extras", () => {
      const granted = new Set(["search:read.public", "users:read", "identify"]);
      expect(
        computeGrantedRequestedScopeCount(granted, [
          "search:read.public",
          "users:read",
          "files:read",
        ]),
      ).toBe(2);
    });

    it("returns zero when granted scopes are unknown", () => {
      expect(computeGrantedRequestedScopeCount(null, ["users:read"])).toBe(0);
    });
  });
});
