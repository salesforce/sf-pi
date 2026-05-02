/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for sf-slack resolver helpers. */
import { describe, expect, it } from "vitest";
import {
  buildChannelDiscoveryQueries,
  isSlackChannelId,
  isSlackUserId,
  normalizeName,
  scoreName,
} from "../lib/resolve.ts";

describe("resolve helpers", () => {
  it("detects Slack channel and user IDs", () => {
    expect(isSlackChannelId("C0123456789")).toBe(true);
    expect(isSlackChannelId("team-lab")).toBe(false);
    expect(isSlackUserId("U0123456789")).toBe(true);
    expect(isSlackUserId("Jane Doe")).toBe(false);
  });

  it("normalizes names for fuzzy comparison", () => {
    expect(normalizeName("#Team Share-Lab")).toBe("teamsharelab");
    expect(normalizeName("@Jane.Doe")).toBe("janedoe");
  });

  it("scores exact, contained, and fuzzy names", () => {
    expect(scoreName("team-share-lab", "team-share-lab")).toBeGreaterThan(0.95);
    expect(scoreName("share lab", "team-share-lab")).toBeGreaterThan(0.8);
    expect(scoreName("project share lab", "project-ai-sharelab")).toBeGreaterThan(0.75);
    expect(scoreName("unrelated", "team-share-lab")).toBeLessThan(0.6);
  });

  it("builds multiple channel discovery queries", () => {
    const queries = buildChannelDiscoveryQueries("#team share lab");
    expect(queries).toContain("in:#team share lab");
    expect(queries).toContain("team share lab");
    expect(queries).toContain("teamsharelab");
  });
});

// ─── Bug #1 regression: raw channel IDs must not fabricate candidates ─────────
// Live chaos-test repro: `slack_resolve type=channel text=C09ZZZZZZZZ` returned
// a 0.75-confidence "best match" for any syntactically valid ID even when
// Slack's conversations.info failed with team_access_not_granted. That was
// above slack/slack_channel/slack_file's internal 0.60 threshold, causing
// downstream tool calls to route to ghost IDs.
//
// After the HITL migration + resolveChannelById fix, the resolver must:
//   - NOT return a fabricated 0.75 candidate for unverifiable IDs
//   - emit a warning so callers can explain to the user what happened
//   - keep the overall resolve flow usable (fall through to other strategies)
import { afterEach, vi } from "vitest";
import { resolveChannel } from "../lib/resolve.ts";

describe("resolveChannel — raw ID verification (Bug #1 regression guard)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does not fabricate a candidate when conversations.info fails", async () => {
    // Every Slack API call in this test returns an error envelope so all
    // resolution strategies (conversations.info, conversations.list,
    // assistant.search.context) fail cleanly.
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: false, error: "team_access_not_granted" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await resolveChannel("xoxp-test", "C09ZZZZZZZZ");

    // No candidates are returned because nothing could verify the ID.
    expect(result.candidates.length).toBe(0);
    expect(result.best).toBeUndefined();
    // The resolver still emits a warning so the caller can surface it.
    expect(result.warnings.some((w) => w.includes("could not be verified"))).toBe(true);
  });

  it("returns cleanly when every Slack call times out (issue #17 regression guard)", async () => {
    // Simulate the exact scenario from issue #17: a non-existent channel
    // name falls through to searchChannelCandidates, and every Slack call
    // stalls on a half-open connection. We shortcut the real 30s per-request
    // timeout by throwing a TimeoutError directly — that's what Node's
    // fetch surfaces when AbortSignal.timeout fires. Before the fix the
    // whole resolve hung forever; now each strategy returns `ok: false`
    // with error=request_timeout and the resolver surfaces "not resolved"
    // instead of hanging the tool call.
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as unknown as typeof fetch;

    const result = await resolveChannel("xoxp-test", "se-salesforce-payments");

    expect(result.ok).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.best).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("still populates candidates when the ID is valid", async () => {
    // conversations.info returns a real channel; the resolver should keep
    // the 1.0-confidence candidate without any fabrication.
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
    expect(result.best!.id).toBe("C0123456789");
    expect(result.best!.name).toBe("project-support");
    expect(result.confidence).toBe(1);
  });
});
