/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regression tests for the "search → history without dialog" flow.
 *
 * Repro scenario that motivated this change (enterprise grid):
 *   1. `slack_research` calls `assistant.search.context`, which returns
 *      messages with `{channel_id: "C095...", channel_name: "alpha-dev"}`.
 *   2. The agent then calls `slack action:'history'` with `channel: "C095..."`.
 *   3. `resolveChannel` hits `conversations.info`, which fails with
 *      `team_access_not_granted` because the channel lives in another
 *      workspace in the grid.
 *   4. Fuzzy fallbacks (`conversations.list`, `assistant.search.context` on
 *      the raw ID string) return nothing — you can't name-match a Slack ID.
 *   5. HITL dialog fires with zero candidates; the user can only cancel.
 *
 * The fix:
 *   - Harvest `{channel_id → channel_name}` from every search response into
 *     the shared channel cache.
 *   - Have `resolveChannel` short-circuit on cache-by-ID before
 *     `conversations.info`.
 *
 * Net effect: the dialog never fires for an ID we've already seen by name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getChannelCache,
  warmChannelCacheFromMatches,
  resolveChannelNameFromCache,
} from "../lib/api.ts";
import { resolveChannel } from "../lib/resolve.ts";

describe("warmChannelCacheFromMatches", () => {
  beforeEach(() => {
    getChannelCache().clear();
  });

  it("populates the cache from {channel_id, channel_name} fields", () => {
    warmChannelCacheFromMatches([
      { channel_id: "C0AAA00001", channel_name: "alpha-dev" },
      { channel_id: "C0BBB00002", channel_name: "beta-dev" },
    ]);
    expect(resolveChannelNameFromCache("C0AAA00001")).toBe("alpha-dev");
    expect(resolveChannelNameFromCache("C0BBB00002")).toBe("beta-dev");
  });

  it("also reads nested {channel: {id, name}} shape", () => {
    warmChannelCacheFromMatches([
      { channel: { id: "C0CCC00003", name: "gamma" } },
      { channel: { id: "C0DDD00004", name: "delta" } },
    ]);
    expect(resolveChannelNameFromCache("C0CCC00003")).toBe("gamma");
    expect(resolveChannelNameFromCache("C0DDD00004")).toBe("delta");
  });

  it("skips entries missing either id or name", () => {
    warmChannelCacheFromMatches([
      { channel_id: "C0001" }, // no name — skip
      { channel_name: "orphan" }, // no id — skip
      { channel_id: "C0002", channel_name: "C0002" }, // name == id — skip (useless)
      { channel_id: "C0003", channel_name: "good" },
    ]);
    expect(resolveChannelNameFromCache("C0001")).toBe("C0001"); // uncached
    expect(resolveChannelNameFromCache("C0002")).toBe("C0002"); // uncached
    expect(resolveChannelNameFromCache("C0003")).toBe("good");
  });

  it("is a no-op on empty/undefined input", () => {
    warmChannelCacheFromMatches(undefined);
    warmChannelCacheFromMatches([]);
    expect(getChannelCache().size).toBe(0);
  });
});

describe("resolveChannel — cache-by-ID short-circuit", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    getChannelCache().clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns a 1.0-confidence candidate without a network call when the ID is cached", async () => {
    // Simulate the post-search state: slack_research populated the cache.
    warmChannelCacheFromMatches([{ channel_id: "C0AAA00001", channel_name: "alpha-dev" }]);

    // Network is a hard failure — proves we don't need it.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fetch must not be called when the ID is already cached");
    }) as unknown as typeof fetch;

    const result = await resolveChannel("xoxp-test", "C0AAA00001");

    expect(result.ok).toBe(true);
    expect(result.best).toBeDefined();
    expect(result.best!.id).toBe("C0AAA00001");
    expect(result.best!.name).toBe("alpha-dev");
    expect(result.confidence).toBe(1);
    expect(result.strategy).toContain("cache_by_id");
  });

  it("falls through to conversations.info when the cache is empty", async () => {
    globalThis.fetch = vi.fn(async (_url: unknown, init: unknown) => {
      const body = String((init as { body?: unknown } | undefined)?.body ?? "");
      if (body.includes("channel=")) {
        return new Response(
          JSON.stringify({
            ok: true,
            channel: { id: "C0123456789", name: "project-support" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: false, error: "not_implemented" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await resolveChannel("xoxp-test", "C0123456789");

    expect(result.best).toBeDefined();
    expect(result.best!.name).toBe("project-support");
    expect(result.strategy).toContain("channel_id");
    expect(result.strategy).not.toContain("cache_by_id");
  });

  it("reproduces the grid-cross-workspace fix: cached ID resolves even when info fails", async () => {
    // Cache was warmed from `assistant.search.context` (grid-wide), but the
    // token's `conversations.info` fails with team_access_not_granted.
    warmChannelCacheFromMatches([{ channel_id: "C0AAA00001", channel_name: "alpha-dev" }]);

    // Make conversations.info explicitly fail — if we hit it, the test fails.
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: false, error: "team_access_not_granted" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await resolveChannel("xoxp-test", "C0AAA00001");

    expect(result.ok).toBe(true);
    expect(result.best!.name).toBe("alpha-dev");
    expect(result.best!.confidence).toBe(1);
    // No warning about unverifiable ID because we never asked Slack.
    expect(result.warnings).toHaveLength(0);
  });
});
