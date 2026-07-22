/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for the shared inject-once helper.
 *
 * Three extensions (sf-brain, sf-guardrail, sf-slack) share this predicate
 * shape, so the test pins the contract once here. Per-extension tests
 * (e.g. sf-brain's should-inject-kernel.test.ts) cover the kernel-specific
 * synthetic shapes; this file covers the helper-level behavior.
 */
import { describe, expect, it } from "vitest";
import {
  buildContextEntries,
  type CompactionEntry,
  type CustomEntry,
  type CustomMessageEntry,
  type SessionEntry,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

import {
  type ActiveContextSession,
  isLiveCustomMessageEntry,
  shouldInjectOnce,
} from "../session/inject-once.ts";

const CUSTOM_TYPE = "test-extension-injection";

let nextId = 0;
function newId(): string {
  return `id-${++nextId}`;
}

function customMessage(parentId: string | null = null): CustomMessageEntry {
  return {
    id: newId(),
    parentId,
    timestamp: new Date().toISOString(),
    type: "custom_message",
    customType: CUSTOM_TYPE,
    content: "<test>\nbody\n</test>",
    display: false,
  };
}

function userMessage(parentId: string | null, text: string): SessionMessageEntry {
  return {
    id: newId(),
    parentId,
    timestamp: new Date().toISOString(),
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    },
  };
}

function compaction(parentId: string, firstKeptEntryId: string): CompactionEntry {
  return {
    id: newId(),
    parentId,
    timestamp: new Date().toISOString(),
    type: "compaction",
    summary: "[summary]",
    firstKeptEntryId,
    tokensBefore: 50_000,
  };
}

function customStateMarker(parentId: string | null, customType: string): CustomEntry {
  return {
    id: newId(),
    parentId,
    timestamp: new Date().toISOString(),
    type: "custom",
    customType,
    data: {},
  };
}

function session(entries: readonly SessionEntry[]): ActiveContextSession {
  const copy = [...entries];
  const leafId = copy.at(-1)?.id ?? null;
  return {
    buildContextEntries: () => buildContextEntries(copy, leafId),
  };
}

describe("isLiveCustomMessageEntry", () => {
  it("matches a custom_message with the requested customType", () => {
    expect(isLiveCustomMessageEntry(customMessage(), CUSTOM_TYPE)).toBe(true);
  });

  it("rejects custom_message entries with a different customType", () => {
    const other: CustomMessageEntry = {
      ...customMessage(),
      customType: "different-extension",
    };
    expect(isLiveCustomMessageEntry(other, CUSTOM_TYPE)).toBe(false);
  });

  it("rejects custom (state-only) entries even with a matching customType", () => {
    // The bug class this helper exists to prevent: pi has a separate
    // `type: "custom"` state-marker entry created via `pi.appendEntry()`.
    // Predicates that match on `type === "custom"` never see real
    // injections, which is what caused the kernel-multiplied-N-times bug.
    expect(isLiveCustomMessageEntry(customStateMarker(null, CUSTOM_TYPE), CUSTOM_TYPE)).toBe(false);
  });

  it("rejects non-objects, null, and entries missing the type field", () => {
    expect(isLiveCustomMessageEntry(null, CUSTOM_TYPE)).toBe(false);
    expect(isLiveCustomMessageEntry(undefined, CUSTOM_TYPE)).toBe(false);
    expect(isLiveCustomMessageEntry("custom_message", CUSTOM_TYPE)).toBe(false);
    expect(isLiveCustomMessageEntry({ customType: CUSTOM_TYPE }, CUSTOM_TYPE)).toBe(false);
  });
});

describe("shouldInjectOnce — no compaction", () => {
  it("returns true for an empty session", () => {
    expect(shouldInjectOnce(session([]), CUSTOM_TYPE)).toBe(true);
  });

  it("returns true when only non-matching entries exist", () => {
    const u = userMessage(null, "hi");
    const otherInject: CustomMessageEntry = {
      ...customMessage(),
      customType: "other-extension",
    };
    expect(shouldInjectOnce(session([u, otherInject]), CUSTOM_TYPE)).toBe(true);
  });

  it("returns false when a matching custom_message exists", () => {
    const inject = customMessage();
    const u = userMessage(inject.id, "hi");
    expect(shouldInjectOnce(session([inject, u]), CUSTOM_TYPE)).toBe(false);
  });

  it("returns true when only a state-marker (type=custom) of the same name exists", () => {
    // Regression net for the original bug shape.
    const stateMarker = customStateMarker(null, CUSTOM_TYPE);
    const u = userMessage(stateMarker.id, "hi");
    expect(shouldInjectOnce(session([stateMarker, u]), CUSTOM_TYPE)).toBe(true);
  });
});

describe("shouldInjectOnce — post-compaction", () => {
  it("returns true when the previous injection was folded into the compaction summary", () => {
    const inject = customMessage();
    const u1 = userMessage(inject.id, "first turn");
    const u2 = userMessage(u1.id, "second turn");
    const c = compaction(u2.id, u2.id); // firstKeptEntryId past the inject
    const entries: SessionEntry[] = [inject, u1, u2, c];

    expect(shouldInjectOnce(session(entries), CUSTOM_TYPE)).toBe(true);
  });

  it("returns false when a fresh injection lives at or after firstKeptEntryId", () => {
    const inject1 = customMessage();
    const u1 = userMessage(inject1.id, "early turn");
    const c = compaction(u1.id, u1.id);
    const inject2 = customMessage(c.id);
    const u2 = userMessage(inject2.id, "post-compaction turn");
    const entries: SessionEntry[] = [inject1, u1, c, inject2, u2];

    expect(shouldInjectOnce(session(entries), CUSTOM_TYPE)).toBe(false);
  });

  it("uses the LATEST compaction's firstKeptEntryId across multiple compactions", () => {
    const inject1 = customMessage();
    const c1 = compaction(inject1.id, inject1.id);
    const inject2 = customMessage(c1.id);
    const u1 = userMessage(inject2.id, "between");
    const c2 = compaction(u1.id, u1.id); // sweeps inject2 into summary
    const entries: SessionEntry[] = [inject1, c1, inject2, u1, c2];

    expect(shouldInjectOnce(session(entries), CUSTOM_TYPE)).toBe(true);
  });
});

describe("shouldInjectOnce — predicate-based content staleness", () => {
  // The optional predicate parameter lets callers (e.g. sf-devbar) treat
  // a custom_message as "still valid" only when its content matches the
  // current state. This is what enables the "inject once + re-inject on
  // change" pattern without introducing a separate API.

  it("ignores matching entries the predicate rejects", () => {
    const stale = customMessage();
    const fresh: CustomMessageEntry = { ...customMessage(), content: "<test>\nfresh\n</test>" };
    const entries: SessionEntry[] = [stale, userMessage(stale.id, "u"), fresh];

    // Predicate: only the entry with "fresh" content counts.
    const wantsFresh = (e: CustomMessageEntry) =>
      typeof e.content === "string" && e.content.includes("fresh");

    // A valid (fresh) injection exists \u2192 skip.
    expect(shouldInjectOnce(session(entries), CUSTOM_TYPE, wantsFresh)).toBe(false);

    // Predicate that rejects everything \u2192 inject (no entry counts).
    expect(shouldInjectOnce(session(entries), CUSTOM_TYPE, () => false)).toBe(true);
  });
});
