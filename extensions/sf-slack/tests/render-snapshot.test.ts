/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Visual regression snapshot tests for sf-slack renderResult().
 *
 * Why inline snapshots?
 *   Rendering is the single most visible user-facing surface of this
 *   extension. It is easy for a well-intentioned refactor to silently change
 *   the section emoji, the gutter glyph, or the way authors are resolved —
 *   and very hard to catch that in hand-written assertions.
 *
 * What we lock:
 *   - renderCall() summary lines for search / thread / history / permalink
 *   - renderResult() for each action in both collapsed and expanded modes,
 *     including:
 *        * channel-ID → #name resolution via the channel cache
 *        * <@UID> mention rewriting via the user cache
 *        * the "conversation ladder" thread layout (● parent, ↳ replies)
 *        * the grouped history layout (one author row, then time rows)
 *        * a rate-limited (HTTP 429) error path rendering a friendly ⏳ line
 *
 * What we deliberately DO NOT lock:
 *   - mid-line ANSI color codes. We use a passthrough theme so snapshots stay
 *     readable for humans and don't break on theme tweaks.
 *   - OSC 8 hyperlinks (compactPermalinks off) — otherwise snapshots would be
 *     full of non-printable escape sequences.
 *
 * Fixtures are fabricated — synthetic channel names, user IDs, authors, and
 * body text. The point is to exercise the render pipeline, not reproduce any
 * real conversation.
 *
 * If a real visual change is intended, re-run with -u to update snapshots and
 * eyeball the diff before committing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Text } from "@mariozechner/pi-tui";
import { renderCall, renderResult } from "../lib/render.ts";
import { resetPreferences, setPreferences } from "../lib/preferences.ts";
import { getUserCache, getChannelCache } from "../lib/api.ts";
import type { StructuredMatch, StructuredMessage } from "../lib/types.ts";

// ─── Passthrough theme ──────────────────────────────────────────────────────

const passthroughTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  strikethrough: (text: string) => text,
} as unknown as Theme;

/** Render a Text widget to a single multi-line string. Strips trailing
 *  whitespace from each line so right-padding does not leak into snapshots. */
function renderToString(text: Text, width = 120): string {
  const lines = text.render(width);
  return lines.map((line) => line.replace(/\s+$/u, "")).join("\n");
}

// ─── Fixtures (all values are synthetic) ────────────────────────────────────

const CHANNEL_ID = "C01ABCDEF23";
const CHANNEL_NAME = "team-agents-help";
const TS_PARENT = "1700000000.100001";

function seedCaches(): void {
  // Channel cache: the raw ID the LLM passed (C01…) resolves to the human
  // channel name shown in Slack's UI.
  getChannelCache().set(CHANNEL_ID, CHANNEL_NAME);

  // User cache covers both authors and in-body @mentions.
  getUserCache().set("U000AUTHOR1", "Alice");
  getUserCache().set("U000AUTHOR2", "Bob");
  getUserCache().set("U000AUTHOR3", "Carol");
  getUserCache().set("U000AUTHOR4", "Dana");
  getUserCache().set("U000AUTHOR5", "Eve");
  getUserCache().set("U000AUTHOR6", "Frank");
  getUserCache().set("U000AUTHOR7", "Grace");
}

function makeThreadMessages(): StructuredMessage[] {
  // Text fields mirror what extractStructuredMessages produces in production:
  // <@UID> mentions are already rewritten via the user cache before reaching
  // the render path. The snapshots below assert on the post-resolution form.
  return [
    {
      author: "U000AUTHOR1",
      text: "Where's the doc on what actually changes when a new version is committed? Seeing different behavior between draft and committed.",
      time: "5d ago",
      ts: TS_PARENT,
      replyCount: 14,
    },
    {
      author: "U000AUTHOR2",
      text: "@Carol @Dana can we take a look? Hearing a few reports of draft vs committed divergence this week.",
      time: "5d ago",
      ts: "1700000001.100002",
    },
    {
      author: "U000AUTHOR1",
      text: 'FYI — an internal workaround suggested setting "disable_new_runtime: true" in the config block, which reverts to the previous planner.',
      time: "5d ago",
      ts: "1700000002.100003",
    },
  ];
}

