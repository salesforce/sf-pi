/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for sf-slack scope probing (header-driven).
 *
 * The probe itself makes a live `auth.test` call, so we test the two pure
 * helpers (`computeGatedTools`, `computeMissingGrantedScopes`) here.
 * Integration with live Slack is covered by the smoke test.
 */
import { describe, it, expect } from "vitest";
import { computeGatedTools, computeMissingGrantedScopes } from "../lib/scope-probe.ts";

describe("scope-probe", () => {
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
      expect(computeGatedTools(granted, allTools)).toEqual([]);
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

    it("does not gate a tool that is not registered in the first place", () => {
      const granted = new Set(["identity"]);
      // slack_file would be gated, but here it isn't even registered.
      expect(computeGatedTools(granted, ["slack", "slack_resolve"])).toEqual(["slack"]);
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
});
