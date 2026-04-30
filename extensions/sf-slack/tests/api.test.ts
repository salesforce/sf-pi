/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for sf-slack api module.
 *
 * Tests pure helpers (clampLimit, tsToLabel, relativeTime, summarizeSlackError).
 * Network calls are not tested here — they require a live Slack token.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  clampLimit,
  tsToLabel,
  relativeTime,
  summarizeSlackError,
  getUserCache,
  getChannelCache,
  resolveUserMentionsInText,
  resolveUserNameFromCache,
  resolveChannelNameFromCache,
  warmUserCacheForIds,
  getTeamId,
  setDetectedTeamId,
  slackApi,
  detectTokenType,
  getGrantedScopes,
  hasScope,
  hasScopeKnown,
  hasAnyScope,
  _resetGrantedScopes,
  DEFAULT_ASSISTANT_CHANNEL_TYPES,
} from "../lib/api.ts";

describe("api", () => {
  describe("clampLimit", () => {
    it("returns fallback for undefined", () => {
      expect(clampLimit(undefined, 10, 200)).toBe(10);
    });

    it("returns fallback for NaN", () => {
      expect(clampLimit(NaN, 10, 200)).toBe(10);
    });

    it("clamps to max", () => {
      expect(clampLimit(500, 10, 200)).toBe(200);
    });

    it("clamps to 1 minimum", () => {
      expect(clampLimit(0, 10, 200)).toBe(10); // 0 is falsy → fallback
      expect(clampLimit(-5, 10, 200)).toBe(1); // Math.max(1, -5) = 1
    });

    it("passes through valid values", () => {
      expect(clampLimit(50, 10, 200)).toBe(50);
    });

    it("floors decimal values", () => {
      expect(clampLimit(7.9, 10, 200)).toBe(7);
    });
  });

  describe("tsToLabel", () => {
    it("returns unknown-time for undefined", () => {
      expect(tsToLabel(undefined)).toBe("unknown-time");
    });

    it("converts valid Slack timestamp to ISO string", () => {
      const result = tsToLabel("1700000000.000000");
      expect(result).toMatch(/2023-11-14/);
      expect(result).toMatch(/T.*Z/);
    });

    it("returns raw string for invalid timestamp", () => {
      expect(tsToLabel("not-a-number")).toBe("not-a-number");
    });
  });

  describe("relativeTime", () => {
    it("returns empty string for undefined", () => {
      expect(relativeTime(undefined)).toBe("");
    });

    it("returns just now for very recent timestamps", () => {
      const recent = String(Date.now() / 1000 - 5);
      expect(relativeTime(recent)).toBe("just now");
    });

    it("returns minutes for recent timestamps", () => {
      const fiveMinAgo = String(Date.now() / 1000 - 300);
      expect(relativeTime(fiveMinAgo)).toMatch(/5m ago/);
    });

    it("returns hours for older timestamps", () => {
      const twoHoursAgo = String(Date.now() / 1000 - 7200);
      expect(relativeTime(twoHoursAgo)).toMatch(/2h ago/);
    });

    it("returns days for even older timestamps", () => {
      const threeDaysAgo = String(Date.now() / 1000 - 259200);
      expect(relativeTime(threeDaysAgo)).toMatch(/3d ago/);
    });
  });

  describe("team ID resolution", () => {
    const originalTeamId = process.env.SLACK_TEAM_ID;

    afterEach(() => {
      if (originalTeamId === undefined) {
        delete process.env.SLACK_TEAM_ID;
      } else {
        process.env.SLACK_TEAM_ID = originalTeamId;
      }
      setDetectedTeamId("");
    });

    it("uses the detected auth.test team ID when env is not configured", () => {
      delete process.env.SLACK_TEAM_ID;
      setDetectedTeamId("T_DETECTED");
      expect(getTeamId()).toBe("T_DETECTED");
    });

    it("lets SLACK_TEAM_ID override the detected team ID", () => {
      process.env.SLACK_TEAM_ID = "T_ENV";
      setDetectedTeamId("T_DETECTED");
      expect(getTeamId()).toBe("T_ENV");
    });
  });

  describe("summarizeSlackError", () => {
    it("summarizes missing_scope errors", () => {
      const result = summarizeSlackError("missing_scope", "channels:read", "search:read");
      expect(result).toContain("missing required scope");
      expect(result).toContain("channels:read");
      expect(result).toContain("search:read");
    });

    it("summarizes auth errors", () => {
      expect(summarizeSlackError("not_authed")).toContain("/login sf-slack");
      expect(summarizeSlackError("invalid_auth")).toContain("invalid or missing");
      expect(summarizeSlackError("token_revoked")).toContain("invalid or missing");
    });

    it("summarizes channel_not_found", () => {
      expect(summarizeSlackError("channel_not_found")).toContain("not found");
    });

    it("summarizes missing_argument with Enterprise Grid guidance", () => {
      expect(summarizeSlackError("missing_argument")).toContain("SLACK_TEAM_ID");
    });

    it("summarizes rate-limit errors with a friendly message", () => {
      expect(summarizeSlackError("rate_limited")).toMatch(/rate-limit/i);
      expect(summarizeSlackError("http_429")).toMatch(/rate-limit/i);
    });

    it("summarizes bot_scopes_not_found with user-token guidance", () => {
      const text = summarizeSlackError("bot_scopes_not_found");
      expect(text).toMatch(/user token \(xoxp-\)/);
      expect(text).toMatch(/bot token/);
    });

    it("summarizes not_allowed_token_type the same way", () => {
      const text = summarizeSlackError("not_allowed_token_type");
      expect(text).toMatch(/user token \(xoxp-\)/);
    });

    it("summarizes token_expired with a refresh hint", () => {
      expect(summarizeSlackError("token_expired")).toMatch(/\/login sf-slack|refresh/);
    });

    it("summarizes missing_scope with a re-consent hint", () => {
      const text = summarizeSlackError("missing_scope", "files:read", "search:read");
      expect(text).toMatch(/re-consent/i);
      expect(text).toContain("files:read");
    });

    it("summarizes unknown errors", () => {
      expect(summarizeSlackError("weird_error")).toContain("weird_error");
    });
  });

  describe("detectTokenType", () => {
    it("returns user for xoxp- tokens", () => {
      expect(detectTokenType("xoxp-123")).toBe("user");
    });
    it("returns bot for xoxb- tokens", () => {
      expect(detectTokenType("xoxb-123")).toBe("bot");
    });
    it("returns app for xoxa- / xapp- tokens", () => {
      expect(detectTokenType("xoxa-123")).toBe("app");
      expect(detectTokenType("xapp-123")).toBe("app");
    });
    it("returns unknown for empty or unrecognized tokens", () => {
      expect(detectTokenType(undefined)).toBe("unknown");
      expect(detectTokenType("")).toBe("unknown");
      expect(detectTokenType("not-a-slack-token")).toBe("unknown");
    });
  });

  describe("granted-scope cache (X-OAuth-Scopes header capture)", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      _resetGrantedScopes();
    });

    it("populates the granted-scope cache from the response header", async () => {
      _resetGrantedScopes();
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, user: "u" }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "x-oauth-scopes": "channels:history, users:read, search:read.public",
            },
          }),
      ) as unknown as typeof fetch;

      // Before the call: unknown.
      expect(getGrantedScopes()).toBe(null);
      expect(hasScopeKnown("users:read")).toBe(false);
      // hasScope is permissive on unknown (returns true) so we don't pre-gate.
      expect(hasScope("users:read")).toBe(true);

      await slackApi("auth.test", "xoxp-test", {});

      const granted = getGrantedScopes();
      expect(granted).toBeInstanceOf(Set);
      expect(granted?.has("channels:history")).toBe(true);
      expect(granted?.has("users:read")).toBe(true);
      expect(granted?.has("search:read.public")).toBe(true);
      expect(granted?.has("files:read")).toBe(false);

      // After capture: scope checks become authoritative.
      expect(hasScopeKnown("users:read")).toBe(true);
      expect(hasScopeKnown("files:read")).toBe(false);
      expect(hasScope("files:read")).toBe(false);
      expect(hasAnyScope(["files:read", "channels:history"])).toBe(true);
      expect(hasAnyScope(["files:read", "canvases:write"])).toBe(false);
    });

    it("does not wipe the cache when a later response has no header", async () => {
      _resetGrantedScopes();
      let call = 0;
      globalThis.fetch = vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "x-oauth-scopes": "users:read",
            },
          });
        }
        // Second call: no header (simulates a 5xx without Slack envelope).
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      await slackApi("auth.test", "xoxp-test", {});
      expect(getGrantedScopes()?.has("users:read")).toBe(true);

      await slackApi("auth.test", "xoxp-test", {});
      // Still populated from the first response.
      expect(getGrantedScopes()?.has("users:read")).toBe(true);
    });
  });

  describe("DEFAULT_ASSISTANT_CHANNEL_TYPES", () => {
    it("includes public, private, mpim, and im", () => {
      // This string is what gets spread into every assistant.search.context
      // call to stop Slack from silently dropping DM content.
      expect(DEFAULT_ASSISTANT_CHANNEL_TYPES).toMatch(/public_channel/);
      expect(DEFAULT_ASSISTANT_CHANNEL_TYPES).toMatch(/private_channel/);
      expect(DEFAULT_ASSISTANT_CHANNEL_TYPES).toMatch(/mpim/);
      expect(DEFAULT_ASSISTANT_CHANNEL_TYPES).toMatch(/(?:^|,)im(?:,|$)/);
    });
  });

  describe("resolveUserMentionsInText", () => {
    beforeEach(() => {
      getUserCache().clear();
      getUserCache().set("U123", "Alice");
      getUserCache().set("W456", "Bob");
    });

    it("replaces <@UID> with @DisplayName from the cache", () => {
      expect(resolveUserMentionsInText("hey <@U123>, ping <@W456>!")).toBe(
        "hey @Alice, ping @Bob!",
      );
    });

    it("prefers the cache over the embedded fallback label", () => {
      // Slack's `<@UID|label>` syntax uses the label only as a fallback when
      // the UID can't be resolved. If we have the display name cached, use it.
      expect(resolveUserMentionsInText("hey <@U123|alice-handle>")).toBe("hey @Alice");
    });

    it("falls back to the embedded label when the UID is not cached", () => {
      expect(resolveUserMentionsInText("ping <@U999|u999-fallback>")).toBe("ping @u999-fallback");
    });

    it("keeps raw ID when nothing matches", () => {
      expect(resolveUserMentionsInText("ping <@U999>")).toBe("ping @U999");
    });

    it("returns empty input unchanged", () => {
      expect(resolveUserMentionsInText("")).toBe("");
    });
  });

  describe("resolveUserNameFromCache / resolveChannelNameFromCache", () => {
    beforeEach(() => {
      getUserCache().clear();
      getChannelCache().clear();
    });

    it("returns the ID itself when the cache is empty", () => {
      expect(resolveUserNameFromCache("U123")).toBe("U123");
      expect(resolveChannelNameFromCache("C0123456789")).toBe("C0123456789");
    });

    it("returns the cached name when present", () => {
      getUserCache().set("U123", "Alice");
      getChannelCache().set("C0123456789", "project-support");
      expect(resolveUserNameFromCache("U123")).toBe("Alice");
      expect(resolveChannelNameFromCache("C0123456789")).toBe("project-support");
    });

    it("returns an empty string for empty input", () => {
      expect(resolveUserNameFromCache("")).toBe("");
      expect(resolveChannelNameFromCache("")).toBe("");
    });
  });

  describe("warmUserCacheForIds (always-resolve path)", () => {
    // These tests stub global fetch so we can assert on which user IDs hit the
    // network. The point is to prove the "always resolve missing IDs" contract
    // and that already-cached IDs do NOT trigger additional fetches.
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];

    beforeEach(() => {
      calls.length = 0;
      getUserCache().clear();
      globalThis.fetch = vi.fn(async (_url: unknown, init: unknown) => {
        const body = String((init as { body?: unknown } | undefined)?.body ?? "");
        const userMatch = body.match(/user=([^&]+)/);
        const requestedUser = userMatch ? decodeURIComponent(userMatch[1]) : "";
        calls.push(requestedUser);
        const displayName = requestedUser ? `display-${requestedUser}` : "unknown";
        return new Response(
          JSON.stringify({
            ok: true,
            user: { id: requestedUser, profile: { display_name: displayName } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("fetches only the IDs that are not already cached", async () => {
      getUserCache().set("U_CACHED", "Already Here");

      await warmUserCacheForIds("xoxp-test", ["U_CACHED", "U_NEW_1", "U_NEW_2"]);

      // U_CACHED must NOT be refetched; the two new IDs must be fetched.
      expect(calls).not.toContain("U_CACHED");
      expect(calls).toContain("U_NEW_1");
      expect(calls).toContain("U_NEW_2");

      // Cache now contains display names for the newly-fetched IDs, and the
      // already-cached one is unchanged.
      expect(getUserCache().get("U_CACHED")).toBe("Already Here");
      expect(getUserCache().get("U_NEW_1")).toBe("display-U_NEW_1");
      expect(getUserCache().get("U_NEW_2")).toBe("display-U_NEW_2");
    });

    it("is a no-op when every ID is already cached", async () => {
      getUserCache().set("U_A", "A");
      getUserCache().set("U_B", "B");

      await warmUserCacheForIds("xoxp-test", ["U_A", "U_B"]);

      expect(calls).toHaveLength(0);
    });

    it("short-circuits for empty input without touching the network", async () => {
      await warmUserCacheForIds("xoxp-test", []);
      expect(calls).toHaveLength(0);
    });

    it("deduplicates repeated IDs in the input list", async () => {
      await warmUserCacheForIds("xoxp-test", ["U_DUP", "U_DUP", "U_DUP"]);
      expect(calls.filter((id) => id === "U_DUP")).toHaveLength(1);
    });
  });
});