function makeHistoryMessages(): StructuredMessage[] {
  return [
    {
      author: "U000AUTHOR5",
      text: "Agent runtime is defaulting to UTC despite instructions to use local time. Appointments end up shifted by several hours.",
      time: "5d ago",
      ts: "1700000003.100004",
      threadTs: "1700000003.100004",
      replyCount: 8,
    },
    {
      author: "U000AUTHOR6",
      text: "The offset you quoted doesn't line up with a UTC-to-local conversion — did you mean a different timezone?",
      time: "5d ago",
      ts: "1700000004.100005",
    },
    {
      author: "U000AUTHOR6",
      text: "But I agree with @Grace — passing UTC through the action and converting only for display is usually more reliable.",
      time: "5d ago",
      ts: "1700000005.100006",
    },
  ];
}

function makeSearchMatches(): StructuredMatch[] {
  return [
    {
      channel: CHANNEL_NAME,
      author: "U000AUTHOR1",
      text: "Good news — this is a known issue and there's a workaround! Set disable_new_runtime: true in the config block.",
      time: "5d ago",
      permalink: "https://example.slack.com/archives/C01ABCDEF23/p1700000000100001",
      ts: TS_PARENT,
    },
    {
      channel: "team-dsl-feedback",
      author: "U000AUTHOR3",
      text: "The '#' character in instructions gets treated as a comment in the latest release — quote the instruction string to work around it.",
      time: "5d ago",
      permalink: "https://example.slack.com/archives/C01DEADBEEF/p1700000006100007",
      ts: "1700000006.100007",
    },
  ];
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("renderResult visual snapshots", () => {
  // Pin "now" to a date well past our 2023-11-14 fixtures so friendlyTime's
  // "today" / "weekday" branches never trigger. Paired with TZ=UTC from
  // vitest.config.ts, this makes the clock portion of the snapshots stable.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));

    getUserCache().clear();
    getChannelCache().clear();
    resetPreferences();
    // Keep permalinks as plain URLs in snapshots. OSC 8 escapes are not
    // printable and would pollute the locked output.
    setPreferences({ compactPermalinks: "off" });
    seedCaches();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── renderCall ──────────────────────────────────────────────────────────

  it("renderCall: search summary", () => {
    const text = renderCall(
      { action: "search", query: "agent script", limit: 20, fields: "preview" },
      passthroughTheme,
    );
    expect(renderToString(text)).toMatchInlineSnapshot(
      `"🔎 Slack Search "agent script" (limit: 20) [preview]"`,
    );
  });

  it("renderCall: thread summary resolves channel ID to #name", () => {
    const text = renderCall(
      { action: "thread", channel: CHANNEL_ID, ts: TS_PARENT },
      passthroughTheme,
    );
    expect(renderToString(text)).toMatchInlineSnapshot(
      `"💬 Slack Thread #team-agents-help · Nov 14 · 10:13 PM"`,
    );
  });

  it("renderCall: history summary", () => {
    const text = renderCall(
      { action: "history", channel: CHANNEL_ID, oldest: "1", latest: "2" },
      passthroughTheme,
    );
    expect(renderToString(text)).toMatchInlineSnapshot(
      `"📜 Slack History #team-agents-help [Jan 1 · 12:00 AM → Jan 1 · 12:00 AM]"`,
    );
  });

  it("renderCall: permalink summary", () => {
    const text = renderCall(
      { action: "permalink", channel: CHANNEL_ID, ts: TS_PARENT },
      passthroughTheme,
    );
    expect(renderToString(text)).toMatchInlineSnapshot(
      `"🔗 Slack Permalink #team-agents-help · Nov 14 · 10:13 PM"`,
    );
  });

  // ─── search ──────────────────────────────────────────────────────────────

  it("renderResult: search — collapsed preview", () => {
    const text = renderResult(
      {
        content: [],
        details: {
          ok: true,
          action: "search",
          query: "agent script",
          matches: makeSearchMatches(),
        },
      },
      { expanded: false, isPartial: false },
      passthroughTheme,
    );
    expect(renderToString(text)).toMatchInlineSnapshot(`
      "🔎 2 results · 2 channels · "agent script"

      ● AL Alice  Nov 14 · 10:13 PM  (5d ago) https://example.slack.com/archives/C01ABCDEF23/p1700000000100001  in
      #team-agents-help
          Good news — this is a known issue and there's a workaround! Set disable_new_runtime: true in the config block.
      ● CA Carol  Nov 14 · 10:13 PM  (5d ago) https://example.slack.com/archives/C01DEADBEEF/p1700000006100007  in
      #team-dsl-feedback
          The '#' character in instructions gets treated as a comment in the latest release — quote the instruction str…

        (expand for full bodies)"
    `);
  });

  it("renderResult: search — expanded", () => {
    const text = renderResult(
      {
        content: [],
        details: {
          ok: true,
          action: "search",
          query: "agent script",
          matches: makeSearchMatches(),
        },
      },
      { expanded: true, isPartial: false },
      passthroughTheme,
    );
    expect(renderToString(text)).toMatchInlineSnapshot(`
      "🔎 2 results · 2 channels · "agent script"

      ● AL Alice  Nov 14 · 10:13 PM  (5d ago) https://example.slack.com/archives/C01ABCDEF23/p1700000000100001  in
      #team-agents-help
          Good news — this is a known issue and there's a workaround! Set disable_new_runtime: true in the config block.

      ● CA Carol  Nov 14 · 10:13 PM  (5d ago) https://example.slack.com/archives/C01DEADBEEF/p1700000006100007  in
      #team-dsl-feedback
          The '#' character in instructions gets treated as a comment in the latest release — quote the instruction string to
      work around it."
    `);
  });

  // ─── thread ──────────────────────────────────────────────────────────────

  it("renderResult: thread — collapsed preview resolves authors from cache", () => {
    const text = renderResult(
      {
        content: [],
        details: {
          ok: true,
          action: "thread",
          channel: CHANNEL_ID,
          messages: makeThreadMessages(),
        },
      },
      { expanded: false, isPartial: false },
      passthroughTheme,
    );
    expect(renderToString(text)).toMatchInlineSnapshot(`
      "💬 Thread · #team-agents-help · 3 msgs · 2 people

      ● AL Alice  Nov 14 · 10:13 PM  (5d ago)  ↳ 14 replies
        Where's the doc on what actually changes when a new version is committed? Seeing different behavior between draft and
      committed.
      │
        ↳ BO Bob  Nov 14 · 10:13 PM  (5d ago)
        │ @Carol @Dana can we take a look? Hearing a few reports of draft vs committed divergence this week.
      │
        ↳ AL Alice  Nov 14 · 10:13 PM  (5d ago)
        │ FYI — an internal workaround suggested setting "disable_new_runtime: true" in the config block, which reverts to the
      previous planner.

        ───"
    `);
  });

  // Opt-in legacy behavior: `threadBodies: "preview"` still clips each
  // body to the 110-char preview and appends the "(expand for full
  // message bodies)" tease. Locked as a snapshot so nobody quietly
  // drops the clipping path or the footer wording.
  it("renderResult: thread — collapsed view clips when threadBodies is preview", () => {
    setPreferences({ threadBodies: "preview" });
    const text = renderResult(
      {
        content: [],
        details: {
          ok: true,
          action: "thread",
          channel: CHANNEL_ID,
          messages: makeThreadMessages(),
        },
      },
      { expanded: false, isPartial: false },
      passthroughTheme,
    );
    expect(renderToString(text)).toMatchInlineSnapshot(`
      "💬 Thread · #team-agents-help · 3 msgs · 2 people

      ● AL Alice  Nov 14 · 10:13 PM  (5d ago)  ↳ 14 replies
        Where's the doc on what actually changes when a new version is committed? Seeing different behavior between d…
      │
        ↳ BO Bob  Nov 14 · 10:13 PM  (5d ago)
        │ @Carol @Dana can we take a look? Hearing a few reports of draft vs committed divergence this week.
      │
        ↳ AL Alice  Nov 14 · 10:13 PM  (5d ago)
        │ FYI — an internal workaround suggested setting "disable_new_runtime: true" in the config block, which reverts…

        (expand for full message bodies)"
    `);
  });

  it("renderResult: thread — expanded conversation ladder with mention resolution", () => {
    const text = renderResult(
      {
        content: [],
        details: {
          ok: true,
          action: "thread",
          channel: CHANNEL_ID,
          messages: makeThreadMessages(),
        },
      },
      { expanded: true, isPartial: false },
      passthroughTheme,
    );
    expect(renderToString(text)).toMatchInlineSnapshot(`
      "💬 Thread · #team-agents-help · 3 msgs · 2 people

      ● AL Alice  Nov 14 · 10:13 PM  (5d ago)  ↳ 14 replies
        Where's the doc on what actually changes when a new version is committed? Seeing different behavior between draft and
      committed.
      │
        ↳ BO Bob  Nov 14 · 10:13 PM  (5d ago)
        │ @Carol @Dana can we take a look? Hearing a few reports of draft vs committed divergence this week.
      │
        ↳ AL Alice  Nov 14 · 10:13 PM  (5d ago)
        │ FYI — an internal workaround suggested setting "disable_new_runtime: true" in the config block, which reverts to the
      previous planner.

        ───"
    `);
  });

  // ─── history ─────────────────────────────────────────────────────────────

  it("renderResult: history — expanded grouped-by-author layout", () => {
    const text = renderResult(
      {
        content: [],
        details: {
          ok: true,
          action: "history",
          channel: CHANNEL_ID,
          messages: makeHistoryMessages(),
        },
      },
      { expanded: true, isPartial: false },
      passthroughTheme,
    );
    expect(renderToString(text)).toMatchInlineSnapshot(`
      "📜 3 messages · #team-agents-help · 2 authors

      ● EV Eve  Nov 14 · 10:13 PM  (5d ago)
          Agent runtime is defaulting to UTC despite instructions to use local time. Appointments end up shifted by several
      hours.
          ↳ 8 replies (thread_ts: 1700000003.100004)

      ● FR Frank  Nov 14 · 10:13 PM  (5d ago)
          The offset you quoted doesn't line up with a UTC-to-local conversion — did you mean a different timezone?
        · Nov 14 · 10:13 PM
          But I agree with @Grace — passing UTC through the action and converting only for display is usually more reliable."
    `);
  });

  // ─── permalink ───────────────────────────────────────────────────────────

  it("renderResult: permalink — success returns ✓ prefix with raw URL", () => {
    const text = renderResult(
      {
        content: [],
        details: {
          ok: true,
          action: "permalink",
          permalink: "https://example.slack.com/archives/C01ABCDEF23/p1700000000100001",
        },
      },
      { expanded: true, isPartial: false },
      passthroughTheme,
    );
    expect(renderToString(text)).toMatchInlineSnapshot(
      `"✓ https://example.slack.com/archives/C01ABCDEF23/p1700000000100001"`,
    );
  });

  // ─── rate-limit error path ───────────────────────────────────────────────

  it("renderResult: rate-limited error renders a friendly ⏳ line, not ✗ http_429", () => {
    const text = renderResult(
      {
        content: [{ type: "text", text: "Slack is rate-limiting this workspace." }],
        details: { ok: false, action: "thread", reason: "rate_limited" },
      },
      { expanded: true, isPartial: false },
      passthroughTheme,
    );
    const rendered = renderToString(text);
    expect(rendered).toMatchInlineSnapshot(
      `"⏳ Slack rate limited · retried once, still throttled. Try again in a few seconds."`,
    );
    // Guard against a future refactor that accidentally reverts to the raw
    // http_429 error line.
    expect(rendered).not.toContain("http_429");
    expect(rendered.startsWith("✗")).toBe(false);
  });

  // ─── empty-state paths ───────────────────────────────────────────────────

  it("renderResult: thread with zero messages shows a single warning line", () => {
    const text = renderResult(
      { content: [], details: { ok: true, action: "thread", messages: [] } },
      { expanded: true, isPartial: false },
      passthroughTheme,
    );
    expect(renderToString(text)).toMatchInlineSnapshot(`"💬 No messages in thread"`);
  });

  it("renderResult: search with zero matches shows a single warning line", () => {
    const text = renderResult(
      {
        content: [],
        details: { ok: true, action: "search", query: "nothing-here", matches: [] },
      },
      { expanded: true, isPartial: false },
      passthroughTheme,
    );
    expect(renderToString(text)).toMatchInlineSnapshot(`"🔎 No results for "nothing-here""`);
  });
});
