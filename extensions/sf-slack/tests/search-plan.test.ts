/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for sf-slack search query planning helpers. */
import { describe, expect, it } from "vitest";
import { buildQueryParts, compileSlackQuery } from "../lib/search-plan.ts";
import type { SlackSearchPlan } from "../lib/types.ts";

const resolved: SlackSearchPlan["resolved"] = {
  channel: {
    id: "C0123456789",
    name: "team-share-lab",
    confidence: 0.98,
    source: "test",
  },
  fromUser: {
    id: "U0123456789",
    handle: "jane.doe",
    displayName: "Jane Doe",
    realName: "Jane Doe",
    email: "jane@example.com",
    confidence: 0.98,
    source: "test",
  },
  withUser: {
    id: "U0987654321",
    handle: "alex.lee",
    displayName: "Alex Lee",
    realName: "Alex Lee",
    email: "alex@example.com",
    confidence: 0.98,
    source: "test",
  },
};

describe("search plan helpers", () => {
  it("compiles channel, author, participant, date, content, reaction, and thread operators", () => {
    const parts = buildQueryParts(
      {
        query: 'find "multi turn testing" docs',
        since: "2026-03-01",
        before: "2026-04-01",
        content_filters: ["link", "reaction"],
        reaction_names: ["eyes"],
        thread_only: true,
        exclude_terms: ["draft"],
      },
      resolved,
      [],
    );

    const query = compileSlackQuery(parts);
    expect(query).toContain('"multi turn testing"');
    expect(query).toContain("docs");
    expect(query).toContain("in:#team-share-lab");
    expect(query).toContain("from:jane.doe");
    expect(query).toContain("with:@Alex Lee");
    expect(query).toContain("after:2026-03-01");
    expect(query).toContain("before:2026-04-01");
    expect(query).toContain("has:link");
    expect(query).toContain("has:reaction");
    expect(query).toContain("has::eyes:");
    expect(query).toContain("is:thread");
    expect(query).toContain("-draft");
  });

  it("uses from:me without resolving a user object", () => {
    const parts = buildQueryParts(
      { query: "status update", since: "march" },
      { fromUser: { handle: "me", displayName: "me" } },
      [],
    );
    const query = compileSlackQuery(parts);
    expect(query).toContain("from:me");
    expect(query).toMatch(/after:\d{4}-03-01/);
  });

  it("uses during operators when requested", () => {
    const parts = buildQueryParts({ query: "release notes", during: "week" }, {}, []);
    expect(compileSlackQuery(parts)).toContain("during:week");
  });
});
