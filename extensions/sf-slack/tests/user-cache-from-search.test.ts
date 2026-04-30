/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regression tests for the "resolve user by fuzzy name on enterprise grid"
 * flow. This is the user-side mirror of channel-cache-from-search.test.ts.
 *
 * Repro scenario that motivated this change (enterprise grid):
 *   1. Human asks the agent for "Mike McCula" (misspelling of "Mike Mikula").
 *   2. `slack_resolve type=user` runs `users.list`, which fails with
 *      `team_access_not_granted` because the target user's home workspace
 *      is another workspace in the grid.
 *   3. Fallbacks for users (cache_lookup, email) don't help: we've never
 *      seen the user, and the input isn't an email or a raw ID.
 *   4. The tool returns zero candidates with a red error banner, three
 *      times in a row as the agent retries. Human is stuck.
 *
 * What Slackbot does instead: when its directory lookup comes back empty,
 * it searches messages/files, mines author names from the hits, and
 * returns spelling suggestions ("did you mean Mike McGeehan, Mike Sobrero,
 * Mike Cliffe?").
 *
 * The fix:
 *   - Harvest `{author_user_id → author_name}` from every search response
 *     into the shared user cache (warmUserCacheFromMatches).
 *   - Add an `assistant.search.context` fallback to resolveUser when
 *     users.list fails or returns zero useful candidates.
 *
 * Net effect: "Mike McCula" still doesn't match, but the returned
 * candidates include "Mike Mikula" (confidence capped below the 0.85
 * auto-select threshold so the HITL dialog opens with real options).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserCache, warmUserCacheFromMatches } from "../lib/api.ts";
import { resolveUser } from "../lib/resolve.ts";

describe("warmUserCacheFromMatches", () => {
  beforeEach(() => {
    getUserCache().clear();
  });

  it("populates the cache from {author_user_id, author_name} fields", () => {
    warmUserCacheFromMatches([
      { author_user_id: "U0AAA00001", author_name: "Alice Example" },
      { author_user_id: "U0BBB00002", author_name: "Bob Example" },
    ]);
    expect(getUserCache().get("U0AAA00001")).toBe("Alice Example");
    expect(getUserCache().get("U0BBB00002")).toBe("Bob Example");
  });

  it("also reads {user, username} shape from search.messages results", () => {
    warmUserCacheFromMatches([
      { user: "U0CCC00003", username: "Carol Example" },
      { user: "U0DDD00004", username: "Dave Example" },
    ]);
    expect(getUserCache().get("U0CCC00003")).toBe("Carol Example");
    expect(getUserCache().get("U0DDD00004")).toBe("Dave Example");
  });

  it("skips entries missing either id or name", () => {
    warmUserCacheFromMatches([
      { author_user_id: "U0001" }, // no name — skip
      { author_name: "orphan" }, // no id — skip
      { author_user_id: "U0002", author_name: "U0002" }, // name == id — skip
      { author_user_id: "U0003", author_name: "good" },
    ]);
    expect(getUserCache().has("U0001")).toBe(false);
    expect(getUserCache().has("U0002")).toBe(false);
    expect(getUserCache().get("U0003")).toBe("good");
  });

  it("does not overwrite an existing richer display name", () => {
    // Simulate prewarm populating a display name first.
    getUserCache().set("U0EEE00005", "Eve Example (Director)");
    warmUserCacheFromMatches([{ author_user_id: "U0EEE00005", author_name: "eve" }]);
    expect(getUserCache().get("U0EEE00005")).toBe("Eve Example (Director)");
  });

  it("is a no-op on empty/undefined input", () => {
    warmUserCacheFromMatches(undefined);
    warmUserCacheFromMatches([]);
    expect(getUserCache().size).toBe(0);
  });
});

describe("resolveUser — grid-safe search fallback", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    getUserCache().clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns search-based candidates when users.list is blocked by team_access_not_granted", async () => {
    // Simulate enterprise grid: directory is gated, but search works and
    // surfaces the real author from a message hit.
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("users.list")) {
        return new Response(JSON.stringify({ ok: false, error: "team_access_not_granted" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("assistant.search.context")) {
        return new Response(
          JSON.stringify({
            ok: true,
            results: {
              messages: [
                {
                  author_user_id: "U0MIKULA01",
                  author_name: "Mike Mikula",
                  channel_id: "C0AAA00001",
                  channel_name: "alpha-dev",
                  text: "Fuzzy match content",
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: false, error: "not_implemented" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    // "Mike McCula" is a realistic misspelling. The search hit is
    // "Mike Mikula" — should be close enough to surface as a candidate.
    const result = await resolveUser("xoxp-test", "Mike McCula");

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.best).toBeDefined();
    expect(result.best!.id).toBe("U0MIKULA01");
    expect(result.best!.displayName).toBe("Mike Mikula");
    expect(result.strategy).toContain("assistant.search.context");
    // Confidence stays below auto-select — HITL dialog should still open.
    expect(result.best!.confidence).toBeLessThan(0.85);
  });

  it("populates the user cache from search so future resolves short-circuit", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("users.list")) {
        return new Response(JSON.stringify({ ok: false, error: "team_access_not_granted" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("assistant.search.context")) {
        return new Response(
          JSON.stringify({
            ok: true,
            results: {
              messages: [
                { author_user_id: "U0FFF00006", author_name: "Frank Example", text: "hi" },
                { author_user_id: "U0GGG00007", author_name: "Grace Example", text: "hi" },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: false, error: "not_implemented" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await resolveUser("xoxp-test", "Frank");

    // Both authors should be in the cache, not just the one that matched.
    expect(getUserCache().get("U0FFF00006")).toBe("Frank Example");
    expect(getUserCache().get("U0GGG00007")).toBe("Grace Example");
  });

  it("still returns zero candidates and a helpful warning when search also fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: false, error: "team_access_not_granted" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await resolveUser("xoxp-test", "Nobody Example");

    expect(result.ok).toBe(false);
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/No user candidates found/);
  });
});
